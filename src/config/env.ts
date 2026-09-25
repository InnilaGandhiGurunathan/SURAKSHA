/**
 * Typed access to build-time environment variables.
 *
 * Two facts drive everything in this file:
 *
 *  1. Vite only exposes variables whose name starts with `VITE_`, and it does so
 *     by rewriting the *literal* text `import.meta.env.VITE_SOMETHING` at build
 *     time. A value reached through a variable (`const env = import.meta.env`)
 *     is **not** rewritten, and in a production browser bundle `import.meta.env`
 *     does not exist at all — so a key read only dynamically works perfectly in
 *     `npm run dev` and silently disappears on Vercel. That asymmetry is the
 *     classic "it worked locally" bug, so every variable SURAKSHA depends on is
 *     read statically below.
 *  2. Because the value is frozen into the bundle, editing `.env` does nothing
 *     until the dev server is restarted.
 *
 * The dynamic snapshot is still collected: in dev it tells the debug panel which
 * `VITE_*` names actually arrived, which is how you spot a missing `VITE_`
 * prefix. Everything here tolerates `import.meta.env` being absent (Vitest, a
 * `node` script, SSR).
 */

export type EnvRecord = Record<string, string | boolean | undefined>;

/** Names SURAKSHA reads. Keep in sync with `types/env.d.ts`. */
export const STATIC_ENV_NAMES = [
  'VITE_GOOGLE_MAPS_API_KEY',
  'VITE_GOOGLE_MAPS_KEY',
  'VITE_GOOGLE_MAPS_KEY_ID',
  'VITE_GOOGLE_MAPS_MAP_ID',
  'VITE_GOOGLE_MAPS_ID',
  'MODE',
  'DEV',
  'PROD',
] as const;

/**
 * Literal member accesses only — never a loop over names, or Vite has nothing to
 * rewrite and the value is lost in production.
 */
function staticEnv(): EnvRecord {
  try {
    return {
      VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      VITE_GOOGLE_MAPS_KEY: import.meta.env.VITE_GOOGLE_MAPS_KEY,
      VITE_GOOGLE_MAPS_KEY_ID: import.meta.env.VITE_GOOGLE_MAPS_KEY_ID,
      VITE_GOOGLE_MAPS_MAP_ID: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
      VITE_GOOGLE_MAPS_ID: import.meta.env.VITE_GOOGLE_MAPS_ID,
      MODE: import.meta.env.MODE,
      DEV: import.meta.env.DEV,
      PROD: import.meta.env.PROD,
    };
  } catch {
    // No Vite env object (plain `node`, a worker, a non-Vite test runner).
    return {};
  }
}

/** The env object Vite injects in dev, or an empty record when absent. */
function dynamicEnv(): EnvRecord {
  try {
    const env = import.meta.env as unknown as EnvRecord | undefined;
    if (!env || typeof env !== 'object') return {};
    const out: EnvRecord = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merged view: statically injected values win, dev-only extras survive.
 * `undefined` entries are dropped so an absent static value cannot erase a
 * value the dynamic object has (which is how tests stub a variable).
 */
export function envSnapshot(): EnvRecord {
  const merged = dynamicEnv();
  for (const [name, value] of Object.entries(staticEnv())) {
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

export interface EnvVarReadout {
  /** The variable name we looked for. */
  name: string;
  /** The value Vite delivered, verbatim, or `undefined` when it never arrived. */
  value: string | undefined;
  /** True when the name exists in the bundle at all (even if empty). */
  declared: boolean;
}

/**
 * Read one variable by name.
 *
 * `declared` is deliberately separate from `value`: an empty
 * `VITE_GOOGLE_MAPS_API_KEY=` is declared-but-blank, which is a different
 * mistake from never having written it at all.
 */
export function readEnvVar(name: string): EnvVarReadout {
  const env = envSnapshot();
  const declared = Object.prototype.hasOwnProperty.call(env, name);
  const value = env[name];
  return {
    name,
    declared,
    value: typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : undefined,
  };
}

/**
 * Names of the variables that reached the client bundle — names only, never
 * values. Printed by the debug panel so a missing `VITE_` prefix is visible.
 */
export function envVarNames(prefix = 'VITE_'): string[] {
  return Object.keys(envSnapshot())
    .filter((name) => name.startsWith(prefix))
    .sort();
}

export function appMode(): string {
  const mode = envSnapshot().MODE;
  return typeof mode === 'string' && mode.length > 0 ? mode : 'unknown';
}

export function isDevBuild(): boolean {
  const env = envSnapshot();
  if (typeof env.DEV === 'boolean') return env.DEV;
  return appMode() === 'development';
}
