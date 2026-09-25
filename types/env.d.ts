/**
 * Ambient types for the build-time environment.
 *
 * Lives outside `src/` on purpose: `.gitignore` excludes emitted declaration
 * files under `src` (a guard against `tsc -b` writing build output next to the
 * sources), so a hand-written `.d.ts` there would silently never be committed.
 *
 * Vite exposes only `VITE_`-prefixed variables to browser code and freezes them
 * at build time — editing `.env` therefore needs a dev-server restart.
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps JavaScript API key. Optional: without it the map stays simulated. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Accepted aliases, so an older name keeps working. */
  readonly VITE_GOOGLE_MAPS_KEY?: string;
  readonly VITE_GOOGLE_MAPS_KEY_ID?: string;
  /** Optional Maps JavaScript API Map ID (vector maps / advanced markers only). */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
  readonly VITE_GOOGLE_MAPS_ID?: string;
  /** Supabase project URL, e.g. https://abcd1234.supabase.co (public). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / public key (never the service_role secret). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
