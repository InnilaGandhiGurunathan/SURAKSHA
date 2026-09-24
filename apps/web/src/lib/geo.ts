import type { GeoPoint } from '@suraksha/shared';

/** Geometry helpers. Pure functions — safe to run offline, easy to unit test. */

const EARTH_RADIUS_M = 6_371_008.8;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(point: unknown): point is GeoPoint {
  const candidate = point as GeoPoint | undefined;
  return (
    Boolean(candidate) &&
    typeof candidate?.lat === 'number' &&
    typeof candidate?.lng === 'number' &&
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    Math.abs(candidate.lat) <= 90 &&
    Math.abs(candidate.lng) <= 180
  );
}

/** Total length of a polyline in metres. */
export function polylineLengthMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

export interface NearestResult {
  distanceMeters: number;
  segmentIndex: number;
  projected: GeoPoint;
}

/**
 * Shortest distance from a point to a polyline, returning the projection so the
 * map can draw "you are here" relative to the planned route.
 */
export function distanceToPolyline(point: GeoPoint, line: GeoPoint[]): NearestResult {
  if (line.length === 0) return { distanceMeters: Number.POSITIVE_INFINITY, segmentIndex: 0, projected: point };
  if (line.length === 1) {
    return { distanceMeters: haversineMeters(point, line[0]), segmentIndex: 0, projected: line[0] };
  }

  let best: NearestResult = { distanceMeters: Number.POSITIVE_INFINITY, segmentIndex: 0, projected: line[0] };

  for (let i = 0; i < line.length - 1; i += 1) {
    const projection = projectOnSegment(point, line[i], line[i + 1]);
    const distance = haversineMeters(point, projection);
    if (distance < best.distanceMeters) {
      best = { distanceMeters: distance, segmentIndex: i, projected: projection };
    }
  }
  return best;
}

export function projectOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): GeoPoint {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = point.lng;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { lat: a.lat, lng: a.lng };
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { lat: ay + t * dy, lng: ax + t * dx };
}

/** Distance along the polyline to the projection of `point` (route progress). */
export function progressAlongRoute(point: GeoPoint, line: GeoPoint[]): number {
  if (line.length < 2) return 0;
  const nearest = distanceToPolyline(point, line);
  let travelled = 0;
  for (let i = 0; i < nearest.segmentIndex; i += 1) travelled += haversineMeters(line[i], line[i + 1]);
  return travelled + haversineMeters(line[nearest.segmentIndex], nearest.projected);
}

export function boundingBox(points: GeoPoint[], paddingDegrees = 0.01): [[number, number], [number, number]] {
  if (points.length === 0) {
    return [
      [28.55, 77.15],
      [28.65, 77.25],
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

export function centreOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lat: 28.6139, lng: 77.209 };
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Snap-to-route: greedy nearest-point consolidation with a distance threshold.
 * Keeps the stored track small enough for IndexedDB on a long journey.
 */
export function simplifyTrack(points: GeoPoint[], toleranceMeters = 25): GeoPoint[] {
  if (points.length <= 2) return [...points];
  const result: GeoPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (haversineMeters(result[result.length - 1], points[i]) >= toleranceMeters) result.push(points[i]);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function formatCoordinates(point: GeoPoint, digits = 5): string {
  return `${point.lat.toFixed(digits)}, ${point.lng.toFixed(digits)}`;
}

export function mapLinks(point: GeoPoint): { osm: string; geo: string } {
  return {
    osm: `https://www.openstreetmap.org/?mlat=${point.lat.toFixed(5)}&mlon=${point.lng.toFixed(5)}#map=17/${point.lat.toFixed(5)}/${point.lng.toFixed(5)}`,
    geo: `geo:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`,
  };
}

/** Rough ETA in minutes for a road distance at a per-mode average speed. */
export function estimateMinutes(distanceMeters: number, mode: 'walk' | 'drive' | 'transit' = 'drive'): number {
  const speeds = { walk: 4.8, drive: 28, transit: 18 } as const; // km/h, deliberately conservative
  const km = distanceMeters / 1000;
  return Math.max(1, Math.round((km / speeds[mode]) * 60));
}

/**
 * Tile maths for offline map packs. z/x/y slippy-map scheme, used both for the
 * downloader and for checking which tiles are already cached.
 */
export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export function lonToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

export function latToTileY(lat: number, zoom: number): number {
  const rad = toRadians(lat);
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

export function tilesForBounds(
  bounds: ReturnType<typeof boundingBox>,
  zoom: number,
): TileCoord[] {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const xMin = lonToTileX(minLng, zoom);
  const xMax = lonToTileX(maxLng, zoom);
  const yMin = latToTileY(maxLat, zoom);
  const yMax = latToTileY(minLat, zoom);
  const tiles: TileCoord[] = [];
  const limit = 400; // protects against an accidentally huge pack
  for (let x = xMin; x <= xMax && tiles.length < limit; x += 1) {
    for (let y = yMin; y <= yMax && tiles.length < limit; y += 1) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

export function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** Enumerates every tile for a bounding box across a zoom range. */
export function tileRange(bounds: ReturnType<typeof boundingBox>, minZoom: number, maxZoom: number): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    tiles.push(...tilesForBounds(bounds, zoom));
  }
  return tiles;
}

export function expandBounds(
  bounds: ReturnType<typeof boundingBox>,
  kilometres: number,
): ReturnType<typeof boundingBox> {
  const latDelta = kilometres / 110.574;
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const lngDelta = kilometres / (111.32 * Math.cos(toRadians((minLat + maxLat) / 2)) || 1);
  return [
    [minLat - latDelta, minLng - lngDelta],
    [maxLat + latDelta, maxLng + lngDelta],
  ];
}
