import 'dotenv/config';
import path from 'node:path';

/**
 * Server configuration.
 *
 * The reporting server runs in two modes:
 *  - **Supabase-backed** (recommended): set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *    and every record is mirrored into Postgres with the RLS policies from
 *    `supabase/migrations`. This is what makes the guardian dashboards and the
 *    admin console real.
 *  - **Local store** (default for development/hackathons): records are written to
 *    JSON files under `SURAKSHA_DATA_DIR`. Everything works end-to-end, including
 *    the 30-second acknowledgement contract, with no external dependency.
 */

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  version: '1.0.0',

  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',

  dataDir: process.env.SURAKSHA_DATA_DIR ?? path.resolve(process.cwd(), 'var'),
  /** Directory holding the built web app, served by this process in production. */
  webDistDir: process.env.SURAKSHA_WEB_DIST ?? path.resolve(process.cwd(), 'apps/web/dist'),

  /** Public URL of the fallback reporting website, used in API responses. */
  fallbackReportUrl: process.env.FALLBACK_REPORT_URL ?? '/report-site',

  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** Optional SMS gateway (Twilio-compatible) for server-side SMS alerts. */
  smsGatewayUrl: process.env.SMS_GATEWAY_URL ?? '',
  smsGatewayToken: process.env.SMS_GATEWAY_TOKEN ?? '',
  smsSenderId: process.env.SMS_SENDER_ID ?? '',

  /**
   * Local-only responder console access.
   *
   * When Supabase is not configured there is no way to authenticate a responder,
   * so the admin endpoints would be unreachable in a laptop demo. Setting this to
   * `true` allows them **only** while Supabase is absent, and every admin
   * response says so. It is ignored the moment Supabase credentials exist.
   */
  allowLocalAdmin: (process.env.SURAKSHA_ALLOW_LOCAL_ADMIN ?? '').toLowerCase() === 'true',

  /** Prototype risk weights, shared so the server can echo and audit them. */
  reporting: {
    ackTimeoutSeconds: 30,
  },
} as const;

export const supabaseEnabled = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
export const demoModeAllowed = (process.env.ENABLE_DEMO_MODE ?? 'true') !== 'false';

/**
 * True when the responder console may be opened without a Supabase session.
 * Never allowed once Supabase is configured, so a real deployment cannot be
 * unlocked by an environment variable alone.
 */
export const localAdminAllowed = config.allowLocalAdmin && !supabaseEnabled;
