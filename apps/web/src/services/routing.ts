import type { GeoPoint, RouteInfo, TransportMode } from '@suraksha/shared';
import { haversineMeters, interpolateLine } from '@suraksha/shared';
import { appEnv } from '@/lib/env';
import { ApiRequestError } from './api';

/**
 * Geocoding and route planning — both strictly optional.
 *
 * A journey must be creatable with no network at all, so:
 *  - every lookup can fail without blocking anything;
 *  - when routing is unavailable the journey falls back to a straight-line
 *    corridor and is labelled `approximate: true`, which the UI repeats wherever
 *    distances and ETAs are shown;
 *  - coordinates can always be typed in by hand, which also works offline.
 */

export interface GeocodeResult {
  label: string;
  point: GeoPoint;
  approximate: boolean;
  source: 'nominatim' | 'offline';
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export async function geocode(query: string, options: { timeoutMs?: number } = {}): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  if (!navigator.onLine) {
    throw new ApiRequestError({
      status: 0,
      offline: true,
      timeout: false,
      message: 'Searching for places needs a connection. You can type coordinates instead (for example 28.6139, 77.2090).',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 9000);

  try {
    const url = new URL(`${NOMINATIM_BASE}/search`);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Geocoder answered ${response.status}`);

    const rows = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
    }>;

    return rows
      .map((row) => ({
        label: row.display_name,
        point: { lat: Number(row.lat), lng: Number(row.lon) },
        approximate: false,
        source: 'nominatim' as const,
      }))
      .filter((result) => Number.isFinite(result.point.lat) && Number.isFinite(result.point.lng));
  } catch (error) {
    throw new ApiRequestError({
      status: 0,
      offline: !navigator.onLine,
      timeout: (error as Error)?.name === 'AbortError',
      message:
        (error as Error)?.name === 'AbortError'
          ? 'The place search timed out. Try again, or type coordinates directly.'
          : 'Place search is unavailable right now. Type coordinates directly, or pick a place you used before.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function reverseGeocode(point: GeoPoint): Promise<string | undefined> {
  if (!navigator.onLine) return undefined;
  try {
    const url = new URL(`${NOMINATIM_BASE}/reverse`);
    url.searchParams.set('lat', String(point.lat));
    url.searchParams.set('lon', String(point.lng));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('zoom', '16');

    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { display_name?: string };
    return data.display_name;
  } catch {
    return undefined;
  }
}

/* ------------------------------- Route planning ---------------------------- */

export interface PlanRouteInput {
  origin: GeoPoint;
  destination: GeoPoint;
  mode?: TransportMode;
  timeoutMs?: number;
}

export interface PlanRouteResult {
  route: RouteInfo;
  note: string;
}

/**
 * Fetches a road route from the configured OSRM-compatible service. The result
 * is cached inside the journey record, so the corridor keeps working offline.
 */
export async function planRoute(input: PlanRouteInput): Promise<PlanRouteResult> {
  const mode = input.mode ?? 'drive';

  if (!navigator.onLine) {
    return {
      route: straightLineRoute(input.origin, input.destination, mode),
      note: 'No connection, so this journey uses a straight-line corridor. Distances and the ETA are approximate until a route is fetched.',
    };
  }

  const profile = mode === 'walk' ? 'foot' : mode === 'cycle' ? 'bike' : 'driving';

  try {
    const url = `${appEnv.routingBaseUrl.replace(/\/$/, '')}/route/v1/${profile}/${input.origin.lng},${input.origin.lat};${input.destination.lng},${input.destination.lat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000);

    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Routing service answered ${response.status}`);

    const data = (await response.json()) as {
      routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
    };
    const route = data.routes?.[0];
    if (!route) throw new Error('No route returned');

    const geometry: GeoPoint[] = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));

    return {
      route: {
        provider: 'osrm',
        distanceMeters: Math.round(route.distance),
        durationMinutes: Math.max(1, Math.round(route.duration / 60)),
        geometry,
        fetchedAt: new Date().toISOString(),
        approximate: false,
      },
      note: 'Road route cached on this device for offline use.',
    };
  } catch {
    return {
      route: straightLineRoute(input.origin, input.destination, mode),
      note: 'The routing service could not be reached, so a straight-line corridor is used. Distances, ETA and deviation checks are approximate — the app says so wherever they appear.',
    };
  }
}

export function straightLineRoute(origin: GeoPoint, destination: GeoPoint, mode: TransportMode = 'drive'): RouteInfo {
  const geometry = interpolateLine(origin, destination, 24);
  const distanceMeters = haversineMeters(origin, destination);
  const speedKmh = mode === 'walk' ? 4.8 : mode === 'cycle' ? 14 : mode === 'transit' ? 18 : 28;

  return {
    provider: 'straight-line',
    distanceMeters: Math.round(distanceMeters),
    durationMinutes: Math.max(2, Math.round((distanceMeters / 1000 / speedKmh) * 60)),
    geometry,
    fetchedAt: new Date().toISOString(),
    approximate: true,
  };
}

/* ------------------------------ Coordinates -------------------------------- */

export interface ParsedCoordinates {
  point: GeoPoint;
  label: string;
}

/** Accepts "28.6139, 77.2090", "28.6139 77.2090" and DMS-ish input. */
export function parseCoordinateInput(input: string): ParsedCoordinates | undefined {
  const cleaned = input.trim().replace(/[°]/g, ' ').replace(/[NSns]/g, (match) => ` ${match} `);
  const numbers = cleaned.match(/-?\d+(\.\d+)?/g);
  if (!numbers || numbers.length < 2) return undefined;

  const lat = Number(numbers[0]);
  const lng = Number(numbers[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;

  return {
    point: { lat, lng },
    label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };
}

/** Suggests checkpoints spread along the route, so a plan exists in seconds. */
export function generateCheckpoints(input: {
  route: GeoPoint[];
  durationMinutes: number;
  count?: number;
}): Array<{ label: string; point: GeoPoint; offsetMinutes: number }> {
  const count = Math.max(1, Math.min(input.count ?? 3, 6));
  const geometry = input.route.length > 1 ? input.route : [];
  if (geometry.length === 0) return [];

  const suggestedLabels = [
    'Leaving the start point',
    'First waypoint',
    'Midway stop',
    'Second waypoint',
    'Approaching the destination',
    'Almost there',
  ];

  const results: Array<{ label: string; point: GeoPoint; offsetMinutes: number }> = [];
  for (let i = 1; i <= count; i += 1) {
    const fraction = i / (count + 1);
    const index = Math.min(geometry.length - 1, Math.round(fraction * (geometry.length - 1)));
    results.push({
      label: suggestedLabels[i - 1] ?? `Checkpoint ${i}`,
      point: geometry[index],
      offsetMinutes: Math.max(5, Math.round(input.durationMinutes * fraction)),
    });
  }
  return results;
}

export function transportLabel(mode: TransportMode): string {
  const labels: Record<TransportMode, string> = {
    walk: 'Walking',
    cycle: 'Cycling',
    drive: 'Driving',
    transit: 'Public transport',
    other: 'Other',
  };
  return labels[mode];
}

export function routeNote(route: RouteInfo | undefined): string {
  if (!route) return 'No route stored yet — the journey uses a straight-line corridor when monitoring starts.';
  if (route.approximate) {
    return `This route is approximate (${route.provider}). It is fine for check-ins and deviation warnings, but not for turn-by-turn navigation.`;
  }
  return `Road route cached on this device (${(route.distanceMeters / 1000).toFixed(1)} km, about ${route.durationMinutes} min).`;
}
