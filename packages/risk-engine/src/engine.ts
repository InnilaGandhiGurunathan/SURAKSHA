import {
  RISK_DISCLAIMER,
  RISK_THRESHOLDS,
  RISK_WEIGHTS,
  clampScore,
  bandForScore,
  distanceToRoute,
  routeProgress,
  polylineLengthMeters,
  type EscalationStage,
  type GeoPoint,
  type Journey,
  type JourneyEvent,
  type JourneyLocationPoint,
  type RiskAssessment,
  type RiskBand,
  type RiskSignal,
  type RiskSignalKind,
  type SafetyRules,
} from '@suraksha/shared';

/**
 * On-device rule-based risk engine.
 *
 * Design rules that must not be broken:
 *  1. **A single missed checkpoint never triggers an emergency.** A missed
 *     checkpoint is +10, which lands in the *low* band. Emergency workflow is
 *     reachable only from a manual SOS or an explicit "I am not safe" answer, or
 *     from the accumulation of several independent signals.
 *  2. Signals fade. A deviation an hour ago should not keep someone at high risk.
 *  3. Everything is explainable: each signal carries the human-readable reason it
 *     fired, and the assessment ships with its disclaimer attached.
 */

export interface AssessInput {
  journey: Journey;
  route?: GeoPoint[];
  track?: JourneyLocationPoint[];
  events?: JourneyEvent[];
  rules?: SafetyRules;
  now?: Date;
  /** Set when the traveller manually triggered SOS (bypasses accumulation). */
  manualSos?: boolean;
  /** Set when the traveller answered a check-in with "not safe". */
  declinedCheckIn?: boolean;
  /** Set when a check-in prompt expired without an answer (unreachable). */
  checkInTimedOutAt?: string;
  /** Set when the traveller confirmed they are safe (clears everything but SOS). */
  confirmedSafeAt?: string;
}

export const DEFAULT_SAFETY_RULES: SafetyRules = {
  missedCheckpointWeight: RISK_WEIGHTS.missed_checkpoint,
  deviationWeight: RISK_WEIGHTS.route_deviation,
  deviationContextWeight: RISK_WEIGHTS.route_deviation_contextual,
  delayWeight: RISK_WEIGHTS.journey_delay,
  unusualHourWeight: RISK_WEIGHTS.unusual_hour,
  gpsLostWeight: RISK_WEIGHTS.gps_lost,
  unreachableWeight: RISK_WEIGHTS.unreachable_checkin,
  declinedCheckInWeight: RISK_WEIGHTS.declined_checkin,
  manualSosWeight: RISK_WEIGHTS.manual_sos,
  autoEscalateMinSignals: 2,
  checkInGraceMinutes: 10,
  deviationThresholdMeters: 400,
  delayThresholdMinutes: 20,
  monitoringIntervalSeconds: 45,
  sosAutoNotifyContacts: true,
  shareLocationWithGuardians: true,
  vibrationAlerts: true,
  soundAlerts: false,
  silentSos: true,
  nightTimeStartHour: 22,
  nightTimeEndHour: 5,
};

const SIGNAL_TTL_MINUTES: Record<RiskSignalKind, number> = {
  missed_checkpoint: 45,
  route_deviation: 30,
  route_deviation_contextual: 45,
  deviation_persisted: 45,
  journey_delay: 90,
  unusual_hour: 120,
  gps_lost: 45,
  no_movement: 45,
  speed_anomaly: 30,
  unreachable_checkin: 60,
  declined_checkin: 120,
  manual_sos: 24 * 60,
  guardian_alert: 120,
};

function ageMinutes(iso: string | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 60_000;
}

function isNight(date: Date, rules: SafetyRules): boolean {
  const hour = date.getHours();
  const { nightTimeStartHour, nightTimeEndHour } = rules;
  return nightTimeStartHour > nightTimeEndHour
    ? hour >= nightTimeStartHour || hour < nightTimeEndHour
    : hour >= nightTimeStartHour && hour < nightTimeEndHour;
}

function signal(
  kind: RiskSignalKind,
  weight: number,
  detail: string,
  at: Date,
  contextual = false,
): RiskSignal {
  return { kind, weight: Math.round(weight), detail, at: at.toISOString(), contextual };
}

export interface JourneyEvaluation {
  deviationMeters: number;
  offRoute: boolean;
  progress: number;
  delayMinutes: number;
  travelledMeters: number;
  remainingMeters: number;
  latestPoint?: GeoPoint;
  movedRecently: boolean;
}

