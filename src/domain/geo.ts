/**
 * Simulated geospatial helpers.
 *
 * SURAKSHA's demo uses a *fictional* planar map (map units ≈ metres) instead of
 * real GPS. Everything here is deterministic geometry: distance to a corridor,
 * moving a point along a polyline, and mapping map units to a plausible-looking
 * coordinate string for display.
 */

import type { Point } from './types';

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 680;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

/** Point at a normalised distance (0..1) along a polyline. */
export function pointAtProgress(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, t));
  const target = clamped * pathLength(points);
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const segment = distance(points[i - 1], points[i]);
    if (travelled + segment >= target) {
      const local = segment === 0 ? 0 : (target - travelled) / segment;
      return lerpPoint(points[i - 1], points[i], local);
    }
    travelled += segment;
  }
  return points[points.length - 1];
}

/** Shortest distance from `p` to the polyline (used for corridor checks). */
export function distanceToPath(p: Point, points: Point[]): number {
  if (points.length < 2) return points.length === 1 ? distance(p, points[0]) : Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Appends a sample to the travelled trail, skipping near-duplicate points. */
export function pushTrail(trail: Point[], p: Point, minGap = 2): Point[] {
  const last = trail[trail.length - 1];
  if (last && distance(last, p) < minGap) return trail;
  const next = [...trail, p];
  return next.length > 400 ? next.slice(next.length - 400) : next;
}

/**
 * Builds a believable "side street" branch leaving the expected corridor at
 * `startProgress` — used when the demo moves the traveller off route.
 */
export function buildDeviationBranch(points: Point[], startProgress: number): Point[] {
  const start = pointAtProgress(points, startProgress);
  const ahead = pointAtProgress(points, Math.min(1, startProgress + 0.12));
  const dx = ahead.x - start.x;
  const dy = ahead.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector, rotated toward a "side road" direction.
  const nx = -dy / len;
  const ny = dx / len;
  const side = nx > 0 ? 1 : -1;
  const lateral = side * 96;
  return [
    start,
    { x: start.x + dx * 0.16 + nx * lateral * 0.35, y: start.y + dy * 0.16 + ny * lateral * 0.35 },
    { x: start.x + dx * 0.3 + nx * lateral * 0.85, y: start.y + dy * 0.3 + ny * lateral * 0.85 },
    { x: start.x + dx * 0.46 + nx * lateral, y: start.y + dy * 0.46 + ny * lateral },
    { x: start.x + dx * 0.72 + nx * lateral * 1.05, y: start.y + dy * 0.72 + ny * lateral * 1.05 },
    { x: start.x + dx * 0.98 + nx * lateral * 0.75, y: start.y + dy * 0.98 + ny * lateral * 0.75 },
  ];
}

/** Mock "higher-risk zone" — a fictional area on the demo map. */
export const RISK_ZONE = {
  id: 'zone-north-underpass',
  label: 'Underpass area (demo zone)',
  polygon: [
    { x: 300, y: 96 },
    { x: 470, y: 80 },
    { x: 512, y: 214 },
    { x: 356, y: 246 },
  ] as Point[],
};

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon: Point[]): Point {
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

/**
 * Fictional coordinate display. The demo map is not tied to any real place;
 * these numbers are derived from the planar map so the UI still reads like a
 * location readout, and are always labelled "simulated".
 */
export function toLatLng(p: Point): { lat: number; lng: number } {
  const lat = 28.545 + (MAP_HEIGHT / 2 - p.y) / 111_320;
  const lng = 77.1926 + (p.x - MAP_WIDTH / 2) / (111_320 * Math.cos((28.545 * Math.PI) / 180));
  return { lat, lng };
}

export function formatLatLng(p: Point): string {
  const { lat, lng } = toLatLng(p);
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

export function compassFrom(p: Point, q: Point): string {
  const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const index = Math.round((((angle + 360) % 360) / 45)) % 8;
  return dirs[index];
}

export function toSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
