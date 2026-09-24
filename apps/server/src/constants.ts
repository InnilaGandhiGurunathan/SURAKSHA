/** Server-side copies of the shared report vocabulary (kept dependency-free). */

export const REPORT_CATEGORIES = [
  'harassment',
  'stalking',
  'unsafe_area',
  'poor_lighting',
  'transport_issue',
  'accident',
  'medical',
  'theft',
  'suspicious_activity',
  'infrastructure',
  'other',
] as const;

export const REPORT_SUBMISSION_SOURCES = ['pwa', 'website', 'sms'] as const;

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/** Prototype risk weights, echoed by `/api/meta` for transparency and audits. */
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

export const DEFAULT_RISK_THRESHOLDS = { low: 10, medium: 25, high: 50, critical: 75 };
