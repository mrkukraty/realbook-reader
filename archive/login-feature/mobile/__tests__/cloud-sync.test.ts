/// <reference types="jest" />
import { MAX_UPLOAD_BYTES, authMessage, cloudProgress, localProgress, planSync, storagePath, toCloudRow, type CloudBook } from '../src/cloud/sync-logic';
import type { BookRecord, ProgressRecord } from '../src/storage/types';

const book = (id: string, hash: string, over: Partial<BookRecord> = {}): BookRecord => ({
  id, hash, fileName: `${id}.epub`, format: 'epub', size: 1000, metadata: { title: `Title ${id}`, author: 'A. Writer' },
  favorite: false, collectionIds: [], addedAt: 100, ...over,
});
const row = (hash: string, over: Partial<CloudBook> = {}): CloudBook => ({
  hash, file_name: `${hash}.epub`, format: 'epub', size: 1000, title: `Cloud ${hash}`, author: '', added_at: 100, progress: null, progress_at: 0, ...over,
});
const prog = (bookId: string, updatedAt: number, fraction = 0.5): ProgressRecord => ({ bookId, section: 3, sectionFraction: 0.25, fraction, updatedAt });

describe('account sync plan', () => {
  it('uploads what is only here and lists what is only in the account', () => {
    const plan = planSync([book('a', 'h1'), book('b', 'h2')], {}, [row('h2'), row('h3')]);
    expect(plan.upload.map((b) => b.id)).toEqual(['a']);
    expect(plan.remoteOnly.map((r) => r.hash)).toEqual(['h3']);
    expect(plan.tooLarge).toEqual([]);
  });

  it('keeps over-size and removed-from-account books on the device only', () => {
    const plan = planSync([book('a', 'h1', { size: MAX_UPLOAD_BYTES + 1 }), book('b', 'h2'), book('c', 'h3')], {}, [], ['h2']);
    expect(plan.tooLarge.map((b) => b.id)).toEqual(['a']);
    expect(plan.upload.map((b) => b.id)).toEqual(['c']);
  });

  it('sends the newer reading position in whichever direction it is newer', () => {
    const local = [book('a', 'h1'), book('b', 'h2'), book('c', 'h3'), book('d', 'h4')];
    const progress = { a: prog('a', 50_000), b: prog('b', 10_000), c: prog('c', 30_000) };
    const remote = [
      row('h1', { progress: { fraction: 0.1 }, progress_at: 20_000 }), // older in the account -> push
      row('h2', { progress: { fraction: 0.9 }, progress_at: 40_000 }), // newer in the account -> pull
      row('h3', { progress: { fraction: 0.5 }, progress_at: 30_500 }), // within clock skew -> leave
      row('h4', { progress: { fraction: 0.7 }, progress_at: 5_000 }),  // never opened here -> pull
    ];
    const plan = planSync(local, progress, remote);
    expect(plan.pushProgress.map((p) => p.hash)).toEqual(['h1']);
    expect(plan.pullProgress.map((p) => p.bookId)).toEqual(['b', 'd']);
    expect(plan.upload).toEqual([]);
  });

  it('round-trips a reading position through the account', () => {
    const b = book('a', 'h1');
    const r = toCloudRow(b, prog('a', 777, 0.42));
    expect(r).toMatchObject({ hash: 'h1', file_name: 'a.epub', title: 'Title a', author: 'A. Writer', progress_at: 777 });
    expect(r.progress).toEqual({ section: 3, sectionFraction: 0.25, fraction: 0.42 });
    expect(cloudProgress(prog('a', 1))).not.toHaveProperty('bookId');
    // on another device the same book has another local id
    expect(localProgress('other-id', r)).toEqual({ bookId: 'other-id', section: 3, sectionFraction: 0.25, fraction: 0.42, updatedAt: 777 });
    expect(localProgress('x', row('h', { progress: null }))).toBeNull();
    expect(localProgress('x', row('h', { progress: { fraction: Number.NaN } }))).toBeNull();
    expect(toCloudRow(b, undefined)).toMatchObject({ progress: null, progress_at: 0 });
  });

  it('stores each file under its owner, with a safe extension', () => {
    expect(storagePath('user-1', 'abc', 'My Book.EPUB')).toBe('user-1/abc.epub');
    expect(storagePath('user-1', 'abc', 'novel.fb2.zip')).toBe('user-1/abc.fb2.zip');
    expect(storagePath('user-1', 'abc', 'noextension')).toBe('user-1/abc.bin');
    expect(storagePath('user-1', 'abc', 'x.p/../d f')).toBe('user-1/abc.df');
  });

  it('explains sign-in errors in plain words', () => {
    expect(authMessage('Invalid login credentials')).toBe('Wrong email or password.');
    expect(authMessage('User already registered')).toMatch(/already has an account/);
    expect(authMessage('Email not confirmed')).toMatch(/confirmation link/);
    expect(authMessage('Network request failed')).toMatch(/No connection/);
    expect(authMessage('Something else')).toBe('Something else');
  });
});
