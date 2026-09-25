/**
 * Google Maps key resolution and self-checks.
 *
 * Where the key comes from, in the order the app actually looks:
 *
 *   1. `window.__SURAKSHA_GOOGLE_MAPS_KEY__`  — set at runtime by the host
 *      page (Vercel preview, a harness, the debug panel). Wins, so a live demo
 *      can be fixed without a rebuild.
 *   2. `sessionStorage['suraksha.maps.key']`  — pasted into the in-app debug
 *      panel. Deliberately *session* and not *local* storage: an API key must
 *     not outlive the tab in a shared browser, and it also means SURAKSHA's
 *      state snapshot never carries a secret.
 *   3. `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` — the normal, committed path.
 *
 * Nothing here throws and nothing logs a full key. `maskKey()` is the only
 * function allowed to produce a printable representation.
 */

import { readEnvVar } from './env';

/** The variable the README tells you to set. */
export const GOOGLE_MAPS_KEY_VAR = 'VITE_GOOGLE_MAPS_API_KEY';

/** Accepted aliases, checked in order, so an older name keeps working. */
export const GOOGLE_MAPS_KEY_VARS = [GOOGLE_MAPS_KEY_VAR, 'VITE_GOOGLE_MAPS_KEY', 'VITE_GOOGLE_MAPS_KEY_ID'] as const;

/** Map IDs are optional (raster tiles work without one) but avoid a console warning. */
export const GOOGLE_MAPS_ID_VARS = ['VITE_GOOGLE_MAPS_MAP_ID', 'VITE_GOOGLE_MAPS_ID'] as const;

/** The documented Maps JS API script host. */
export const GOOGLE_MAPS_SCRIPT = 'https://maps.googleapis.com/maps/api/js';

/** sessionStorage slot for the in-app, this-tab-only override. */
export const SESSION_KEY_SLOT = 'suraksha.maps.key';
export const SESSION_ID_SLOT = 'suraksha.maps.mapId';

/** Window globals for host pages that cannot set build-time env vars. */
export const WINDOW_KEY_GLOBAL = '__SURAKSHA_GOOGLE_MAPS_KEY__';
export const WINDOW_MAP_ID_GLOBAL = '__SURAKSHA_GOOGLE_MAPS_MAP_ID__';

export type KeySource = 'window' | 'session' | 'env' | null;

export interface KeyResolution {
  /** The key, trimmed. `null` when nothing usable was found. */
  value: string | null;
  /** The value exactly as found, before trimming — used to catch whitespace. */
  raw: string | null;
  source: KeySource;
  /** The env var the value came from, when `source === 'env'`. */
  envName: string | null;
  /** Env vars that were looked for and are missing — printed in the debug readout. */
  lookedFor: string[];
}

export type KeyVerdict = 'ok' | 'suspicious' | 'placeholder' | 'missing';

export interface KeyInspection {
  verdict: KeyVerdict;
  /** Safe to hand to the Maps API and try to load. */
  usable: boolean;
  /** One-line, human readable — shown verbatim in the UI. */
  message: string;
  /** What to do about it, when the verdict is anything but `ok`. */
  hint: string;
  /** Non-fatal things worth mentioning (whitespace, length, restrictions). */
  warnings: string[];
  length: number;
  /** 39 chars starting with `AIza` is the shape of a Google API key. */
  looksLikeGoogleKey: boolean;
}

function sessionStorageSafe(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Private mode / blocked storage throws on access, not on use.
    return null;
  }
}

