/**
 * React bindings for the Google Maps status/loader.
 *
 * Kept out of `googleMapsApi.ts` so that module stays importable from
 * non-React places (the boot banner in `main.tsx`, the debug console API).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  getGoogleMapsStatus,
  loadGoogleMapsApi,
  resetGoogleMapsLoader,
  subscribeGoogleMaps,
  type GoogleMapsApi,
  type GoogleMapsStatus,
} from '@/services/googleMapsApi';
import {
  readBasemapPreference,
  resolveBasemap,
  setBasemapPreference,
  subscribeBasemapPreference,
  type BasemapChoice,
} from '@/services/basemapPreference';
import { mapSurfaceCopy, type MapSurfaceCopy } from './mapSurface';

/** Live status object; re-renders whenever the loader or the key changes. */
export function useGoogleMapsStatus(): GoogleMapsStatus {
  return useSyncExternalStore(subscribeGoogleMaps, getGoogleMapsStatus, getGoogleMapsStatus);
}

export function useBasemapPreference(): { choice: BasemapChoice; choose: (next: BasemapChoice) => void } {
  const choice = useSyncExternalStore(subscribeBasemapPreference, readBasemapPreference, readBasemapPreference);
  return { choice, choose: setBasemapPreference };
}

/**
 * How the map should describe itself on this screen — the words used by the
 * card headers, the badge on the map and the legend strip, so they can never
 * disagree about whether you are looking at real streets.
 */
export function useMapSurface(): MapSurfaceCopy & { choice: BasemapChoice; status: GoogleMapsStatus } {
  const status = useGoogleMapsStatus();
  const { choice } = useBasemapPreference();
  const { basemap } = resolveBasemap(choice, status.configured);
  return { ...mapSurfaceCopy(status, basemap), choice, status };
}

/**
 * Loads the Maps JS API the first time a live basemap is actually requested.
 *
 * Never called on mount for a page that shows the simulated map, so the demo
 * costs nothing when no key is configured.
 */
export function useGoogleMapsLoader(active: boolean): {
  api: GoogleMapsApi | null;
  status: GoogleMapsStatus;
  retry: () => void;
} {
  const status = useGoogleMapsStatus();
  const [api, setApi] = useState<GoogleMapsApi | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !status.configured) return;
    // Always routed through the loader, even when the script is already on the
    // window: that is what marks the shared status as `ready`, and the badge,
    // the debug panel and this hook must never disagree about it.
    let cancelled = false;
    loadGoogleMapsApi().then(
      (next) => {
        if (!cancelled) setApi(next);
      },
      () => {
        /* the rejected state is already reflected in `status`; the UI shows it */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, status.configured, attempt]);

  const retry = useCallback(() => {
    setApi(null);
    resetGoogleMapsLoader();
    setAttempt((value) => value + 1);
  }, []);

  return { api, status, retry };
}
