/**
 * One source of truth for how the map describes itself.
 *
 * The map can be in five materially different states, and a safety screen must
 * never let the reader guess which one they are looking at: real tiles with the
 * simulated route, tiles still loading, tiles refused by Google, or the
 * built-in canvas because no key exists. Every surface — the card header, the
 * map badge, the legend strip and the debug panel — reads its words from here.
 */

import type { Tone } from '@/lib/status';
import type { GoogleMapsStatus } from '@/services/googleMapsApi';
import type { ResolvedBasemap } from '@/services/basemapPreference';

export type MapSurfaceKind = 'live' | 'live-loading' | 'live-failed' | 'sim-no-key' | 'sim-chosen';

export interface MapSurfaceCopy {
  /** What was asked for, after preferences and the key check are applied. */
  requested: ResolvedBasemap;
  /** Whether real tiles are on screen right now. */
  live: boolean;
  kind: MapSurfaceKind;
  tone: Tone;
  /** For a card subtitle, e.g. `Live Google tiles · AIza…b7Qx · updated 4s ago`. */
  headerLabel: string;
  /** The pill on the map itself. */
  badgeLabel: string;
  /** The same, for narrow mobile widths. */
  badgeShort: string;
  /** The honest footnote under the map. */
  disclaimer: string;
}

export function mapSurfaceCopy(status: GoogleMapsStatus, requested: ResolvedBasemap): MapSurfaceCopy {
  if (!status.configured) {
    return {
      requested: 'sim',
      live: false,
      kind: 'sim-no-key',
      tone: 'watch',
      headerLabel: 'Simulated map · no key set',
      badgeLabel: 'No Maps key — simulated map',
      badgeShort: 'Maps key?',
      disclaimer: 'Simulated GPS',
    };
  }

  if (requested === 'sim') {
    return {
      requested: 'sim',
      live: false,
      kind: 'sim-chosen',
      tone: 'safe',
      headerLabel: 'Simulated map · live map switched off',
      badgeLabel: 'Key ready — simulated map chosen',
      badgeShort: 'Key ready',
      disclaimer: 'Simulated GPS · live tiles available but disabled',
    };
  }

  if (status.loader.authFailure) {
    return {
      requested: 'live',
      live: false,
      kind: 'live-failed',
      tone: 'alert',
      headerLabel: 'Simulated map · Google refused the key',
      badgeLabel: 'Google refused this key',
      badgeShort: 'Key refused',
      disclaimer: 'Simulated GPS · key not accepted (API disabled or referrer restriction)',
    };
  }

  if (status.loader.state === 'error') {
    return {
      requested: 'live',
      live: false,
      kind: 'live-failed',
      tone: 'alert',
      headerLabel: 'Simulated map · tiles could not load',
      badgeLabel: 'Maps JS API could not load',
      badgeShort: 'Map failed',
      disclaimer: 'Simulated GPS · live tiles unavailable on this network',
    };
  }

  if (status.loader.state !== 'ready') {
    return {
      requested: 'live',
      live: false,
      kind: 'live-loading',
      tone: 'brand',
      headerLabel: 'Loading Google tiles…',
      badgeLabel: 'Loading Google tiles…',
      badgeShort: 'Loading…',
      disclaimer: 'Simulated GPS while tiles load',
    };
  }

  return {
    requested: 'live',
    live: true,
    kind: 'live',
    tone: 'safe',
    headerLabel: `Live Google tiles · ${status.keyMasked}`,
    badgeLabel: `Live map · ${status.keyMasked}`,
    badgeShort: 'Live ✓',
    disclaimer: 'Google tiles · route and coordinates simulated · the zone outline is the demo zone, not a real-world risk area',
  };
}