/** Computes the geometry facts the engine and the UI both need. */
export function evaluateJourneyGeometry(input: AssessInput): JourneyEvaluation {
  const { journey, track = [], route, now = new Date() } = input;
  const geometry = route && route.length > 1 ? route : [journey.origin, journey.destination];
  const points = track.map((entry) => entry.point);
  const latestPoint = points.length ? points[points.length - 1] : journey.lastKnownLocation;
  const total = polylineLengthMeters(geometry);

  if (!latestPoint) {
    return {
      deviationMeters: 0,
      offRoute: false,
      progress: 0,
      delayMinutes: 0,
      travelledMeters: 0,
      remainingMeters: total,
      movedRecently: false,
    };
  }

  const nearest = distanceToRoute(latestPoint, geometry);
  const progress = routeProgress(latestPoint, geometry);
  const travelled = total * progress;

  const reference = journey.startedAt ?? journey.scheduledStartAt;
  const elapsedMinutes = Math.max(0, (now.getTime() - new Date(reference).getTime()) / 60_000);
  const expectedArrivalMinutes = journey.route?.durationMinutes ?? estimatedMinutes(total);
  const delayMinutes = Math.max(0, Math.round(elapsedMinutes - expectedArrivalMinutes));

  const recent = track.filter((entry) => ageMinutes(entry.recordedAt, now) <= 20);
  const recentDistance = recent.length > 1 ? polylineLengthMeters(recent.map((r) => r.point)) : 0;
  const lastMovement = points.length > 1 ? polylineLengthMeters([points[points.length - 2], latestPoint]) : 0;

  return {
    deviationMeters: Math.round(nearest.distanceMeters),
    offRoute: nearest.distanceMeters > (input.rules?.deviationThresholdMeters ?? 400),
    progress,
    delayMinutes,
    travelledMeters: Math.round(travelled),
    remainingMeters: Math.round(Math.max(0, total - travelled)),
    latestPoint,
    movedRecently: recentDistance > 120 || lastMovement > 60,
  };
}

function estimatedMinutes(meters: number): number {
  const km = meters / 1000;
  return Math.max(2, Math.round((km / 28) * 60));
}

/**
 * Produces the assessment for a journey. Pure function: same inputs, same score.
 */
export function assessRisk(input: AssessInput): RiskAssessment {
  const rules = { ...DEFAULT_SAFETY_RULES, ...(input.rules ?? {}) };
  const now = input.now ?? new Date();
  const geometry = evaluateJourneyGeometry(input);
  const { journey } = input;
  const signals: RiskSignal[] = [];

  /* ------------------------- Explicit user-driven signals ------------------------ */

  if (input.manualSos) {
    signals.push(
      signal('manual_sos', rules.manualSosWeight, 'SOS was triggered on the device.', now),
    );
  }
  if (input.declinedCheckIn) {
    signals.push(
      signal(
        'declined_checkin',
        rules.declinedCheckInWeight,
        'The traveller answered a safety check-in with “I am not safe”.',
        now,
      ),
    );
  }
  if (input.checkInTimedOutAt && ageMinutes(input.checkInTimedOutAt, now) <= SIGNAL_TTL_MINUTES.unreachable_checkin) {
    signals.push(
      signal(
        'unreachable_checkin',
        rules.unreachableWeight,
        'A safety check-in went unanswered within its window.',
        new Date(input.checkInTimedOutAt),
      ),
    );
  }

  /* ------------------------------ Journey signals ------------------------------- */

  const missed = journey.checkpoints.filter((checkpoint) => {
    if (checkpoint.status !== 'missed') return false;
    return ageMinutes(checkpoint.missedAt ?? journey.updatedAt, now) <= SIGNAL_TTL_MINUTES.missed_checkpoint;
  });

  for (const checkpoint of missed) {
    signals.push(
      signal(
        'missed_checkpoint',
        rules.missedCheckpointWeight,
        `Checkpoint “${checkpoint.label}” was not confirmed in its window.`,
        new Date(checkpoint.missedAt ?? journey.updatedAt),
      ),
    );
  }

  if (journey.status === 'active' && geometry.offRoute) {
    const contextual = isNight(now, rules) || geometry.delayMinutes > rules.delayThresholdMinutes;
    signals.push(
      signal(
        'route_deviation',
        rules.deviationWeight,
        `You are about ${Math.round(geometry.deviationMeters)} m from the planned route.`,
        now,
      ),
    );
    if (contextual) {
      signals.push(
        signal(
          'route_deviation_contextual',
          rules.deviationContextWeight - rules.deviationWeight,
          `The deviation combines with ${isNight(now, rules) ? 'an unusual hour' : 'a significant delay'} (${geometry.delayMinutes} min).`,
          now,
          true,
        ),
      );
    }
    if (geometry.deviationMeters > rules.deviationThresholdMeters * 2) {
      signals.push(
        signal(
          'deviation_persisted',
          RISK_WEIGHTS.deviation_persisted,
          'The deviation is well outside the monitored corridor.',
          now,
        ),
      );
    }
  }

  if (journey.status === 'active' && geometry.delayMinutes >= rules.delayThresholdMinutes) {
    signals.push(
      signal(
        'journey_delay',
        rules.delayWeight,
        `Running about ${geometry.delayMinutes} min behind the planned arrival time.`,
        now,
      ),
    );
  }

  if (
    journey.status === 'active' &&
    isNight(now, rules) &&
    (geometry.offRoute || geometry.delayMinutes > rules.delayThresholdMinutes)
  ) {
    signals.push(
      signal('unusual_hour', rules.unusualHourWeight, 'It is late at night where you are.', now, true),
    );
  }

  if (journey.status === 'active' && input.track && input.track.length > 0) {
    const lastAt = input.track[input.track.length - 1].recordedAt;
    const sinceLastFix = ageMinutes(lastAt, now);
    if (sinceLastFix > 12) {
      signals.push(
        signal(
          'gps_lost',
          rules.gpsLostWeight,
          `No position has been recorded for ${Math.round(sinceLastFix)} minutes.`,
          new Date(lastAt),
        ),
      );
    } else if (sinceLastFix > 12 && !geometry.movedRecently) {
      signals.push(
        signal('no_movement', RISK_WEIGHTS.no_movement, 'No meaningful movement in the last 20 minutes.', now),
      );
    }
  }

  /* --------------------------------- Aggregation -------------------------------- */

  // An explicit "I am safe" answer clears accumulated signals, but never a SOS.
  const confirmedSafe =
    input.confirmedSafeAt && new Date(input.confirmedSafeAt).getTime() >= now.getTime() - 30 * 60_000;

  const effectiveSignals = confirmedSafe
    ? signals.filter((entry) => entry.kind === 'manual_sos' || entry.kind === 'declined_checkin')
    : signals;

  const missCounts = effectiveSignals.filter((entry) => entry.kind === 'missed_checkpoint').length;
  const rawScore = effectiveSignals.reduce((total, entry) => total + entry.weight, 0);
  const score = clampScore(rawScore);
  const band: RiskBand = bandForScore(score);

  const distinctive = effectiveSignals.filter((entry) => entry.kind !== 'missed_checkpoint').length;
  const accumulatedEnough = distinctive >= rules.autoEscalateMinSignals;

  const stage: EscalationStage = resolveStage({
    score,
    band,
    signals: effectiveSignals,
    accumulatedEnough,
    manualSos: Boolean(input.manualSos),
    declinedCheckIn: Boolean(input.declinedCheckIn),
  });

  const triggeredBy: RiskAssessment['triggeredBy'] = input.manualSos
    ? 'manual_sos'
    : input.declinedCheckIn
      ? 'declined_checkin'
      : stage === 'emergency_workflow' || stage === 'trusted_contact_notice'
        ? 'accumulated_signals'
        : undefined;

  const rationale = effectiveSignals.map((entry) => `+${entry.weight} ${entry.detail}`);

  return {
    score,
    band,
    stage,
    signals: effectiveSignals,
    rationale,
    // Anything beyond the check-in stage requires a person to have engaged with it.
    requiresHumanConfirmation:
      stage === 'discreet_checkin' || stage === 'trusted_contact_notice' || stage === 'emergency_workflow',
    triggeredBy,
    evaluatedAt: now.toISOString(),
    disclaimer: RISK_DISCLAIMER,
  };
}

