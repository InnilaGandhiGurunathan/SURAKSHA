/**
 * Supabase client — lazy, config-driven.
 *
 * The app must boot fine *before* any project is linked (empty credentials),
 * with no network fan-out. `getSupabase()` throws when the project is not
 * configured; the auth service guards that path and falls back to local auth.
 * There is no build step bound to credentials, so a source checkout never
 * depends on them.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAuthConfigFromStorage } from './auth';
import { formatEmptyUrl, pickAnonOrEmptyString } from '../lib/supabaseEnv';

let cachedKey: string | null = null;
let cached: SupabaseClient | null = null;

function projectKey(): string {
  if (cachedKey) return cachedKey;
  const url = formatEmptyUrl(import.meta.env.VITE_SUPABASE_URL) || getAuthConfigFromStorage().url;
  const anon = pickAnonOrEmptyString(import.meta.env.VITE_SUPABASE_ANON_KEY) || getAuthConfigFromStorage().anonKey;
  if (!url || !anon) return '';
  cachedKey = `${url}::${anon}`;
  return cachedKey;
}

export function isSupabaseConfigured(): boolean {
  return projectKey().length > 0;
}

export function getSupabase(): SupabaseClient {
  const key = projectKey();
  if (!key) throw new Error('Supabase is not linked yet — paste project credentials from the Connect card.');
  if (cached && cachedKey === key) return cached;
  const url = key.split('::')[0];
  const anon = key.slice(url.length + 2);
  cached = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}

/** Used by the Connect dialog to preview what was saved (never the secret). */
export function supabaseConfigReadout(): { url: string; maskedAnon: string } {
  const url = formatEmptyUrl(import.meta.env.VITE_SUPABASE_URL) || getAuthConfigFromStorage().url;
  const anon = pickAnonOrEmptyString(import.meta.env.VITE_SUPABASE_ANON_KEY) || getAuthConfigFromStorage().anonKey;
  return { url, maskedAnon: anon ? `${anon.slice(0, 10)}…${anon.slice(-4)}` : '' };
}
