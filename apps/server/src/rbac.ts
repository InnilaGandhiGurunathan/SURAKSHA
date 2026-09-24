import type { Request, Response } from 'express';
import { localAdminAllowed, supabaseEnabled } from './config.js';
import { resolveCaller, requireRole } from './supabase.js';

/**
 * Role-based access control for the response console.
 *
 * Two independent checks, and both must pass for the *client* to be useful:
 *  - the web app hides `/app/admin` from traveller accounts (cosmetic only);
 *  - every `/admin/*` endpoint calls this helper, which verifies the Supabase
 *    bearer token and reads the caller's role from `profiles`.
 *
 * The single exception is a Supabase-less local deployment with
 * `SURAKSHA_ALLOW_LOCAL_ADMIN=true`. There is no identity to verify in that mode,
 * so the response says so explicitly rather than pretending the caller was
 * authorised — and the flag is ignored as soon as Supabase is configured.
 */

export const RESPONDER_ROLES = ['admin', 'responder'] as const;

export interface ResponderAuth {
  authorised: boolean;
  /** How the caller was authorised: a real session, or the documented local mode. */
  via: 'session' | 'local-mode' | 'none';
  userId?: string;
  role?: string;
}

export async function authoriseResponder(req: Request): Promise<ResponderAuth> {
  const caller = await resolveCaller(req.headers.authorization);
  if (requireRole(caller, [...RESPONDER_ROLES])) {
    return { authorised: true, via: 'session', userId: caller.userId, role: caller.role };
  }
  if (localAdminAllowed) {
    return { authorised: true, via: 'local-mode' };
  }
  return { authorised: false, via: 'none', userId: caller.userId, role: caller.role };
}

/**
 * Guards an admin route. Returns `true` when the request may continue; otherwise
 * it has already written an explanatory 403 and the handler must stop.
 */
export async function requireResponder(req: Request, res: Response): Promise<boolean> {
  const auth = await authoriseResponder(req);
  if (auth.authorised) {
    res.setHeader('x-suraksha-auth-via', auth.via);
    return true;
  }

  res.status(403).json({
    ok: false,
    code: 'forbidden',
    error: supabaseEnabled
      ? 'Responder or administrator role required. Sign in with a Supabase account whose profile role is responder or admin.'
      : 'No Supabase project is configured, so responder access cannot be verified. Set SURAKSHA_ALLOW_LOCAL_ADMIN=true to enable the console for a local demonstration, or configure Supabase for real role-based access.',
  });
  return false;
}

/** Included in admin responses so the console can display which mode is active. */
export function responderAuthNote(auth: ResponderAuth): string {
  return auth.via === 'local-mode'
    ? 'Responder access is being granted by local demonstration mode (no Supabase configured). Do not expose this deployment to the internet.'
    : `Responder access verified from a Supabase session${auth.role ? ` with role “${auth.role}”` : ''}.`;
}
