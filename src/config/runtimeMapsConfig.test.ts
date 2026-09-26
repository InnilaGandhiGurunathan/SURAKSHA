/**
 * Applying the host response is what makes a Vercel-only key visible.
 * The bundle can be empty; once /api/maps-config answers, the map is configured.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_MAPS_KEY_VAR, SESSION_KEY_SLOT, clearRuntimeMapsConfig, resolveGoogleMapsKey } from './googleMaps';
import { RUNTIME_MAPS_CONFIG_PROMISE, applyRuntimeMapsConfig, hydrateRuntimeMapsConfig } from './runtimeMapsConfig';
import { getGoogleMapsStatus, resetGoogleMapsLoader } from '@/services/googleMapsApi';

const env = import.meta.env as unknown as Record<string, string | undefined>;
const KEY = `AIza${'r'.repeat(35)}`;

afterEach(() => {
  delete env[GOOGLE_MAPS_KEY_VAR];
  clearRuntimeMapsConfig();
  resetGoogleMapsLoader();
  window.sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>)[RUNTIME_MAPS_CONFIG_PROMISE];
  vi.unstubAllGlobals();
});

describe('hydrateRuntimeMapsConfig', () => {
  it('publishes a key the bundle does not have, and the status flips to configured', async () => {
    delete env[GOOGLE_MAPS_KEY_VAR];
    expect(resolveGoogleMapsKey().value).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ key: KEY, mapId: null, envName: 'VITE_GOOGLE_MAPS_API_KEY' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    await expect(hydrateRuntimeMapsConfig()).resolves.toBe(true);

    const resolution = resolveGoogleMapsKey();
    expect(resolution).toMatchObject({ value: KEY, source: 'runtime', envName: 'VITE_GOOGLE_MAPS_API_KEY' });
    expect(getGoogleMapsStatus().configured).toBe(true);
    expect(getGoogleMapsStatus().inspection.message).toMatch(/vercel runtime/i);
  });

  it('ignores the SPA html a catch-all rewrite would return', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><div id="root">', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    );
    await expect(hydrateRuntimeMapsConfig()).resolves.toBe(false);
    expect(resolveGoogleMapsKey().source).toBeNull();
  });

  it('does not let an empty runtime response wipe a baked-in key', () => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
    expect(applyRuntimeMapsConfig({ key: '', mapId: null, envName: null, mapIdEnvName: null })).toBe(false);
    expect(resolveGoogleMapsKey()).toMatchObject({ value: KEY, source: 'env' });
  });

  it('leaves a pasted session key in charge', () => {
    window.sessionStorage.setItem(SESSION_KEY_SLOT, `AIza${'s'.repeat(35)}`);
    applyRuntimeMapsConfig({ key: KEY, mapId: 'map-1', envName: 'VITE_GOOGLE_MAPS_API_KEY', mapIdEnvName: null });
    expect(resolveGoogleMapsKey().source).toBe('session');
  });
});
