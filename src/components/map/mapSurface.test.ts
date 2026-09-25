/**
 * The words every surface uses to say which map you are looking at.
 *
 * Five states, five different sentences — and the important property is that a
 * reader can tell "real streets" from "fallback" without clicking anything. A
 * silent downgrade on a safety screen is the failure mode to prevent.
 */

import { describe, expect, it } from 'vitest';
import { mapSurfaceCopy } from './mapSurface';
import type { GoogleMapsStatus } from '@/services/googleMapsApi';

function status(overrides: Partial<GoogleMapsStatus> = {}): GoogleMapsStatus {
  const base = {
    configured: true,
    available: true,
    verdict: 'ready',
    summary: 'Live basemap ready — key AIza…b7Qx from .env.',
    keyMasked: 'AIza…b7Qx',
    loader: { state: 'ready', error: null, attempted: true, authFailure: false, keyMasked: 'AIza…b7Qx', durationMs: 421 },
  };
  return { ...base, ...overrides, loader: { ...base.loader, ...(overrides.loader ?? {}) } } as GoogleMapsStatus;
}

describe('mapSurfaceCopy', () => {
  it('names the live surface and the key that produced it', () => {
    const copy = mapSurfaceCopy(status(), 'live');
    expect(copy).toMatchObject({ kind: 'live', live: true, tone: 'safe', requested: 'live' });
    expect(copy.headerLabel).toBe('Live Google tiles · AIza…b7Qx');
    expect(copy.disclaimer).toMatch(/route and coordinates simulated/);
  });

  it('is explicit when no key exists at all', () => {
    const copy = mapSurfaceCopy(status({ configured: false, available: false, verdict: 'needs-key' }), 'sim');
    expect(copy.kind).toBe('sim-no-key');
    expect(copy.live).toBe(false);
    expect(copy.headerLabel).toMatch(/no key set/i);
    expect(copy.badgeLabel).toMatch(/no maps key/i);
  });

  it('does not hide a refused key behind the word "simulated"', () => {
    const refused = mapSurfaceCopy(status({ loader: { authFailure: true } as never }), 'live');
    expect(refused.kind).toBe('live-failed');
    expect(refused.tone).toBe('alert');
    expect(refused.headerLabel).toMatch(/google refused the key/i);

    const unreachable = mapSurfaceCopy(
      status({ loader: { state: 'error', error: 'Could not fetch maps.googleapis.com' } as never }),
      'live',
    );
    expect(unreachable.headerLabel).toMatch(/tiles could not load/i);
  });

  it('says so while tiles are still loading', () => {
    const copy = mapSurfaceCopy(status({ loader: { state: 'loading' } as never }), 'live');
    expect(copy.kind).toBe('live-loading');
    expect(copy.headerLabel).toMatch(/loading google tiles/i);
  });

  it('calls the simulated canvas a fallback when a key was available', () => {
    const copy = mapSurfaceCopy(status(), 'sim');
    expect(copy.kind).toBe('sim-chosen');
    expect(copy.live).toBe(false);
    expect(copy.headerLabel).toMatch(/live map switched off/i);
    expect(copy.disclaimer).toMatch(/available but disabled/);
  });
});
