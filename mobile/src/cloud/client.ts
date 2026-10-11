// The account server (Supabase: sign-in, a table of each person's books, and private file storage).
// The address and the public key come from EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY; without them
// the app works exactly as before, fully offline, and the account screen says sync is not set up.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRepo } from '../state/repo';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

export const cloudConfigured = /^https:\/\/.+/.test(URL) && KEY.length > 20;
export const BUCKET = 'books';

// The session is kept in the app's own database, next to the library.
const storage = {
  async getItem(key: string): Promise<string | null> {
    return (await (await getRepo()).getKV(`auth:${key}`)) || null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await (await getRepo()).setKV(`auth:${key}`, value);
  },
  async removeItem(key: string): Promise<void> {
    await (await getRepo()).setKV(`auth:${key}`, '');
  },
};

let client: SupabaseClient | null = null;
export function cloud(): SupabaseClient {
  if (!cloudConfigured) throw new Error('Account sync is not set up in this build.');
  client ??= createClient(URL, KEY, { auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
  return client;
}
