/**
 * Runtime configuration.
 *
 * Every external service is optional. When a variable is missing the app says so
 * in the UI (Settings → Diagnostics) instead of failing silently, and falls back
 * to a fully local, offline-capable mode.
 */

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseConfigured: boolean;
  apiBaseUrl: string;
  tileUrlTemplate: string;
  tileAttribution: string;
  routingBaseUrl: string;
  fallbackReportUrl: string;
  enableDemoMode: boolean;
  supportEmail: string;
}

const env = import.meta.env;

export const appEnv: AppEnv = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  supabaseConfigured: Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY),
  apiBaseUrl: (env.VITE_API_BASE_URL as string | undefined) ?? '/api',
  tileUrlTemplate:
    (env.VITE_TILE_URL_TEMPLATE as string | undefined) ??
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution:
    (env.VITE_TILE_ATTRIBUTION as string | undefined) ?? '© OpenStreetMap contributors',
  routingBaseUrl: (env.VITE_ROUTING_BASE_URL as string | undefined) ?? 'https://router.project-osrm.org',
  fallbackReportUrl: (env.VITE_FALLBACK_REPORT_URL as string | undefined) ?? '/report-site',
  enableDemoMode: (env.VITE_ENABLE_DEMO_MODE as string | undefined) !== 'false',
  supportEmail: (env.VITE_SUPPORT_EMAIL as string | undefined) ?? 'support@suraksha.app',
};

export function integrationSummary(): Array<{ name: string; configured: boolean; note: string }> {
  return [
    {
      name: 'Supabase',
      configured: appEnv.supabaseConfigured,
      note: appEnv.supabaseConfigured
        ? 'Sign-in, server-side mirroring and the admin console are available.'
        : 'Not configured — SURAKSHA is running in device-only mode. Everything except cross-device sync works offline.',
    },
    {
      name: 'Reporting server',
      configured: true,
      note: `Incident reports and alerts are sent to ${appEnv.apiBaseUrl}. Without it, reports stay queued on this device and are shown as such.`,
    },
    {
      name: 'Map tiles',
      configured: Boolean(appEnv.tileUrlTemplate),
      note: appEnv.tileUrlTemplate.includes('openstreetmap')
        ? 'Using the public OpenStreetMap tile server. For production, point VITE_TILE_URL_TEMPLATE at your own tile host.'
        : 'Custom tile host configured.',
    },
    {
      name: 'Routing service',
      configured: Boolean(appEnv.routingBaseUrl),
      note: 'Used to fetch a road route while online. Offline, the app draws a straight-line corridor and says so.',
    },
    {
      name: 'SMS gateway',
      configured: false,
      note: 'Optional. Without a gateway configured on the server, urgent alerts use the on-device SMS handoff and never claim delivery.',
    },
  ];
}
