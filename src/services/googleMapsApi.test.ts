/**
 * The Google Maps status + loader contract.
 *
 * Nothing here talks to Google: the script tag is asserted, and the callback
 * Google is supposed to call is fired by hand. What must be true is that every
 * state — no key, key set, refused by Google, blocked network — produces a
 * *different, specific* answer in `getGoogleMapsStatus()`, because that single
 * object is what the map badge, the debug card, the console banner and
 * `surakshaMaps.status()` all render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_MAPS_KEY_VAR, SESSION_KEY_SLOT, clearRuntimeMapsConfig } from '@/config/googleMaps';
import {
  GoogleMapsError,
  createGoogleMapsDebugApi,
  formatGoogleMapsStatus,
  getGoogleMapsStatus,
  installGoogleMapsDebug,
  loadGoogleMapsApi,
  printGoogleMapsBanner,
  resetGoogleMapsLoader,
  setSessionMapsKey,
  type GoogleMapsApi,
} from './googleMapsApi';

const env = import.meta.env as unknown as Record<string, string | undefined>;
const KEY = `AIza${'T'.repeat(35)}`;
type GoogleWindow = Record<string, any>;
let googleWindow: GoogleWindow;

function fakeApi(): GoogleMapsApi {
  class FakeMap {
    setOptions() {}
    setCenter() {}
    panTo() {}
    setZoom() {}
    getZoom() {
      return 16;
    }
    fitBounds() {}
  }
  class FakePath {
    setMap() {}
    setOptions() {}
    setPath() {}
  }
  class FakeMarker {
    setMap() {}
    setPosition() {}
    setOptions() {}
  }
  return {
    Map: FakeMap as unknown as GoogleMapsApi['Map'],
    Marker: FakeMarker as unknown as GoogleMapsApi['Marker'],
    Polyline: FakePath as unknown as GoogleMapsApi['Polyline'],
    Polygon: FakePath as unknown as GoogleMapsApi['Polygon'],
    LatLngBounds: class {
      extend() {}
    } as unknown as GoogleMapsApi['LatLngBounds'],
    SymbolPath: { CIRCLE: 1 },
    event: { addListener: () => ({ remove: () => undefined }) },
  } as GoogleMapsApi;
}

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script#suraksha-google-maps-api')];
}

beforeEach(() => {
  googleWindow = window as unknown as GoogleWindow;
  resetGoogleMapsLoader();
  for (const name of [GOOGLE_MAPS_KEY_VAR, 'VITE_GOOGLE_MAPS_KEY', 'VITE_GOOGLE_MAPS_KEY_ID']) delete env[name];
  window.sessionStorage.clear();
  delete googleWindow.__SURAKSHA_GOOGLE_MAPS_KEY__;
  clearRuntimeMapsConfig();
});

afterEach(() => {
  resetGoogleMapsLoader();
  scripts().forEach((node) => node.remove());
  delete googleWindow.google;
  delete googleWindow.gm_authFailure;
  delete googleWindow.__SURAKSHA_MAPS_CALLBACK__;
  delete googleWindow.surakshaMaps;
  delete googleWindow.__SURAKSHA__;
  vi.restoreAllMocks();
});

describe('no key configured', () => {
  it('reports needs-key and keeps the simulated map', () => {
    const status = getGoogleMapsStatus();
    expect(status.configured).toBe(false);
    expect(status.available).toBe(false);
    expect(status.verdict).toBe('needs-key');
    expect(status.summary).toContain(GOOGLE_MAPS_KEY_VAR);
    expect(status.fix.length).toBeGreaterThan(2);
  });

  it('refuses to fetch anything when there is no key', async () => {
    await expect(loadGoogleMapsApi()).rejects.toBeInstanceOf(GoogleMapsError);
    expect(scripts()).toHaveLength(0);
  });

  it('names the env variables it looked for, so a typo is visible', () => {
    const status = getGoogleMapsStatus();
    expect(status.resolution.lookedFor).toContain(GOOGLE_MAPS_KEY_VAR);
    expect(status.missingEnvVars).toContain(GOOGLE_MAPS_KEY_VAR);
  });
});

describe('a key is configured', () => {
  beforeEach(() => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
  });

  it('is configured, and prints only a mask', () => {
    const status = getGoogleMapsStatus();
    expect(status.configured).toBe(true);
    expect(status.keyMasked).toBe(`${KEY.slice(0, 4)}…${KEY.slice(-4)}`);
    expect(formatGoogleMapsStatus(status)).not.toContain(KEY);
    expect(formatGoogleMapsStatus(status)).toMatch(/key\s*:\s*AIza…/);
  });

  it('requests the Maps script exactly once, with the key in the query', () => {
    const first = loadGoogleMapsApi();
    const second = loadGoogleMapsApi();
    expect(first).toBe(second);
    expect(scripts()).toHaveLength(1);
    const src = scripts()[0].src;
    expect(src).toContain('https://maps.googleapis.com/maps/api/js');
    expect(src).toContain(`key=${KEY}`);
    expect(src).toContain('loading=async');
    expect(getGoogleMapsStatus().loader.state).toBe('loading');
  });

  it('becomes available once Google calls back', async () => {
    const pending = loadGoogleMapsApi();
    googleWindow.google = { maps: fakeApi() };
    googleWindow.__SURAKSHA_MAPS_CALLBACK__();
    await expect(pending).resolves.toBeDefined();

    const status = getGoogleMapsStatus();
    expect(status.loader.state).toBe('ready');
    expect(status.available).toBe(true);
    expect(status.verdict).toBe('ready');
  });

  it('turns a Google auth failure into an explicit "key refused" state', async () => {
    const pending = loadGoogleMapsApi();
    pending.catch(() => undefined);
    googleWindow.gm_authFailure();

    const status = getGoogleMapsStatus();
    expect(status.loader.authFailure).toBe(true);
    expect(status.verdict).toBe('failed');
    expect(status.summary).toMatch(/refused|rejected/i);
    expect(status.available).toBe(false);
  });

  it('turns a blocked script host into a network error, not a blank map', async () => {
    const pending = loadGoogleMapsApi();
    pending.catch(() => undefined);
    scripts()[0].onerror?.(new Event('error'));

    const status = getGoogleMapsStatus();
    expect(status.loader.state).toBe('error');
    expect(status.loader.error).toMatch(/Could not fetch/);
    expect(status.summary).toMatch(/failed to load/i);
  });
});

describe('pasting a key into the app instead of .env', () => {
  it('stores it for the tab only and takes effect immediately', () => {
    expect(getGoogleMapsStatus().configured).toBe(false);

    expect(setSessionMapsKey(`  ${KEY}  `)).toBe(true);
    const status = getGoogleMapsStatus();
    expect(status.configured).toBe(true);
    expect(status.resolution.source).toBe('session');
    expect(status.resolution.value).toBe(KEY);
    expect(window.sessionStorage.getItem(SESSION_KEY_SLOT)).toBe(KEY);

    setSessionMapsKey(null);
    expect(getGoogleMapsStatus().configured).toBe(false);
  });
});

describe('the console debug surface', () => {
  it('installs window.surakshaMaps and mirrors the panel', () => {
    const choose = vi.fn();
    installGoogleMapsDebug(createGoogleMapsDebugApi({ setBasemap: choose, readBasemap: () => 'auto' }));
    const debug = googleWindow.surakshaMaps;

    expect(debug.status()).toMatchObject({ verdict: 'needs-key' });
    expect(debug.basemap()).toEqual({ choice: 'auto', configured: false });
    debug.live();
    expect(choose).toHaveBeenCalledWith('live');
    expect(debug.help()).toMatch(/surakshaMaps\.check\(\)/);
  });

  it('prints the banner with the fix steps and never the key', () => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
    resetGoogleMapsLoader();
    setSessionMapsKey(null);
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);

    printGoogleMapsBanner();
    expect(spy).toHaveBeenCalled();
    expect(logged.join('\n')).toContain(GOOGLE_MAPS_KEY_VAR);
    expect(logged.join('\n')).not.toContain(KEY);
  });

  it('keeps quiet when everything is already fine', async () => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
    googleWindow.google = { maps: fakeApi() };
    resetGoogleMapsLoader();
    await loadGoogleMapsApi();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printGoogleMapsBanner();
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
