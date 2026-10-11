// The signed-in account and book sync. Signing in is optional: without it nothing leaves the device. With it,
// the books added on this device are copied to the person's private space, and the books in that space can be
// downloaded on any other device they sign in on. Reading positions travel with the books.
import { create } from 'zustand';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { BUCKET, cloud, cloudConfigured } from '../cloud/client';
import { authMessage, cloudProgress, localProgress, planSync, storagePath, toCloudRow, type CloudBook } from '../cloud/sync-logic';
import { importMany } from '../import/importer';
import { fileStore, originalFile, sha256Hex } from '../platform/files';
import { getRepo } from './repo';
import { useLibrary } from './library-store';

interface AccountState {
  configured: boolean;
  /** false until the saved session has been looked up */
  ready: boolean;
  user: { id: string; email: string } | null;
  /** the books in the account, as of the last sync */
  cloud: CloudBook[];
  /** what sync is doing right now, or null */
  busy: string | null;
  /** hashes being downloaded */
  downloading: string[];
  error: string | null;
  notice: string | null;
  lastSync: number | null;
  init(): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  sync(): Promise<void>;
  download(hash: string): Promise<void>;
  removeFromAccount(hash: string): Promise<void>;
}

const COLUMNS = 'hash,file_name,format,size,title,author,added_at,progress,progress_at';
const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

