/**
 * Auth store — a tiny external store beside the simulation store.
 *
 * The main SurakshaStore stays purely about the safety simulation; auth is a
 * cross-cutting layer (sign-in gates the app, the connected account appears in
 * the shell). It persists only the local auth fixture + Supabase project
 * settings, never a secret.
 */

import { useSyncExternalStore } from 'react';
import type { AuthConfig, AuthState, AuthUser } from '@/domain/types';
import {
  getAuthUser,
  saveAuthConfig,
  saveAuthUser,
  clearAuth,
  resolveAuthState,
} from '@/services/auth';

/** Landing page shows first only for signed-out, first-time visitors. */
export type LandingGate = 'landing' | 'app' | 'demo';

const LANDING_VISIT_KEY = 'suraksha.v1.landingVisited';

/**
 * The landing (Welcome) is the first thing a fresh visitor sees at `/`. Once
 * someone enters the app — sign-in, or "Open SURAKSHA" — their choice is
 * remembered so a reload does not bounce them back to the marketing page.
 */
function readLandingPreference(): boolean {
  try {
    return window.localStorage.getItem(LANDING_VISIT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLandingVisited(): void {
  try {
    window.localStorage.setItem(LANDING_VISIT_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function landingGateFor(user: AuthUser | null): LandingGate {
  if (user) return 'app';
  if (readLandingPreference()) return 'demo';
  return 'landing';
}

class AuthStore {
  private state: AuthState = resolveAuthState();
  private user: AuthUser | null = getAuthUser();
  private listeners = new Set<() => void>();

  getState = (): AuthState => this.state;
  getUser = (): AuthUser | null => this.user;
  /** Any session counts — the local fixture is a real (demonstrated) sign-in. */
  isSignedIn = (): boolean => Boolean(this.user);
  /** True only for a Supabase-backed identity. */
  isRealAuth = (): boolean => Boolean(this.user && !this.user.isPlaceholder);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: Partial<AuthState>): void {
    this.state = { ...this.state, ...state };
    this.listeners.forEach((l) => l());
  }

  /** Called once on boot (and on the Connect dialog save). */
  refresh(): void {
    this.state = resolveAuthState();
    this.user = getAuthUser();
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  /** Sign in — async because the real path may hit Supabase. */
  async signIn(email: string): Promise<'supabase' | 'local' | 'error'> {
    this.set({ resolving: true });
    try {
      const { trySupabaseAuth, makeLocalUser } = await import('@/services/auth');
      const status = await trySupabaseAuth(email);
      if (status === 'supabase') {
        this.set({ pendingMagicLink: true, magicLinkEmail: email, resolving: false });
        this.user = null;
        return 'supabase';
      }
      if (status === 'local') {
        const user = makeLocalUser(email);
        this.user = user;
        saveAuthUser(user);
        this.set({ pendingMagicLink: false, magicLinkEmail: null, resolving: false });
        this.emit();
        return 'local';
      }
      this.set({ resolving: false });
      return 'error';
    } catch {
      this.set({ resolving: false });
      return 'error';
    }
  }

  /** Complete an OTP round-trip the Supabase hash handler kicked off. */
  async completeMagicLink(): Promise<'supabase' | 'local' | 'error'> {
    try {
      const { resolveMagicLink } = await import('@/services/auth');
      const status = await resolveMagicLink();
      if (status === 'supabase' || status === 'local' || status === 'error') {
        if (status === 'supabase') {
          this.user = getAuthUser();
          this.set({ pendingMagicLink: false, magicLinkEmail: null });
          this.emit();
        }
        return status;
      }
      return 'error';
    } catch {
      return 'error';
    }
  }

  /** OAuth sign-in. Falls back to the local fixture when Supabase is absent. */
  async socialSignIn(provider: 'google' | 'github'): Promise<'supabase' | 'local' | 'error'> {
    try {
      const { resolveAuthState, makeLocalUser } = await import('@/services/auth');
      const config = resolveAuthState().config;
      if (!config.configured) {
        const email = `${provider}@demo.suraksha.local`;
        this.user = makeLocalUser(email);
        saveAuthUser(this.user);
        this.emit();
        return 'local';
      }
      const { getSupabase } = await import('@/services/supabase');
      const { data, error } = await getSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
      });
      if (error) return 'error';
      // Browser will navigate to the provider; Supabase completes on return.
      if (data.url && typeof window !== 'undefined') window.location.href = data.url;
      return 'supabase';
    } catch {
      return 'error';
    }
  }

  /** Danger: fully reset the local auth so a judge can re-live the flow. */
  signOut(): void {
    clearAuth();
    this.user = null;
    this.set({ pendingMagicLink: false, magicLinkEmail: null });
    this.emit();
  }

  saveConfig(config: AuthConfig): void {
    saveAuthConfig(config);
    this.refresh();
  }

  resetLocalAuth(): void {
    clearAuth();
    this.refresh();
  }
}

export const authStore = new AuthStore();

export function useAuth(): {
  state: AuthState;
  user: AuthUser | null;
  signedIn: boolean;
  realAuth: boolean;
} {
  const state = useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
  const user = useSyncExternalStore(authStore.subscribe, authStore.getUser, authStore.getUser);
  return { state, user, signedIn: Boolean(user), realAuth: Boolean(user && !user.isPlaceholder) };
}
