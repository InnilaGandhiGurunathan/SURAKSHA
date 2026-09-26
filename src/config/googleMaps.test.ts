/**
 * The "did my Google Maps key arrive?" logic.
 *
 * These are the failure modes people actually hit: an empty value, a
 * placeholder nobody replaced, a key copied with a newline, and a session
 * override left behind from an earlier debugging run. Each one has to produce a
 * different, actionable answer rather than "undefined".
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_MAPS_KEY_VAR,
  SESSION_KEY_SLOT,
  WINDOW_KEY_GLOBAL,
  buildFixSteps,
  clearRuntimeMapsConfig,
  inspectGoogleMapsKey,
  maskKey,
  resolveGoogleMapsKey,
  setRuntimeMapsConfig,
} from './googleMaps';

/**
 * `vi.stubEnv` only touches `process.env` under Vitest, while the app reads
 * `import.meta.env` — which is exactly the distinction that breaks real builds.
 * The tests write the object the app actually reads.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;
const ENV_SLOTS = [GOOGLE_MAPS_KEY_VAR, 'VITE_GOOGLE_MAPS_KEY', 'VITE_GOOGLE_MAPS_KEY_ID'];
const pristine = { ...env };

/** A 39-character value with Google's `AIza` prefix, the shape of a real key. */
function fakeKey(seed = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'): string {
  return `AIza${seed}`.slice(0, 39).padEnd(39, 'x');
}

function clearEverything() {
  for (const slot of ENV_SLOTS) delete env[slot];
  Object.assign(env, pristine);
  window.sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>)[WINDOW_KEY_GLOBAL];
  clearRuntimeMapsConfig();
}

afterEach(clearEverything);

describe('resolving VITE_GOOGLE_MAPS_API_KEY', () => {
  it('says "missing" — not "empty string" — when no env var exists', () => {
    clearEverything();
    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBeNull();
    expect(resolution.source).toBeNull();

    const inspection = inspectGoogleMapsKey(resolution);
    expect(inspection.verdict).toBe('missing');
    expect(inspection.usable).toBe(false);
    expect(inspection.message).toMatch(/no key found/i);
    expect(inspection.hint).toContain(GOOGLE_MAPS_KEY_VAR);
  });

  it('reads the value from the build-time env, naming the variable it came from', () => {
    const key = fakeKey();
    env[GOOGLE_MAPS_KEY_VAR] = key;

    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBe(key);
    expect(resolution.source).toBe('env');
    expect(resolution.envName).toBe(GOOGLE_MAPS_KEY_VAR);
    expect(inspectGoogleMapsKey(resolution).verdict).toBe('ok');
  });

  it('treats `VITE_GOOGLE_MAPS_API_KEY=` as not configured', () => {
    env[GOOGLE_MAPS_KEY_VAR] = '';
    expect(resolveGoogleMapsKey().value).toBeNull();
  });

  it('refuses to treat an unreplaced placeholder as a key', () => {
    env[GOOGLE_MAPS_KEY_VAR] = 'your-google-maps-api-key';
    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBe('your-google-maps-api-key');

    const inspection = inspectGoogleMapsKey(resolution);
    expect(inspection.verdict).toBe('placeholder');
    expect(inspection.usable).toBe(false);
  });

  it('accepts a real-shaped key but warns when the paste has whitespace', () => {
    env[GOOGLE_MAPS_KEY_VAR] = `  ${fakeKey()}\n`;
    const resolution = resolveGoogleMapsKey();
    const inspection = inspectGoogleMapsKey(resolution);

    expect(inspection.usable).toBe(true);
    expect(inspection.verdict).toBe('suspicious');
    expect(inspection.warnings.join(' ')).toMatch(/whitespace/i);
  });

  it('warns when the value is not the shape of a Google API key', () => {
    env[GOOGLE_MAPS_KEY_VAR] = 'secret-from-the-old-server';
    const inspection = inspectGoogleMapsKey(resolveGoogleMapsKey());
    expect(inspection.warnings.join(' ')).toMatch(/AIza/);
    expect(inspection.looksLikeGoogleKey).toBe(false);
  });

  it('a session override wins over .env, and says so', () => {
    env[GOOGLE_MAPS_KEY_VAR] = fakeKey();
    const sessionKey = fakeKey('Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2');
    window.sessionStorage.setItem(SESSION_KEY_SLOT, sessionKey);

    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBe(sessionKey);
    expect(resolution.source).toBe('session');
    expect(inspectGoogleMapsKey(resolution).warnings.join(' ')).toMatch(/session override/i);
  });

  it('unwraps a key the host stored with wrapping quotes', () => {
    env[GOOGLE_MAPS_KEY_VAR] = `"${fakeKey()}"`;
    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBe(fakeKey());
    expect(inspectGoogleMapsKey(resolution).verdict).toBe('ok');
    expect(inspectGoogleMapsKey(resolution).warnings.join(' ')).not.toMatch(/whitespace/i);
  });

  it('a Vercel runtime key beats a stale baked-in value, and a session paste still wins', () => {
    env[GOOGLE_MAPS_KEY_VAR] = fakeKey('baked');
    const live = fakeKey('live');
    setRuntimeMapsConfig({ key: live, mapId: null, envName: 'GOOGLE_MAPS_API_KEY', mapIdEnvName: null });

    const fromHost = resolveGoogleMapsKey();
    expect(fromHost.value).toBe(live);
    expect(fromHost.source).toBe('runtime');
    expect(fromHost.envName).toBe('GOOGLE_MAPS_API_KEY');
    expect(inspectGoogleMapsKey(fromHost).verdict).toBe('ok');

    window.sessionStorage.setItem(SESSION_KEY_SLOT, fakeKey('sess'));
    expect(resolveGoogleMapsKey().source).toBe('session');
  });

  it('a window global beats everything, because it is the escape hatch', () => {
    env[GOOGLE_MAPS_KEY_VAR] = fakeKey();
    window.sessionStorage.setItem(SESSION_KEY_SLOT, fakeKey('Q1'));
    const runtimeKey = fakeKey('R2');
    (window as unknown as Record<string, unknown>)[WINDOW_KEY_GLOBAL] = runtimeKey;

    const resolution = resolveGoogleMapsKey();
    expect(resolution.value).toBe(runtimeKey);
    expect(resolution.source).toBe('window');
  });
});

describe('never leaking the key', () => {
  it('masks the middle of the value', () => {
    const key = fakeKey();
    const masked = maskKey(key);
    expect(masked).toBe(`${key.slice(0, 4)}…${key.slice(-4)}`);
    expect(masked).not.toContain(key.slice(4, -4));
    expect(maskKey(null)).toBe('—');
    expect(maskKey('short')).toBe('sh…');
  });
});

describe('the fix list shown when the key is missing', () => {
  it('names the file, the prefix and the restart', () => {
    clearEverything();
    const steps = buildFixSteps(resolveGoogleMapsKey()).join(' ');
    expect(steps).toContain('.env');
    expect(steps).toContain(GOOGLE_MAPS_KEY_VAR);
    expect(steps).toMatch(/restart/i);
    expect(steps).toMatch(/VITE_/);
    expect(steps).toMatch(/maps:check|badge/i);
  });
});
