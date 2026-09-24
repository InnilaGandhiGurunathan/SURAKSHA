import type { GeoPoint, JourneyLocationPoint } from '@suraksha/shared';
import { explainLocationError, gpsQuality, isSecureContextOk, type GpsQuality, type LocationFailure } from '@/lib/permissions';
import { db, setSetting, SETTING_KEYS } from '@/lib/db';
import { uuid } from '@/lib/id';

/**
 * Location capture.
 *
 * Design notes that matter for a safety app:
 *  - a **last known fix** is always kept, so a journey can report "last seen at"
 *    even when the current fix is unavailable — but it is never presented as a
 *    live position;
 *  - accuracy is recorded with every point and surfaced as a quality label, so a
 *    2 km cell-tower fix is never drawn as a precise location;
 *  - the wake lock is optional and requested only while monitoring is active;
 *    failing to get one is a warning, never an error.
 */

export interface LocationSample {
  point: GeoPoint;
  recordedAt: string;
  quality: GpsQuality;
  source: 'gps' | 'manual';
}

export interface WatchOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maxAgeMs?: number;
  /** Skip points that are closer than this to the previous one. */
  minDistanceMeters?: number;
  minIntervalMs?: number;
  onSample: (sample: LocationSample) => void;
  onError?: (failure: LocationFailure) => void;
}

export async function getCurrentPosition(timeoutMs = 15_000): Promise<LocationSample> {
  if (!('geolocation' in navigator)) {
    throw explainLocationError(new Error('unsupported'));
  }

  return new Promise<LocationSample>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toSample(position)),
      (error) => reject(explainLocationError(error)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

function toSample(position: GeolocationPosition): LocationSample {
  const point: GeoPoint = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
  return {
    point,
    recordedAt: new Date(position.timestamp).toISOString(),
    quality: gpsQuality(position.coords.accuracy, 0),
    source: 'gps',
  };
}

export function watchLocation(options: WatchOptions): () => void {
  if (!('geolocation' in navigator) || !isSecureContextOk()) {
    options.onError?.(explainLocationError(new Error('unsupported')));
    return () => undefined;
  }

  let lastAcceptedAt = 0;
  let lastPoint: GeoPoint | undefined;
  let stopped = false;

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (stopped) return;
      const sample = toSample(position);

      if (options.minDistanceMeters && lastPoint) {
        const distance = roughMeters(lastPoint, sample.point);
        if (distance < options.minDistanceMeters && Date.now() - lastAcceptedAt < (options.minIntervalMs ?? 20_000)) {
          return;
        }
      }

      lastAcceptedAt = Date.now();
      lastPoint = sample.point;
      void rememberLastKnown(sample.point, sample.recordedAt);
      options.onSample(sample);
    },
    (error) => {
      if (stopped) return;
      options.onError?.(explainLocationError(error));
    },
    {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeoutMs ?? 20_000,
      maximumAge: options.maxAgeMs ?? 5_000,
    },
  );

  return () => {
    stopped = true;
    navigator.geolocation.clearWatch(watchId);
  };
}

function roughMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export async function rememberLastKnown(point: GeoPoint, recordedAt: string): Promise<void> {
  await setSetting(SETTING_KEYS.lastKnownLocation, { point, recordedAt });
}

export async function lastKnownLocation(): Promise<{ point: GeoPoint; recordedAt: string } | undefined> {
  const stored = await db.settings.get(SETTING_KEYS.lastKnownLocation);
  return stored?.value as { point: GeoPoint; recordedAt: string } | undefined;
}

/** Persists a track point for a journey and mirrors it into the journey row. */
export async function recordJourneyLocation(input: {
  journeyId: string;
  ownerId: string;
  sample: LocationSample;
}): Promise<void> {
  const { journeyId, ownerId, sample } = input;

  await db.locations.put({
    id: uuid(),
    journeyId,
    ownerId,
    point: sample.point,
    recordedAt: sample.recordedAt,
    source: sample.source,
  });

  await db.journeys.update(journeyId, {
    lastKnownLocation: sample.point,
    lastLocationAt: sample.recordedAt,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * The stored track for a journey, oldest first.
 *
 * Full `JourneyLocationPoint` rows are returned (not just coordinates) because the
 * risk engine and the map both need the timestamps and the source of each fix.
 */
export async function journeyTrack(journeyId: string, limit = 2000): Promise<JourneyLocationPoint[]> {
  const rows = await db.locations.where('journeyId').equals(journeyId).toArray();
  return rows
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .slice(-limit);
}

export function describeAccuracy(accuracyMeters: number | undefined): string {
  if (accuracyMeters === undefined) return 'Accuracy unknown';
  if (accuracyMeters <= 15) return `Accurate to about ${Math.round(accuracyMeters)} m`;
  if (accuracyMeters <= 60) return `Approximate, within ${Math.round(accuracyMeters)} m`;
  if (accuracyMeters <= 250) return `Coarse fix, within ${Math.round(accuracyMeters)} m`;
  return `Very coarse fix (${Math.round(accuracyMeters)} m) — treat it as an area, not a point`;
}

/* ------------------------------- Wake lock -------------------------------- */

let wakeLock: WakeLockSentinel | null = null;

/**
 * Keeps the screen awake while monitoring. Best-effort by design: many browsers
 * refuse without a user gesture, and some refuse outright. Never awaited by the
 * journey start flow.
 */
export async function requestWakeLock(): Promise<{ granted: boolean; message: string }> {
  if (!('wakeLock' in navigator)) {
    return { granted: false, message: 'This browser has no screen wake lock; keep SURAKSHA open while travelling.' };
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
    return { granted: true, message: 'Screen will stay awake while monitoring is on.' };
  } catch (error) {
    return {
      granted: false,
      message: `The screen wake lock was refused (${(error as Error).message}). Keep the app in the foreground.`,
    };
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    /* ignore */
  } finally {
    wakeLock = null;
  }
}

export function hasWakeLock(): boolean {
  return wakeLock !== null;
}
