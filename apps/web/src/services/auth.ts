import type { UserProfile, UserRole } from '@suraksha/shared';
import { DEFAULT_EMERGENCY_PROFILE, DEFAULT_SAFETY_RULES } from '@/lib/constants';
import { deriveVerifier, safeEqual, generateShareKey, subtleAvailable } from '@/lib/crypto';
import { db, getSetting, setSetting, SETTING_KEYS, type SessionRecord } from '@/lib/db';
import { uuid } from '@/lib/id';
import { getSupabase, currentRemoteSession, type RemoteSession } from './supabase';

/**
 * Authentication with two modes and one rule.
 *
 * **Deferred requirement rule:** internet is needed for *first-time setup* only,
 * so accounts must be able to exist on the device alone. When Supabase is
 * configured the user can sign in to a real project account; when it is not (or
 * when the traveller is offline), a device account is created with PBKDF2-
 * hashed credentials stored locally. Both modes end up as a `UserProfile` in
 * IndexedDB, and every feature except cross-device sync behaves identically.
 */

export interface AuthResult {
  user: UserProfile;
  mode: 'device' | 'remote';
}

export class AuthError extends Error {
  code: 'invalid_credentials' | 'email_taken' | 'weak_password' | 'offline' | 'unsupported' | 'unknown';
  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const MIN_PASSWORD_LENGTH = 8;

function baseProfile(input: {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  deviceOnly?: boolean;
}): UserProfile {
  const now = new Date().toISOString();
  return {
    id: input.id,
    fullName: input.fullName.trim(),
    email: input.email?.trim().toLowerCase(),
    phone: input.phone?.trim(),
    role: input.role ?? 'traveller',
    deviceOnly: input.deviceOnly ?? false,
    emergency: { ...DEFAULT_EMERGENCY_PROFILE, updatedAt: now },
    rules: { ...DEFAULT_SAFETY_RULES },
    createdAt: now,
    updatedAt: now,
  };
}

export async function registerWithDevice(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  role?: UserRole;
}): Promise<AuthResult> {
  if (!subtleAvailable()) {
    throw new AuthError(
      'unsupported',
      'This browser cannot store credentials securely (secure context required). Open SURAKSHA over HTTPS or localhost, or sign in with a configured Supabase project.',
    );
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('weak_password', `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  }

  const email = input.email.trim().toLowerCase();
  const existing = await db.users.where('email').equals(email).first();
  if (existing) {
    throw new AuthError('email_taken', 'An account already exists on this device for that email address.');
  }

  const user = baseProfile({
    id: uuid(),
    fullName: input.fullName,
    email,
    phone: input.phone,
    role: input.role,
    deviceOnly: true,
  });
  await db.users.put(user);

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = btoa(String.fromCharCode(...saltBytes));
  const verifier = await deriveVerifier(input.password, saltBytes);

  const session: SessionRecord = {
    id: uuid(),
    userId: user.id,
    mode: 'device',
    salt,
    verifier,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  await db.sessions.put(session);
  await setSetting(SETTING_KEYS.session, session.id);

  return { user, mode: 'device' };
}

export async function signInWithDevice(email: string, password: string): Promise<AuthResult> {
  const user = await db.users.where('email').equals(email.trim().toLowerCase()).first();
  if (!user) {
    throw new AuthError('invalid_credentials', 'No account on this device matches that email address.');
  }
  const session = await db.sessions.where('userId').equals(user.id).first();
  if (!session) {
    throw new AuthError('invalid_credentials', 'This account has no local credentials. Create it again or sign in online.');
  }

  const saltBytes = Uint8Array.from(atob(session.salt), (char) => char.charCodeAt(0));
  const verifier = await deriveVerifier(password, saltBytes);
  if (!safeEqual(verifier, session.verifier)) {
    throw new AuthError('invalid_credentials', 'That password does not match. Passwords cannot be recovered — only reset.');
  }

  session.lastActiveAt = new Date().toISOString();
  await db.sessions.put(session);
  await setSetting(SETTING_KEYS.session, session.id);

  return { user, mode: 'device' };
}

export async function signInWithSupabase(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new AuthError(
      'offline',
      'No Supabase project is configured, so online sign-in is unavailable. Use a device account instead — it works with no internet.',
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new AuthError('invalid_credentials', error?.message ?? 'Sign-in was rejected.');
  }

  const remote = await currentRemoteSession();
  return { user: await upsertRemoteUser(data.user.id, data.user.email ?? email, data.user.user_metadata, remote), mode: 'remote' };
}

export async function registerWithSupabase(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  role?: UserRole;
}): Promise<AuthResult & { needsEmailConfirmation: boolean }> {
  const supabase = getSupabase();
  if (!supabase) {
    const result = await registerWithDevice(input);
    return { ...result, needsEmailConfirmation: false };
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName, phone: input.phone, role: input.role ?? 'traveller' },
    },
  });

  if (error || !data.user) {
    throw new AuthError('unknown', error?.message ?? 'Registration failed.');
  }

  const user = await upsertRemoteUser(data.user.id, input.email, {
    full_name: input.fullName,
    phone: input.phone,
    role: input.role ?? 'traveller',
  }, await currentRemoteSession());

  return {
    user,
    mode: 'remote',
    needsEmailConfirmation: !data.session,
  };
}

async function upsertRemoteUser(
  id: string,
  email: string | undefined,
  metadata: Record<string, unknown> | undefined,
  remote: RemoteSession | null,
): Promise<UserProfile> {
  const existing = await db.users.get(id);
  const now = new Date().toISOString();

  const profile: UserProfile = existing
    ? {
        ...existing,
        email: email ?? existing.email,
        deviceOnly: false,
        updatedAt: now,
      }
    : baseProfile({
        id,
        fullName: (metadata?.full_name as string) ?? email?.split('@')[0] ?? 'Traveller',
        email,
        phone: metadata?.phone as string | undefined,
        role: (metadata?.role as UserRole) ?? 'traveller',
        deviceOnly: false,
      });

  await db.users.put(profile);

  if (remote) {
    const session: SessionRecord = {
      id: uuid(),
      userId: profile.id,
      mode: 'remote',
      salt: '',
      verifier: '',
      accessToken: remote.accessToken,
      refreshToken: remote.refreshToken,
      expiresAt: remote.expiresAt,
      createdAt: now,
      lastActiveAt: now,
    };
    // One remote session per user on this device.
    const stale = await db.sessions.where('userId').equals(profile.id).toArray();
    await db.sessions.bulkDelete(stale.filter((item) => item.mode === 'remote').map((item) => item.id));
    await db.sessions.put(session);
    await setSetting(SETTING_KEYS.session, session.id);
  }

  return profile;
}

export async function currentUser(): Promise<UserProfile | null> {
  const sessionId = await getSetting<string>(SETTING_KEYS.session);
  if (!sessionId) return null;
  const session = await db.sessions.get(sessionId);
  if (!session) return null;
  return (await db.users.get(session.userId)) ?? null;
}

export async function currentAccessToken(): Promise<string | null> {
  const sessionId = await getSetting<string>(SETTING_KEYS.session);
  if (!sessionId) return null;
  const session = await db.sessions.get(sessionId);
  if (!session) return null;

  if (session.mode === 'remote') {
    // Refresh through Supabase so an expired session is renewed rather than
    // silently degrading into "not signed in".
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) return data.session.access_token;
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.data.session?.access_token ?? session.accessToken ?? null;
    }
    return session.accessToken ?? null;
  }
  return null;
}

export async function signOut(): Promise<void> {
  const sessionId = await getSetting<string>(SETTING_KEYS.session);
  if (sessionId) {
    const session = await db.sessions.get(sessionId);
    if (session?.mode === 'remote') {
      await getSupabase()?.auth.signOut().catch(() => undefined);
      await db.sessions.delete(sessionId);
    }
    // Device sessions stay on the device: signing out does not delete the data,
    // and re-signing in with the same password brings everything back.
  }
  await setSetting(SETTING_KEYS.session, null);
  await rotateSupabaseClientKey();
}

/**
 * Generates the per-device key used for at-rest encryption of sensitive fields
 * (emergency notes). Kept in a separate settings row so it can be destroyed with
 * the erase-all action.
 */
export async function ensureDeviceKey(): Promise<string> {
  const existing = await getSetting<string>('deviceKey');
  if (existing) return existing;
  const { encoded } = await generateShareKey();
  await setSetting('deviceKey', encoded);
  return encoded;
}

async function rotateSupabaseClientKey(): Promise<void> {
  // Nothing to rotate in device mode; kept as an explicit hook so remote sign-out
  // is a single code path.
}

export async function resetDeviceAccount(email: string): Promise<boolean> {
  const user = await db.users.where('email').equals(email.trim().toLowerCase()).first();
  if (!user) return false;
  await db.transaction('rw', [db.users, db.sessions], async () => {
    await db.users.delete(user.id);
    const sessions = await db.sessions.where('userId').equals(user.id).toArray();
    await db.sessions.bulkDelete(sessions.map((session) => session.id));
  });
  return true;
}
