/**
 * Authentication service.
 *
 * SURAKSHA runs as a local-first prototype, so auth is layered:
 *   1. If a Supabase project is linked (via the Connect dialog or build env),
 *      email + OTP and reads go through Supabase Auth.
 *   2. Otherwise the app falls back to **local auth**: an email fixture that is
 *      stored only on this device. Nothing here pretends that a local sign-in
 *      is a real identity check — the UI is honest about which path is active.
 *
 * Keys kept at rest are only ever the Supabase *project URL* and the *public
 * anon key* (by design not a secret). Stored under `suraksha.v1.auth`.
 */

import type { AuthConfig, AuthState, AuthUser } from '@/domain/types';
import { formatEmptyUrl, pickAnonOrEmptyString } from '@/lib/supabaseEnv';

interface PersistedAuth {
  version: 1;
  config: AuthConfig;
  user: AuthUser | null;
}

export type AuthStatus = 'none' | 'pending' | 'checking' | 'supabase' | 'local' | 'error';

export type AuthAttempt = 'supabase' | 'local' | 'error';

const EMPTY_CONFIG: AuthConfig = {
  url: '',
  anonKey: '',
  configured: false,
  checkExplicit: true,
  statusMessage: null,
};

const DEFAULT_AUTH_STATE: AuthState = {
  config: EMPTY_CONFIG,
  pendingMagicLink: false,
  magicLinkEmail: null,
  resolving: false,
};

function envConfig(state: AuthConfig): AuthConfig {
  const url = formatEmptyUrl(import.meta.env.VITE_SUPABASE_URL);
  const anon = pickAnonOrEmptyString(import.meta.env.VITE_SUPABASE_ANON_KEY);
  return url && anon ? { ...state, url, anonKey: anon, configured: true } : state;
}

const SLOT = 'suraksha.v1.auth';

function readSlot(): PersistedAuth | null {
  try {
    const raw = window.localStorage.getItem(SLOT);
    return raw ? (JSON.parse(raw) as PersistedAuth) : null;
  } catch {
    return null;
  }
}

function writeSlot(slot: PersistedAuth): void {
  try {
    window.localStorage.setItem(SLOT, JSON.stringify(slot));
  } catch {
    /* best effort */
  }
}

function clearSlot(): void {
  try {
    window.localStorage.removeItem(SLOT);
  } catch {
    /* ignore */
  }
}

export function getAuthConfigFromStorage(): AuthConfig {
  const slot = readSlot();
  return slot?.config ?? EMPTY_CONFIG;
}

function buildConfig(): AuthConfig {
  const stored = getAuthConfigFromStorage();
  const merged: AuthConfig = {
    ...stored,
    url: stored.url || '',
    anonKey: stored.anonKey || '',
    configured: Boolean(stored.configured && stored.url && stored.anonKey),
  };
  return envConfig(merged);
}

/** Derive the app's auth surface from whatever is configured + persisted. */
export function resolveAuthState(): AuthState {
  const config = buildConfig();
  const slot = readSlot();
  const user = slot?.user ?? null;
  return {
    config,
    pendingMagicLink: false,
    magicLinkEmail: null,
    resolving: user ? Boolean(user.isPlaceholder) : false,
  };
}

function renovateUser(raw: AuthUser | null): AuthUser | null {
  if (!raw) return null;
  if (raw.isPlaceholder && Date.now() - raw.lastSignInAt > 3 * 60_000) return null;
  return raw;
}

export function getAuthUser(): AuthUser | null {
  const slot = readSlot();
  return renovateUser(slot?.user ?? null);
}

export function saveAuthUser(user: AuthUser | null): void {
  const slot = readSlot() ?? { version: 1, config: buildConfig(), user: null };
  if (!slot.config || !slot.config.url) slot.config = buildConfig();
  slot.user = user;
  writeSlot(slot);
}

export function saveAuthConfig(config: AuthConfig): void {
  const slot = readSlot() ?? { version: 1, config: buildConfig(), user: null };
  slot.config = { ...config, configured: Boolean(config.url && config.anonKey) };
  writeSlot(slot);
}

export function clearAuth(): void {
  clearSlot();
}

/**
 * Try to send a real Supabase OTP. When the project isn't linked — the common
 * case for a source checkout — this returns `local` so the caller falls back
 * to the on-device fixture (and the UI says so plainly).
 */
export async function trySupabaseAuth(email: string): Promise<AuthAttempt> {
  const config = buildConfig();
  if (!config.configured) return 'local';
  try {
    const { getSupabase } = await import('./supabase');
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) return 'error';
    return 'supabase';
  } catch {
    return 'error';
  }
}

/** Parse the OTP hash Supabase redirects back with (access + refresh tokens). */
export async function resolveMagicLink(): Promise<AuthAttempt> {
  const config = buildConfig();
  if (!config.configured) return 'local';
  try {
    const { getSupabase } = await import('./supabase');
    const sb = getSupabase();
    const { data, error } = await sb.auth.getSession();
    if (error || !data.session) return 'error';
    const u = data.session.user;
    const user: AuthUser = {
      id: u.id,
      email: u.email ?? emailFromId(u.id),
      provider: providerFrom(u.app_metadata?.provider),
      name: u.user_metadata?.full_name ?? u.email?.split('@')[0] ?? 'Traveller',
      avatarUrl: u.user_metadata?.avatar_url ?? null,
      isPlaceholder: false,
      lastSignInAt: Date.now(),
    };
    saveAuthUser(user);
    return 'supabase';
  } catch {
    return 'error';
  }
}

export function logoutUser(): void {
  clearAuth();
}

function emailFromId(id: string): string {
  return `${id.slice(0, 8)}@suraksha.local`;
}

function providerFrom(raw: unknown): 'email' | 'google' | 'github' | 'magic_link' {
  if (raw === 'google') return 'google';
  if (raw === 'github') return 'github';
  return 'email';
}

/** Redirect URL for the OTP flow (same origin, hash-based). */
export function redirectUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

/** Local fallback user factory (demo path). */
export function makeLocalUser(email: string): AuthUser {
  return {
    id: `local-${btoa(email.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 16)}`,
    email,
    provider: 'email',
    name: email.split('@')[0].replace(/[._-]+/g, ' ') || 'Traveller',
    avatarUrl: null,
    isPlaceholder: true,
    lastSignInAt: Date.now(),
  };
}

export const authSelectors = {
  configured(state: AuthState): boolean {
    return state.config.configured;
  },
  displayEmail(user: AuthUser | null): string | null {
    return user?.email ?? null;
  },
};

export { DEFAULT_AUTH_STATE };
