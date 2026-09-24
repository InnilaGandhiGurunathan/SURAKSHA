import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';

/**
 * Supabase is optional by design.
 *
 * SURAKSHA must work with no backend at all (that is the whole point of
 * offline-first), so this module returns `null` when the project is not
 * configured and every caller has a device-only path. When it *is* configured it
 * adds cross-device sign-in, server-side mirroring of the data the device
 * already owns, and the RBAC gate for the admin console.
 */

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!appEnv.supabaseConfigured) return null;
  if (!client) {
    client = createClient(appEnv.supabaseUrl, appEnv.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'suraksha.auth',
      },
      global: { headers: { 'x-application-name': 'suraksha-web' } },
    });
  }
  return client;
}

export function supabaseStatus(): { configured: boolean; note: string } {
  return appEnv.supabaseConfigured
    ? { configured: true, note: 'Supabase project configured; server sync and cross-device sign-in available.' }
    : {
        configured: false,
        note: 'No Supabase project configured. SURAKSHA is using device-only accounts — everything except cross-device sync still works.',
      };
}

export interface RemoteSession {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  email?: string;
  expiresAt?: string;
}

export async function currentRemoteSession(): Promise<RemoteSession | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors a device-owned record into Supabase. RLS policies in
 * `supabase/migrations` restrict every table to `auth.uid() = owner_id`, so this
 * is a normal authenticated upsert rather than a privileged write.
 */
export async function mirrorRow(table: string, row: Record<string, unknown>): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn(`[suraksha] mirror to ${table} failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[suraksha] mirror failed', error);
    return false;
  }
}

export async function fetchRemoteProfile(userId: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return data as Record<string, unknown> | null;
}
