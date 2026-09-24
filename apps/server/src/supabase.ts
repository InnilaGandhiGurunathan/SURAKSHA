import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

/**
 * Server-side Supabase clients.
 *
 * - `getSupabaseAdmin()` uses the service-role key and **bypasses RLS**. It is
 *   only used to mirror what clients already wrote, and to serve the admin
 *   console. It must never be exposed to a browser.
 * - `getSupabaseAnon()` is used to validate a caller's bearer token when the
 *   client has a Supabase session, so privileged endpoints can require an
 *   authenticated admin/responder.
 */

let admin: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
  if (!admin) {
    admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export function getSupabaseAnon(): SupabaseClient | null {
  const key = config.supabaseAnonKey || config.supabaseServiceRoleKey;
  if (!config.supabaseUrl || !key) return null;
  if (!anon) {
    anon = createClient(config.supabaseUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anon;
}

export interface ServerAuthContext {
  userId?: string;
  email?: string;
  role?: string;
  /** True when the request could not be authenticated at all. */
  anonymous: boolean;
}

/** Resolves the caller from a Supabase bearer token or the local dev header. */
export async function resolveCaller(authorizationHeader?: string): Promise<ServerAuthContext> {
  const anonymous: ServerAuthContext = { anonymous: true };

  // Local-mode convenience: the client may send `x-suraksha-owner` when there is
  // no Supabase project. It is only trusted when Supabase is not configured.
  const client = getSupabaseAnon();
  if (!client) return anonymous;

  const token = authorizationHeader?.replace(/^Bearer\s+/i, '');
  if (!token) return anonymous;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return anonymous;

    let role = (data.user.user_metadata?.role as string | undefined) ?? 'user';
    const adminClient = getSupabaseAdmin();
    if (adminClient) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profile?.role) role = profile.role as string;
    }

    return { userId: data.user.id, email: data.user.email ?? undefined, role, anonymous: false };
  } catch {
    return anonymous;
  }
}

export function requireRole(context: ServerAuthContext, roles: string[]): boolean {
  return !context.anonymous && Boolean(context.role) && roles.includes(context.role as string);
}
