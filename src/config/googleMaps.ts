/**
 * Google Maps key resolution and self-checks.
 *
 * Where the key comes from, in the order the app actually looks:
 *
 *   1. `window.__SURAKSHA_GOOGLE_MAPS_KEY__`  — set at runtime by the host
 *      page (a harness, an injected script). Wins, so a live demo can be
 *      fixed without a rebuild.
 *   2. `sessionStorage['suraksha.maps.key']`  — pasted into the in-app debug
 *      panel. Deliberately *session* and not *local* storage: an API key must
 *      not outlive the tab in a shared browser, and it also means SURAKSHA's
 *      state snapshot never carries a secret.
 *   3. The host runtime config (`/api/maps-config`) — what Vercel has *now*.
 *      Vite only inlines env at build time, so a variable saved in the Vercel
 *      dashboard after the last build (or one Vercel only injects at runtime)
 *      would otherwise never show up on the website. This slot is that value.
 *   4. `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` — baked in at build time.
 *
 * Nothing here throws and nothing logs a full key. `maskKey()` is the only
 * function allowed to produce a printable representation.
 */

import { readEnvVar } from './env';
import { normalizeMapsCredential } from './mapsHostEnv';

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

export type KeySource = 'window' | 'session' | 'runtime' | 'env' | null;

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

/**
 * Key delivered by `/api/maps-config` after boot. Held in the module, not on
 * `window`, so a host-page override and a pasted session key keep their place
 * above it.
 */
let runtimeKey: string | null = null;
let runtimeMapId: string | null = null;
let runtimeEnvName: string | null = null;

export function setRuntimeMapsConfig(next: {
  key: string | null;
  mapId: string | null;
  envName: string | null;
  mapIdEnvName: string | null;
}): void {
  if (next.key) {
    runtimeKey = next.key;
    runtimeEnvName = next.envName;
  }
  if (next.mapId) runtimeMapId = next.mapId;
}

export function clearRuntimeMapsConfig(): void {
  runtimeKey = null;
  runtimeMapId = null;
  runtimeEnvName = null;
}

function usableCredential(raw: string | null | undefined): string | null {
  return normalizeMapsCredential(raw);
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
  const lookedFor = [...GOOGLE_MAPS_KEY_VARS];

  const fromWindow = readWindowGlobalKey();
  const windowValue = fromWindow ? usableCredential(fromWindow) : null;
  if (fromWindow && windowValue) {
    return { value: windowValue, raw: fromWindow, source: 'window', envName: null, lookedFor };
  }

  const fromSession = resolveSessionValue(SESSION_KEY_SLOT);
  const sessionValue = fromSession ? usableCredential(fromSession) : null;
  if (fromSession && sessionValue) {
    return { value: sessionValue, raw: fromSession, source: 'session', envName: null, lookedFor };
  }

  // The live host value beats a key frozen into an older bundle.
  if (runtimeKey) {
    return {
      value: runtimeKey,
      raw: runtimeKey,
      source: 'runtime',
      envName: runtimeEnvName,
      lookedFor,
    };
  }

  const found: string[] = [];
  for (const name of GOOGLE_MAPS_KEY_VARS) {
    const readout = readEnvVar(name);
    found.push(name);
    const value = usableCredential(readout.value);
    if (readout.value && value) {
      return {
        value,
        raw: readout.value,
        source: 'env',
        envName: name,
        lookedFor: found,
      };
    }
  }

  return { value: null, raw: null, source: null, envName: null, lookedFor: found };
}

/** Optional Map ID; `null` is fine, the raster basemap does not require one. */
export function resolveGoogleMapsId(): string | null {
  const fromWindow = readWindowGlobalValue(WINDOW_MAP_ID_GLOBAL);
  if (fromWindow) return usableCredential(fromWindow);
  const fromSession = resolveSessionValue(SESSION_ID_SLOT);
  if (fromSession) return usableCredential(fromSession);
  if (runtimeMapId) return runtimeMapId;
  for (const name of GOOGLE_MAPS_ID_VARS) {
    const readout = readEnvVar(name);
    const value = usableCredential(readout.value);
    if (value) return value;
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

  if (raw && raw.trim() !== raw) {
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
    case 'runtime':
      return resolution.envName ? `Vercel runtime (${resolution.envName})` : 'Vercel runtime (/api/maps-config)';
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
    steps.push(
      'A name without the VITE_ prefix is invisible to the Vite bundle. The website also reads /api/maps-config, which accepts GOOGLE_MAPS_API_KEY — VITE_GOOGLE_MAPS_API_KEY is still the name to set.',
    );
  }
  steps.push('Restart the dev server (`npm run dev`) — Vite bakes env values in at build time, hot reload will not pick them up.');
  steps.push('In Google Cloud, enable "Maps JavaScript API" for the project and allow the origin you are viewing from.');
  steps.push(
    'Deployed on Vercel? The site reads the key live from /api/maps-config (Project Settings → Environment Variables). Saving VITE_GOOGLE_MAPS_API_KEY — or GOOGLE_MAPS_API_KEY — is enough; the next page load picks it up even when the last Vite build did not inline it.',
  );
  steps.push('Re-check with `npm run maps:check` or by opening the map again — the badge turns green when the key arrives.');
  return steps;
}
