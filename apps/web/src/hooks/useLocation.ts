import { useEffect, useRef, useState } from 'react';
import type { GeoPoint } from '@suraksha/shared';
import { gpsQuality, gpsQualityLabel, type GpsQuality, type LocationFailure } from '@/lib/permissions';
import { describeAccuracy, getCurrentPosition, lastKnownLocation, watchLocation, type LocationSample } from '@/services/location';

/**
 * Live location for the UI.
 *
 * Two rules: a stale fix is never presented as live (`quality === 'stale'`), and
 * a failure keeps the last known position visible with its age, because in a
 * safety app "where you were 20 minutes ago" is still useful.
 */
export interface LocationState {
  point?: GeoPoint;
  recordedAt?: string;
  quality: GpsQuality;
  qualityLabel: string;
  accuracyLabel: string;
  ageMs?: number;
  watching: boolean;
  error?: LocationFailure;
  refresh: () => Promise<void>;
  isStale: boolean;
}

export function useLocation(options: { watch?: boolean; minDistanceMeters?: number } = {}): LocationState {
  const [state, setState] = useState<Omit<LocationState, 'refresh'>>(() => ({
    quality: 'none',
    qualityLabel: gpsQualityLabel('none'),
    accuracyLabel: 'Waiting for a position',
    watching: false,
    isStale: false,
  }));

  const applied = (sample: LocationSample): void => {
    setState((previous) => ({
      ...previous,
      point: sample.point,
      recordedAt: sample.recordedAt,
      quality: sample.quality,
      qualityLabel: gpsQualityLabel(sample.quality),
      accuracyLabel: describeAccuracy(sample.point.accuracy),
      ageMs: Date.now() - new Date(sample.recordedAt).getTime(),
      error: undefined,
      isStale: false,
    }));
  };

  const refresh = async () => {
    try {
      const sample = await getCurrentPosition(12_000);
      applied(sample);
    } catch (caught) {
      const failure = caught as LocationFailure;
      const cached = await lastKnownLocation();
      setState((previous) => ({
        ...previous,
        error: failure,
        point: previous.point ?? cached?.point,
        recordedAt: previous.recordedAt ?? cached?.recordedAt,
        quality: previous.point ? 'stale' : 'none',
        qualityLabel: previous.point ? gpsQualityLabel('stale') : gpsQualityLabel('none'),
        ageMs: cached ? Date.now() - new Date(cached.recordedAt).getTime() : undefined,
        isStale: Boolean(previous.point ?? cached?.point),
      }));
    }
  };

  useEffect(() => {
    let stop: (() => void) | undefined;

    void (async () => {
      await refresh();
      if (!options.watch) return;
      stop = watchLocation({
        minDistanceMeters: options.minDistanceMeters ?? 20,
        onSample: applied,
        onError: (failure) =>
          setState((previous) => ({
            ...previous,
            error: failure,
            quality: previous.point ? 'stale' : 'none',
            qualityLabel: previous.point ? gpsQualityLabel('stale') : gpsQualityLabel('none'),
            isStale: Boolean(previous.point),
          })),
      });
      setState((previous) => ({ ...previous, watching: true }));
    })();

    return () => stop?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.watch, options.minDistanceMeters]);

  // The age badge has to keep counting even when no new fix arrives.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const ageMs = state.recordedAt ? Date.now() - new Date(state.recordedAt).getTime() : undefined;
  const quality = state.point ? gpsQuality(state.point.accuracy, ageMs) : state.quality;

  return {
    ...state,
    refresh,
    tick,
    ageMs,
    quality,
    qualityLabel: gpsQualityLabel(quality),
    isStale: Boolean(state.point) && (ageMs ?? 0) > 5 * 60_000,
  } as LocationState;
}
