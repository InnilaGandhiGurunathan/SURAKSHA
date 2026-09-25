/**
 * Routing engine — Google-Maps-style route and ETA computation.
 *
 * SURAKSHA's demo map is a *fictional* planar surface, so a real routing API
 * cannot answer for it. This module mirrors the *shape* of a maps backend:
 * per-mode routes (fastest / walking / cycling / car / premium), a traffic
 * model (light / moderate / heavy), an avoid filter, a speed modifier and a
 * departure-time / arrive-by solver. Every number is labelled an estimate in
 * the UI.
 */

import type { AvoidOption, Point, RouteMode, RouteOption, RouteWaypoint } from './types';
import { pathLength } from './geo';

/** Platform speeds (m/s). Premium is a paid "SURAKSHA Guard" tier. */
interface ModeProfile {
  mode: RouteMode;
  label: string;
  kind: string;
  /** Nominal free-flow speed in the demo's metres-ish units. */
  speed: number;
  /** Route geometry multiplier vs the straight-line path. */
  detour: number;
  /** Typical buffer minutes added on top of free flow. */
  bufferMin: number;
  premium?: boolean;
}

export const MODE_PROFILES: ModeProfile[] = [
  { mode: 'fastest', label: 'Fastest', kind: 'car', speed: 13.9, detour: 1.0, bufferMin: 2 },
  { mode: 'walking', label: 'Walking', kind: 'walking', speed: 1.39, detour: 0.86, bufferMin: 1 },
  { mode: 'cycling', label: 'Cycling', kind: 'cycling', speed: 5.56, detour: 0.92, bufferMin: 2 },
  { mode: 'car', label: 'Car', kind: 'car', speed: 11.11, detour: 1.12, bufferMin: 3 },
  { mode: 'premium', label: 'SURAKSHA Guard', kind: 'premium', speed: 13.9, detour: 1.02, bufferMin: 1, premium: true },
];

export const TRAFFIC_MULTIPLIER: Record<'light' | 'moderate' | 'heavy', number> = {
  light: 1.0,
  moderate: 1.25,
  heavy: 1.55,
};

export const AVOID_META: Array<{ id: AvoidOption; label: string; detail: string }> = [
  { id: 'ferries', label: 'Avoid ferries', detail: 'Skip water crossings on the route' },
  { id: 'highways', label: 'Avoid highways', detail: 'Prefer surface streets where possible' },
  { id: 'tolls', label: 'Avoid tolls', detail: 'Steer around paid road segments' },
];

export function profileFor(mode: RouteMode): ModeProfile {
  return MODE_PROFILES.find((p) => p.mode === mode) ?? MODE_PROFILES[0];
}

/** Traffic level derived from what the traveller asked to avoid. */
export function selectedPlatformLabel(platform: string): string {
  return (
    ({ fastest: 'Fastest', walking: 'Walking', cycling: 'Cycling', car: 'Car', premium: 'SURAKSHA Guard' } as Record<
      string,
      string
    >)[platform] ?? platform
  );
}

export function resolveTraffic(preferences: { avoid: AvoidOption[] }): 'light' | 'moderate' | 'heavy' {
  if (preferences.avoid.includes('highways')) return 'heavy';
  if (preferences.avoid.includes('tolls')) return 'moderate';
  return 'light';
}

/** Straight-line path distance in kilometres across the demo map. */
export function straightDistanceKm(routePoints: Point[]): number {
  return Math.max(0.2, pathLength(routePoints) / 1000);
}

/**
 * Build the full option set the route tabs render, in fixed tab order.
 * `speedFactor` (the customer's custom-speed slider) scales the kinetic part;
 * traffic and mode buffer ride on top. Always >= 1 minute.
 */
export function buildRouteOptions(routePoints: Point[], speedFactor: number, traffic: 'light' | 'moderate' | 'heavy'): RouteOption[] {
  const straightKm = straightDistanceKm(routePoints);
  return MODE_PROFILES.map((profile) => {
    const distanceKm = Math.max(0.9, +(straightKm * profile.detour * ((profile.detour - 0.5) / 1.72 + 0.7)).toFixed(1));
    const kinetic = ((distanceKm * 1000) / profile.speed / 60) * speedFactor;
    const durationMin = Math.max(1, Math.round(kinetic * (TRAFFIC_MULTIPLIER[traffic] ?? 1) + profile.bufferMin));
    const waypoints: RouteWaypoint[] = [
      { label: 'Leave on the main corridor', real: false },
      ...(distanceKm > 3.5
        ? [{ label: `Continue straight past 2 junctions (~${Math.max(1, Math.round(distanceKm * 0.6))} km)`, real: false } as RouteWaypoint]
        : []),
      { label: 'Arrive at the destination', real: false },
    ];
    return {
      mode: profile.mode,
      label: profile.label,
      distanceKm,
      durationMin,
      traffic,
      waypoints,
    };
  });
}

export interface ArrivalSolverResult {
  /** The departure timestamp the solver runs on. */
  departureAt: number;
  /** The chosen option's duration in minutes. */
  durationMin: number;
  /** The absolute arrival timestamp. */
  arrivalAt: number;
  /** `now` (the virtual clock) for display. */
  now: number;
}

/**
 * Resolve "arrive by" → "leave at", exactly like a maps app: given an
 * arrival-at term and a route duration, the departure time falls out.
 */
export function solveArrival(arrivalAt: number, durationMin: number): { departureAt: number; arrivalAt: number } {
  const departureAt = arrivalAt - durationMin * 60_000;
  return { departureAt, arrivalAt: departureAt + durationMin * 60_000 };
}
