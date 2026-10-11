// Account sync decisions (pure, unit-tested). A book is the same book on every device when its file hash is
// the same, so the cloud copy is keyed by hash; each device keeps its own local id.
import type { BookRecord, ProgressRecord } from '../storage/types';

/** One row of the `books` table: a book stored in the signed-in person's account. */
export interface CloudBook {
  hash: string;
  file_name: string;
  format: string;
  size: number;
  title: string;
  author: string;
  added_at: number;
  /** reading position, device-independent (see ProgressRecord) */
  progress: CloudProgress | null;
  progress_at: number;
}
export type CloudProgress = Omit<ProgressRecord, 'bookId' | 'updatedAt'>;

/** The free storage tier refuses larger files. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** `<user>/<hash>.<ext>` inside the private bucket; the first folder is what the access rules check. */
export function storagePath(userId: string, hash: string, fileName: string): string {
  const lower = fileName.toLowerCase();
  const ext = (lower.endsWith('.fb2.zip') ? 'fb2.zip' : lower.includes('.') ? lower.split('.').pop() ?? '' : '').replace(/[^a-z0-9.]/g, '') || 'bin';
  return `${userId}/${hash}.${ext}`;
}

export function toCloudRow(b: BookRecord, p: ProgressRecord | undefined): CloudBook {
  return {
    hash: b.hash, file_name: b.fileName, format: b.format, size: b.size,
    title: b.metadata.title, author: b.metadata.author ?? '', added_at: b.addedAt,
    progress: p ? cloudProgress(p) : null, progress_at: p?.updatedAt ?? 0,
  };
}

export function cloudProgress(p: ProgressRecord): CloudProgress {
  const { bookId: _b, updatedAt: _u, ...rest } = p;
  return rest;
}

export interface SyncPlan {
  /** on this device, not in the account yet */
  upload: BookRecord[];
  /** too large for the account's storage */
  tooLarge: BookRecord[];
  /** in the account, not on this device */
  remoteOnly: CloudBook[];
  /** reading position is newer here: send it */
  pushProgress: { hash: string; progress: ProgressRecord }[];
  /** reading position is newer in the account: apply it here */
  pullProgress: { bookId: string; row: CloudBook }[];
}

// clocks of two devices differ a little; ignore differences smaller than this
const SKEW_MS = 2000;

export function planSync(local: BookRecord[], progress: Record<string, ProgressRecord>, remote: CloudBook[], excluded: string[] = []): SyncPlan {
  const remoteBy = new Map(remote.map((r) => [r.hash, r]));
  const localHashes = new Set(local.map((b) => b.hash));
  const plan: SyncPlan = { upload: [], tooLarge: [], remoteOnly: remote.filter((r) => !localHashes.has(r.hash)), pushProgress: [], pullProgress: [] };
  for (const b of local) {
    const row = remoteBy.get(b.hash);
    if (!row) {
      if (excluded.includes(b.hash)) continue;
      if (b.size > MAX_UPLOAD_BYTES) plan.tooLarge.push(b); else plan.upload.push(b);
      continue;
    }
    const p = progress[b.id];
    const at = p?.updatedAt ?? 0;
    if (p && at > row.progress_at + SKEW_MS) plan.pushProgress.push({ hash: b.hash, progress: p });
    else if (row.progress && row.progress_at > at + SKEW_MS) plan.pullProgress.push({ bookId: b.id, row });
  }
  return plan;
}

/** The local progress record for a position stored in the account. */
export function localProgress(bookId: string, row: CloudBook): ProgressRecord | null {
  const p = row.progress;
  if (!p || typeof p.fraction !== 'number' || !Number.isFinite(p.fraction)) return null;
  return { ...p, bookId, updatedAt: row.progress_at };
}

/** Sign-in errors in plain words. */
export function authMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'This email already has an account. Sign in instead.';
  if (m.includes('not confirmed')) return 'Open the confirmation link sent to your email, then sign in.';
  if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short'))) return 'Choose a longer password (at least 6 characters).';
  if (m.includes('valid email') || m.includes('invalid email') || m.includes('invalid format')) return 'Enter a valid email address.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('network') || m.includes('fetch')) return 'No connection to the server. Check the internet and try again.';
  return raw;
}
