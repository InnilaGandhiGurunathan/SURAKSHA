import type { GeoPoint } from './types.js';

/** Framework-free geometry shared by the browser, the server and the tests. */

const EARTH_RADIUS_M = 6_371_008.8;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(point: unknown): point is GeoPoint {
  const candidate = point as GeoPoint | undefined;
  return (
    typeof candidate?.lat === 'number' &&
    typeof candidate?.lng === 'number' &&
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    Math.abs(candidate.lat) <= 90 &&
    Math.abs(candidate.lng) <= 180
  );
}

export function polylineLengthMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

export function projectOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): GeoPoint {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { lat: a.lat, lng: a.lng };
  let t = ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + t * dy, lng: a.lng + t * dx };
}

export interface NearestOnRoute {
  distanceMeters: number;
  segmentIndex: number;
  projected: GeoPoint;
}

export function distanceToRoute(point: GeoPoint, route: GeoPoint[]): NearestOnRoute {
  if (route.length === 0) {
    return { distanceMeters: Number.POSITIVE_INFINITY, segmentIndex: 0, projected: point };
  }
  if (route.length === 1) {
    return { distanceMeters: haversineMeters(point, route[0]), segmentIndex: 0, projected: route[0] };
  }

  let best: NearestOnRoute = {
    distanceMeters: Number.POSITIVE_INFINITY,
    segmentIndex: 0,
    projected: route[0],
  };

  for (let i = 0; i < route.length - 1; i += 1) {
    const projected = projectOnSegment(point, route[i], route[i + 1]);
    const distance = haversineMeters(point, projected);
    if (distance < best.distanceMeters) best = { distanceMeters: distance, segmentIndex: i, projected };
  }
  return best;
}

/** Fraction of the route already covered (0..1) based on the nearest projection. */
export function routeProgress(point: GeoPoint, route: GeoPoint[]): number {
  if (route.length < 2) return 0;
  const total = polylineLengthMeters(route);
  if (total === 0) return 0;
  const nearest = distanceToRoute(point, route);
  let travelled = 0;
  for (let i = 0; i < nearest.segmentIndex; i += 1) travelled += haversineMeters(route[i], route[i + 1]);
  travelled += haversineMeters(route[nearest.segmentIndex], nearest.projected);
  return Math.max(0, Math.min(1, travelled / total));
}

export function boundingBox(
  points: GeoPoint[],
  paddingDegrees = 0.01,
): [[number, number], [number, number]] {
  if (points.length === 0) {
    const fallback = { lat: 28.6139, lng: 77.209 };
    return [
      [fallback.lat - paddingDegrees, fallback.lng - paddingDegrees],
      [fallback.lat + paddingDegrees, fallback.lng + paddingDegrees],
    ];
  }
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  return [
    [minLat - paddingDegrees, minLng - paddingDegrees],
    [maxLat + paddingDegrees, maxLng + paddingDegrees],
  ];
}

export function expandBounds(
  bounds: [[number, number], [number, number]],
  kilometres: number,
): [[number, number], [number, number]] {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const latDelta = kilometres / 110.574;
  const midLat = (minLat + maxLat) / 2;
  const lngDelta = kilometres / Math.max(1, 111.32 * Math.cos(toRadians(midLat)));
  return [
    [minLat - latDelta, minLng - lngDelta],
    [maxLat + latDelta, maxLng + lngDelta],
  ];
}

export function centreOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lat: 28.6139, lng: 77.209 };
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Greedy track simplification so long journeys stay small in IndexedDB. */
export function simplifyTrack(points: GeoPoint[], toleranceMeters = 25): GeoPoint[] {
  if (points.length <= 2) return [...points];
  const out: GeoPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (haversineMeters(out[out.length - 1], points[i]) >= toleranceMeters) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function formatCoordinates(point: GeoPoint, digits = 5): string {
  return `${point.lat.toFixed(digits)}, ${point.lng.toFixed(digits)}`;
}

/** Bearing in degrees (0 = north) between two points. */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Interpolates `count` evenly spaced points along a straight line. Used for the
 * offline (approximate) route when no routing service is reachable — the result
 * is always labelled as approximate in the UI.
 */
export function interpolateLine(a: GeoPoint, b: GeoPoint, count: number): GeoPoint[] {
  const safeCount = Math.max(2, count);
  const points: GeoPoint[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const t = i / (safeCount - 1);
    points.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return points;
}