async function excludedHashes(): Promise<string[]> {
  try { const v = JSON.parse((await (await getRepo()).getKV('cloudExcluded')) || '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

let started = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useAccount = create<AccountState>((set, get) => {
  const later = (ms: number) => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void get().sync(); }, ms);
  };
  const credentials = (email: string, password: string) => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) { set({ error: 'Enter a valid email address.' }); return null; }
    if (password.length < 6) { set({ error: 'The password needs at least 6 characters.' }); return null; }
    return { email: e, password };
  };

  return {
    configured: cloudConfigured, ready: !cloudConfigured, user: null, cloud: [], busy: null, downloading: [], error: null, notice: null, lastSync: null,

    init() {
      if (started || !cloudConfigured) return;
      started = true;
      const c = cloud();
      c.auth.onAuthStateChange((_event, session) => {
        const was = get().user?.id;
        const user = session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null;
        set({ user, ready: true, ...(user ? {} : { cloud: [], lastSync: null }) });
        if (user && user.id !== was) later(300);
      });
      void c.auth.getSession().then(() => set({ ready: true })).catch(() => set({ ready: true }));
      // keep the session fresh only while the app is in use
      AppState.addEventListener('change', (s) => { if (s === 'active') void c.auth.startAutoRefresh(); else void c.auth.stopAutoRefresh(); });
      // a newly added book goes to the account by itself
      useLibrary.subscribe((s, prev) => { if (get().user && s.books.length > prev.books.length && !get().downloading.length) later(1500); });
    },

    async signIn(email, password) {
      const cr = credentials(email, password);
      if (!cr) return false;
      set({ error: null, notice: null, busy: 'Signing in…' });
      try {
        const { error } = await cloud().auth.signInWithPassword(cr);
        if (error) { set({ error: authMessage(error.message) }); return false; }
        return true;
      } catch (e) { set({ error: authMessage(msg(e)) }); return false; } finally { set({ busy: null }); }
    },

    async signUp(email, password) {
      const cr = credentials(email, password);
      if (!cr) return false;
      set({ error: null, notice: null, busy: 'Creating your account…' });
      try {
        const { data, error } = await cloud().auth.signUp(cr);
        if (error) { set({ error: authMessage(error.message) }); return false; }
        // with email confirmation on, there is no session until the link in the email is opened
        if (!data.session) set({ notice: `We sent a confirmation link to ${cr.email}. Open it, then sign in here.` });
        return true;
      } catch (e) { set({ error: authMessage(msg(e)) }); return false; } finally { set({ busy: null }); }
    },

    async signOut() {
      set({ error: null, notice: null });
      try { await cloud().auth.signOut(); } catch { /* the local session is dropped either way */ }
      set({ user: null, cloud: [], lastSync: null });
    },

    async sync() {
      const user = get().user;
      if (!user || get().busy) return;
      set({ busy: 'Checking your account…', error: null });
      try {
        const c = cloud();
        const { data, error } = await c.from('books').select(COLUMNS).order('added_at', { ascending: false });
        if (error) throw error;
        let rows = (data ?? []) as unknown as CloudBook[];
        const lib = useLibrary.getState();
        const plan = planSync(lib.books, lib.progress, rows, await excludedHashes());
        const failed: string[] = [];

        for (let i = 0; i < plan.upload.length; i++) {
          const b = plan.upload[i];
          set({ busy: `Uploading ${i + 1} of ${plan.upload.length}: ${b.metadata.title}` });
          try {
            const bytes = await originalFile(b.id, b.fileName).bytes();
            const up = await c.storage.from(BUCKET).upload(storagePath(user.id, b.hash, b.fileName), bytes, { contentType: 'application/octet-stream', upsert: true });
            if (up.error) throw up.error;
            const row = toCloudRow(b, useLibrary.getState().progress[b.id]);
            const ins = await c.from('books').upsert({ ...row, user_id: user.id });
            if (ins.error) throw ins.error;
            rows = [row, ...rows];
            set({ cloud: rows });
          } catch (e) { failed.push(`${b.metadata.title} (${msg(e)})`); }
        }

        set({ busy: 'Syncing reading positions…' });
        for (const p of plan.pushProgress) {
          const r = await c.from('books').update({ progress: cloudProgress(p.progress), progress_at: p.progress.updatedAt }).eq('user_id', user.id).eq('hash', p.hash);
          if (!r.error) rows = rows.map((x) => (x.hash === p.hash ? { ...x, progress: cloudProgress(p.progress), progress_at: p.progress.updatedAt } : x));
        }
        for (const p of plan.pullProgress) {
          const rec = localProgress(p.bookId, p.row);
          if (rec) await useLibrary.getState().setProgress(rec);
        }

        const notes: string[] = [];
        if (failed.length) notes.push(`Could not upload: ${failed.join('; ')}`);
        if (plan.tooLarge.length) notes.push(`${plan.tooLarge.length} book${plan.tooLarge.length === 1 ? ' is' : 's are'} over 50 MB and stay${plan.tooLarge.length === 1 ? 's' : ''} only on this device.`);
        set({ cloud: rows, lastSync: Date.now(), error: notes.length ? notes.join(' ') : null });
      } catch (e) {
        set({ error: `Sync failed: ${authMessage(msg(e))}` });
      } finally {
        set({ busy: null });
      }
    },

    async download(hash) {
      const user = get().user;
      const row = get().cloud.find((r) => r.hash === hash);
      if (!user || !row || get().downloading.includes(hash)) return;
      set({ downloading: [...get().downloading, hash], error: null });
      const tmp = new File(Paths.cache, `account-${hash.slice(0, 16)}-${Date.now()}`);
      try {
        const signed = await cloud().storage.from(BUCKET).createSignedUrl(storagePath(user.id, row.hash, row.file_name), 900);
        if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('No download link');
        await File.downloadFileAsync(signed.data.signedUrl, tmp);
        const [res] = await importMany([{ name: row.file_name, size: row.size, readBytes: () => tmp.bytes() }], { repo: await getRepo(), files: fileStore, sha256: sha256Hex });
        if (res.status === 'failed') throw new Error(res.message);
        await useLibrary.getState().load();
        const book = res.status === 'imported' ? res.book : res.existing;
        const rec = localProgress(book.id, row);
        if (rec && !useLibrary.getState().progress[book.id]) await useLibrary.getState().setProgress(rec);
      } catch (e) {
        set({ error: `Could not download "${row.title || row.file_name}": ${authMessage(msg(e))}` });
      } finally {
        try { if (tmp.exists) tmp.delete(); } catch { /* temporary file */ }
        set({ downloading: get().downloading.filter((h) => h !== hash) });
      }
    },

    async removeFromAccount(hash) {
      const user = get().user;
      const row = get().cloud.find((r) => r.hash === hash);
      if (!user || !row) return;
      set({ error: null });
      try {
        const c = cloud();
        const del = await c.from('books').delete().eq('user_id', user.id).eq('hash', hash);
        if (del.error) throw del.error;
        await c.storage.from(BUCKET).remove([storagePath(user.id, row.hash, row.file_name)]);
        // if the book is still on this device, do not send it straight back on the next sync
        if (useLibrary.getState().books.some((b) => b.hash === hash)) {
          const ex = await excludedHashes();
          if (!ex.includes(hash)) await (await getRepo()).setKV('cloudExcluded', JSON.stringify([...ex, hash]));
        }
        set({ cloud: get().cloud.filter((r) => r.hash !== hash) });
      } catch (e) {
        set({ error: `Could not remove the book from your account: ${authMessage(msg(e))}` });
      }
    },
  };
});
