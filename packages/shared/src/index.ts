export * from './types.js';
export * from './geo.js';
export * from './reporting.js';

/**
 * Prototype risk weights.
 *
 * These are the numbers published in the product brief: a missed checkpoint is
 * worth +10, a contextually unusual route deviation +25 and a manual SOS +50.
 * They are **heuristics with invented weights** — the UI must always say so.
 */
export const RISK_WEIGHTS = {
  missed_checkpoint: 10,
  route_deviation: 12,
  route_deviation_contextual: 25,
  deviation_persisted: 10,
  journey_delay: 15,
  unusual_hour: 8,
  gps_lost: 6,
  no_movement: 10,
  speed_anomaly: 8,
  unreachable_checkin: 20,
  declined_checkin: 45,
  manual_sos: 50,
  guardian_alert: 10,
} as const;

export const RISK_THRESHOLDS = { low: 10, medium: 25, high: 50, critical: 75 } as const;

export const RISK_DISCLAIMER =
  'Heuristic indicator from on-device rules with prototype weights — not a probability, and not validated against real incident data.';

export const MONITORING_DISCLAIMER =
  'Monitoring runs on this device only. If the phone is off, out of battery or without a GPS fix, it stops and nobody is automatically watching.';

export const SHARE_DISCLAIMER =
  'Guardian views are end-to-end encrypted and expire automatically. They update only when the traveller’s device has a connection.';

export const MAX_OFFLINE_TILE_ZOOM = 16;
export const MIN_OFFLINE_TILE_ZOOM = 11;

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function bandForScore(score: number): 'safe' | 'low' | 'medium' | 'high' | 'critical' {
  if (score >= RISK_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.medium) return 'medium';
  if (score >= RISK_THRESHOLDS.low) return 'low';
  return 'safe';
}