/** Read a runtime override a host page may have set before React booted. */
function readWindowGlobalValue(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readWindowGlobalKey(): string | null {
  return readWindowGlobalValue(WINDOW_KEY_GLOBAL);
}

export function resolveSessionValue(slot: string): string | null {
  const storage = sessionStorageSafe();
  if (!storage) return null;
  try {
    const value = storage.getItem(slot);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeSessionValue(slot: string, value: string | null): boolean {
  const storage = sessionStorageSafe();
  if (!storage) return false;
  try {
    if (value === null || value.trim().length === 0) storage.removeItem(slot);
    else storage.setItem(slot, value.trim());
    return true;
  } catch {
    return false;
  }
}

export function resolveGoogleMapsKey(): KeyResolution {
  const fromWindow = readWindowGlobalKey();
  if (fromWindow) {
    return {
      value: fromWindow.trim(),
      raw: fromWindow,
      source: 'window',
      envName: null,
      lookedFor: [...GOOGLE_MAPS_KEY_VARS],
    };
  }

  const fromSession = resolveSessionValue(SESSION_KEY_SLOT);
  if (fromSession) {
    return {
      value: fromSession.trim(),
      raw: fromSession,
      source: 'session',
      envName: null,
      lookedFor: [...GOOGLE_MAPS_KEY_VARS],
    };
  }

  const lookedFor: string[] = [];
  for (const name of GOOGLE_MAPS_KEY_VARS) {
    const readout = readEnvVar(name);
    lookedFor.push(name);
    if (readout.value && readout.value.trim().length > 0) {
      return {
        value: readout.value.trim(),
        raw: readout.value,
        source: 'env',
        envName: name,
        lookedFor,
      };
    }
  }

  return { value: null, raw: null, source: null, envName: null, lookedFor };
}

/** Optional Map ID; `null` is fine, the raster basemap does not require one. */
export function resolveGoogleMapsId(): string | null {
  const fromWindow = readWindowGlobalValue(WINDOW_MAP_ID_GLOBAL);
  if (fromWindow) return fromWindow.trim();
  const fromSession = resolveSessionValue(SESSION_ID_SLOT);
  if (fromSession) return fromSession.trim();
  for (const name of GOOGLE_MAPS_ID_VARS) {
    const readout = readEnvVar(name);
    if (readout.value && readout.value.trim().length > 0) return readout.value.trim();
  }
  return null;
}

/** `AIza…b7Qx` — the only printable form of a key anywhere in this app. */
export function maskKey(key: string | null | undefined): string {
  if (!key) return '—';
  const value = key.trim();
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\s*$/,
  /^(your|paste|put|insert|set|enter|type)[-\s_]/i,
  /(your|placeholder|example|sample|changeme|replace[-\s]?me|todo)/i,
  /^(undefined|null|false|true|none|\[object object\)|xxx+|…|\.{3})$/i,
  /^[<[{(]/,
  /^(api[_-]?key|key|value)$/i,
];

/**
 * Is this plausibly a Google API key?
 *
 * Google API keys are 39 characters, start with `AIza` and use the URL-safe
 * alphabet. A key that is *nearly* that shape still gets `usable: true` — we
 * are guarding against copy-paste accidents, not validating a secret we cannot
 * validate in a browser (restrictions live in the Cloud console).
 */
export function inspectGoogleMapsKey(resolution: KeyResolution = resolveGoogleMapsKey()): KeyInspection {
  const warnings: string[] = [];
  const raw = resolution.raw;
  const key = resolution.value;

  if (!key) {
    return {
      verdict: 'missing',
      usable: false,
      message: 'No key found — SURAKSHA is using the simulated map.',
      hint: `Add ${GOOGLE_MAPS_KEY_VAR} to .env (or the host's env vars), then restart the dev server.`,
      warnings: [],
      length: 0,
      looksLikeGoogleKey: false,
    };
  }

  const looksLikeGoogleKey = /^AIza[0-9A-Za-z_-]{30,}$/.test(key);

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(key))) {
    return {
      verdict: 'placeholder',
      usable: false,
      message: `The value "${maskKey(key)}" is a placeholder, not a key.`,
      hint: `Replace it in your .env and restart the dev server — Vite bakes values in at build time.`,
      warnings,
      length: key.length,
      looksLikeGoogleKey,
    };
  }

  if (raw !== key) {
    warnings.push('The value has leading/trailing whitespace. Quote it in .env: VITE_GOOGLE_MAPS_API_KEY="…"');
  }
  if (/\s/.test(key)) {
    warnings.push('The value contains spaces — a Google API key never does. Check for a truncated paste.');
  }
  if (key.length !== 39) {
    warnings.push(`Length is ${key.length}; a Google API key is 39 characters. A partial copy-paste is the usual cause.`);
  }
  if (!looksLikeGoogleKey) {
    warnings.push("Doesn't start with 'AIza'. Double-check you copied an API key and not an OAuth client secret.");
  }

  const verdict: KeyVerdict = looksLikeGoogleKey && key.length === 39 && warnings.length === 0 ? 'ok' : 'suspicious';

  if (resolution.source === 'session') {
    warnings.unshift('Using the session override from the debug panel, not your .env. Clear it to go back.');
  }
  if (resolution.source === 'window') {
    warnings.unshift(`Using the runtime override set on window.${WINDOW_KEY_GLOBAL}.`);
  }

  return {
    verdict,
    usable: true,
    message:
      verdict === 'ok'
        ? `Key loaded from ${describeSource(resolution)}.`
        : `Key loaded from ${describeSource(resolution)}, but the shape looks off.`,
    hint:
      verdict === 'ok'
        ? ''
        : 'Compare the value with the credentials page in Google Cloud (APIs & Services → Credentials).',
    warnings,
    length: key.length,
    looksLikeGoogleKey,
  };
}

export function describeSource(resolution: KeyResolution): string {
  switch (resolution.source) {
    case 'window':
      return `window.${WINDOW_KEY_GLOBAL}`;
    case 'session':
      return `sessionStorage["${SESSION_KEY_SLOT}"]`;
    case 'env':
      return resolution.envName ?? 'import.meta.env';
    default:
      return 'nothing (no key set)';
  }
}

/**
 * The steps a developer should follow, generated from what we can actually see.
 * Printed by the debug panel, the in-map popover and the console banner.
 */
export function buildFixSteps(resolution: KeyResolution): string[] {
  const steps: string[] = [];
  const envVars = GOOGLE_MAPS_KEY_VARS.filter((name) => !readEnvVar(name).declared);
  if (resolution.source === 'session' || resolution.source === 'window') {
    steps.push('A runtime override is active, so .env is not being consulted. Clear it in the debug panel to test the real config.');
  }
  steps.push(`Create .env in the repo root with ${GOOGLE_MAPS_KEY_VAR}="<your key>" (the VITE_ prefix is mandatory).`);
  if (envVars.length === GOOGLE_MAPS_KEY_VARS.length) {
    steps.push('A name without the VITE_ prefix is invisible to browser code — `GOOGLE_MAPS_API_KEY` alone will never reach the client.');
  }
  steps.push('Restart the dev server (`npm run dev`) — Vite bakes env values in at build time, hot reload will not pick them up.');
  steps.push('In Google Cloud, enable "Maps JavaScript API" for the project and allow the origin you are viewing from.');
  steps.push(
    'Deployed preview? Set the same variable in the host (Vercel → Project Settings → Environment Variables) and trigger a new build — the value is compiled in, so redeploying the old artifact changes nothing.',
  );
  steps.push('Re-check with `npm run maps:check` or by opening the map again — the badge turns green when the key arrives.');
  return steps;
}