function resolveStage(input: {
  score: number;
  band: RiskBand;
  signals: RiskSignal[];
  accumulatedEnough: boolean;
  manualSos: boolean;
  declinedCheckIn: boolean;
}): EscalationStage {
  // An explicit emergency always opens the workflow — the user asked for it.
  if (input.manualSos || input.declinedCheckIn) return 'emergency_workflow';

  const missedOnly = input.signals.every((entry) => entry.kind === 'missed_checkpoint');

  // The rule that matters most: one missed checkpoint must never escalate.
  if (missedOnly && input.signals.length <= 1) {
    return input.score >= RISK_THRESHOLDS.low ? 'monitoring' : 'monitoring';
  }

  if (input.band === 'high' || input.band === 'critical') {
    return input.accumulatedEnough ? 'trusted_contact_notice' : 'discreet_checkin';
  }
  if (input.band === 'medium') return 'discreet_checkin';
  // Low band: only a check-in when several independent signals agree.
  if (input.accumulatedEnough) return 'discreet_checkin';
  return 'monitoring';
}

export function stageLabel(stage: EscalationStage): string {
  const labels: Record<EscalationStage, string> = {
    monitoring: 'Quiet monitoring',
    discreet_checkin: 'Discreet safety check-in',
    trusted_contact_notice: 'Trusted contacts notified',
    emergency_workflow: 'Emergency workflow opened',
  };
  return labels[stage];
}

export function stageExplanation(stage: EscalationStage): string {
  const notes: Record<EscalationStage, string> = {
    monitoring:
      'SURAKSHA is watching the signals on your device. Nothing has been sent to anyone.',
    discreet_checkin:
      'A short, quiet check-in is offered on the device. If you confirm you are safe, accumulated signals are cleared. No contact is alerted at this stage.',
    trusted_contact_notice:
      'Several independent signals accumulated, so your selected trusted contacts are being told — along with the disclaimers about what that does and does not mean.',
    emergency_workflow:
      'The emergency workflow opened: location, journey details and recent events were captured, and your trusted contacts are being alerted through the channels that actually worked.',
  };
  return notes[stage];
}
