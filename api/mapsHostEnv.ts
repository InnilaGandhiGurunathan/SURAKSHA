/**
 * Host-environment lookup for the Google Maps key.
 *
 * Lives next to the Vercel function on purpose: the function builder bundles
 * siblings of `api/`, and a key saved in the dashboard has to be readable here
 * even when Vite did not inline it.
 *
 * Vite only inlines `VITE_*` values that exist when `vite build` runs. On
 * Vercel that is a different moment from "the variable is saved in Project
 * Settings": a Sensitive/runtime-only variable, a value added after the last
 * build, or a name without the `VITE_` prefix all show up in the dashboard and
 * then never appear in the website.
 *
 * This reader never returns anything except the maps key and the optional Map ID.
 */

export const MAPS_KEY_ENV_NAMES = [
  'VITE_GOOGLE_MAPS_API_KEY',
  'VITE_GOOGLE_MAPS_KEY',
  'VITE_GOOGLE_MAPS_KEY_ID',
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_KEY',
  'REACT_APP_GOOGLE_MAPS_API_KEY',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
] as const;

export const MAPS_ID_ENV_NAMES = [
  'VITE_GOOGLE_MAPS_MAP_ID',
  'VITE_GOOGLE_MAPS_ID',
  'GOOGLE_MAPS_MAP_ID',
  'GOOGLE_MAPS_ID',
] as const;

export const MAPS_CONFIG_PATH = '/api/maps-config';

export interface MapsHostConfig {
  key: string | null;
  mapId: string | null;
  /** The variable the key was found under, so the debug panel can name it. */
  envName: string | null;
  mapIdEnvName: string | null;
}

export type EnvLike = Record<string, string | undefined>;

/**
 * Trim, and drop one layer of wrapping quotes. Vercel (and a copy-paste into
 * the dashboard) often stores `"AIza…"` with the quotes included; Google then
 * rejects a key that the dashboard swears is set.
 */
export function normalizeMapsCredential(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let next = value.trim();
  if (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'")))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next.length > 0 ? next : null;
}

function firstNamed(env: EnvLike, names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = normalizeMapsCredential(env[name]);
    if (value) return { name, value };
  }
  return null;
}

/** The maps key the host process can see right now. Empty slots are skipped. */
export function readMapsConfigFromEnv(env: EnvLike): MapsHostConfig {
  const key = firstNamed(env, MAPS_KEY_ENV_NAMES);
  const mapId = firstNamed(env, MAPS_ID_ENV_NAMES);
  return {
    key: key?.value ?? null,
    mapId: mapId?.value ?? null,
    envName: key?.name ?? null,
    mapIdEnvName: mapId?.name ?? null,
  };
}
