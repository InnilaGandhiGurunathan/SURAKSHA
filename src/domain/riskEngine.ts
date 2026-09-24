/**
 * Safety Risk Engine
 * ------------------
 * A transparent, deterministic, rule-based scorer. No machine learning, no
 * inference about people. It reads *observable signals* (the traveller is late,
 * the route changed, a check-in went unanswered, the traveller pressed SOS) and
 * returns a number plus a full explanation of every point in that number.
 *
 * Product principle: the score is a *conversation starter for the trusted
 * circle*, not a verdict about the traveller's safety.
 */

import type { RiskAssessment, RiskBand, RiskReason, RiskSignalCode } from './types';

export const RISK_WEIGHTS = {
  /** Later than the planned arrival window (or a user-selected late window). */
  lateArrival: 10,
  /** Position inside a mock "higher-risk zone" on the demo map. */
  riskZone: 15,
  /** Route deviates from the expected corridor. */
  routeDeviation: 20,
  /** Deviation keeps happening (2nd and later deviations). */
  repeatedDeviation: 10,
  /** A safety check-in was not answered inside the grace period. */
  missedCheckIn: 25,
  /** Extra weight for each additional unanswered check-in. */
  repeatedMissedCheckIn: 15,
  /** Hard cap on the repeated-missed contribution. */
  repeatedMissedCheckInCap: 30,
  /** Explicit distress signal — the traveller pressed Quick SOS. */
  explicitSos: 50,
  /** Credit applied when the traveller confirms safety after a signal. */
  safeConfirmationCredit: 15,
  /** Maximum total credit from confirmed-safe events. */
  safeConfirmationCreditCap: 30,
} as const;

export const RISK_BANDS: Array<{ band: RiskBand; min: number; max: number }> = [
  { band: 'SAFE', min: 0, max: 29 },
  { band: 'WATCH', min: 30, max: 49 },
  { band: 'ALERT', min: 50, max: 74 },
  { band: 'CRITICAL', min: 75, max: 100 },
];

export interface RiskInputs {
  /** Minutes past the expected arrival time (0 when on time). */
  lateMinutes: number;
  /** True when the expected arrival clock has already passed. */
  pastExpectedArrival: boolean;
  /** Traveller entered a mock higher-risk map zone. */
  inRiskZone: boolean;
  /** How many distinct route deviations happened this journey. */
  deviationCount: number;
  /** True while the traveller is currently outside the expected corridor. */
  deviationActive: boolean;
  /** How many check-ins went unanswered past the grace period. */
  missedCheckInCount: number;
  /** Check-ins the traveller answered. */
  completedCheckInCount: number;
  /** Quick SOS is active for this journey. */
  sosActive: boolean;
  /** Times the traveller confirmed safety after a signal was raised. */
  safeConfirmationCount: number;
}

export const EMPTY_RISK_INPUTS: RiskInputs = {
  lateMinutes: 0,
  pastExpectedArrival: false,
  inRiskZone: false,
  deviationCount: 0,
  deviationActive: false,
  missedCheckInCount: 0,
  completedCheckInCount: 0,
  sosActive: false,
  safeConfirmationCount: 0,
};

export function bandForScore(score: number): RiskBand {
  const found = RISK_BANDS.find((b) => score >= b.min && score <= b.max);
  return found ? found.band : 'CRITICAL';
}

export function bandRange(band: RiskBand): { min: number; max: number } {
  const found = RISK_BANDS.find((b) => b.band === band);
  return found ?? { min: 0, max: 29 };
}

/**
 * Deterministically score a journey. `scoreFor()` is pure: the same inputs
 * always produce the same score and the same ordered reason list.
 */
export function scoreRisk(inputs: RiskInputs): RiskAssessment {
  const reasons: RiskReason[] = [];
  const push = (reason: RiskReason) => {
    reasons.push(reason);
  };

  /* --- Positive contributions (signals detected) --------------------
   * A signal that happened stays in the ledger for the whole journey: the
   * traveller's guardian can see what occurred even after it was resolved.
   */

  if (inputs.pastExpectedArrival || inputs.lateMinutes > 0) {
    push(
      {
        code: 'late_arrival',
        label: 'Traveller is past the expected arrival time',
        delta: RISK_WEIGHTS.lateArrival,
        detail:
          inputs.lateMinutes > 0
            ? `${Math.round(inputs.lateMinutes)} min past the planned arrival window`
            : 'Expected arrival time has passed',
      },
    );
  }

  if (inputs.inRiskZone) {
    push(
      {
        code: 'risk_zone',
        label: 'Inside a higher-risk zone (demo map area)',
        delta: RISK_WEIGHTS.riskZone,
        detail: 'This is a fictional zone used for the demo, not a claim about a real place',
      },
    );
  }

  if (inputs.deviationCount >= 1) {
    push(
      {
        code: 'route_deviation',
        label: 'Route deviation detected',
        delta: RISK_WEIGHTS.routeDeviation,
        detail: inputs.deviationActive
          ? 'Currently outside the expected route corridor'
          : 'Off the expected corridor earlier in this journey',
      },
    );
  }

  if (inputs.deviationCount >= 2) {
    push(
      {
        code: 'repeated_deviation',
        label: 'Repeated route deviation',
        delta: RISK_WEIGHTS.repeatedDeviation,
        detail: `${inputs.deviationCount} separate deviations from the expected route`,
      },
    );
  }

  if (inputs.missedCheckInCount >= 1) {
    push(
      {
        code: 'missed_checkin',
        label: 'Safety check-in missed',
        delta: RISK_WEIGHTS.missedCheckIn,
        detail: `No response within the grace period (${inputs.missedCheckInCount} unanswered)`,
      },
    );
  }

  if (inputs.missedCheckInCount >= 2) {
    const extra = Math.min(
      (inputs.missedCheckInCount - 1) * RISK_WEIGHTS.repeatedMissedCheckIn,
      RISK_WEIGHTS.repeatedMissedCheckInCap,
    );
    push(
      {
        code: 'repeated_missed_checkin',
        label: 'Additional missed check-ins',
        delta: extra,
        detail: `${inputs.missedCheckInCount - 1} more unanswered check-in(s), capped at +${RISK_WEIGHTS.repeatedMissedCheckInCap}`,
      },
    );
  }

  if (inputs.sosActive) {
    reasons.push({
      code: 'explicit_sos',
      label: 'Explicit distress signal (Quick SOS)',
      delta: RISK_WEIGHTS.explicitSos,
      detail: 'The traveller activated the emergency workflow',
    });
  }

  /* --- Recovery: the traveller told us they are okay ----------------
   * A confirmed-safe message steps the score down (−15 per confirmation, capped
   * at −30) rather than erasing what happened. Two confirmations clear a
   * deviation + missed check-in; the events stay in the timeline.
   */
  if (inputs.safeConfirmationCount > 0) {
    const positiveSum = reasons.reduce((sum, r) => sum + r.delta, 0);
    const credit = Math.min(
      inputs.safeConfirmationCount * RISK_WEIGHTS.safeConfirmationCredit,
      RISK_WEIGHTS.safeConfirmationCreditCap,
    );
    if (positiveSum > 0 && !inputs.sosActive) {
      reasons.push({
        code: 'safe_confirmation',
        label: 'Safety confirmed by traveller',
        delta: -Math.min(credit, positiveSum),
        detail: 'Resolves part of the raised signals — the event log still records them',
      });
    }
  }

  const raw = reasons.reduce((sum, r) => sum + r.delta, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const band = bandForScore(score);

  return {
    score,
    band,
    reasons,
    headline: headlineFor(band, inputs, reasons),
    hasRecovery: reasons.some((r) => r.delta < 0),
    computedAt: Date.now(),
  };
}

function headlineFor(band: RiskBand, inputs: RiskInputs, reasons: RiskReason[]): string {
  switch (band) {
    case 'SAFE':
      return inputs.safeConfirmationCount > 0
        ? 'Safety confirmed. No open signals.'
        : 'Everything looks normal.';
    case 'WATCH':
      return reasons.some((r) => r.code === 'route_deviation')
        ? 'Route deviation detected. Awaiting traveller confirmation.'
        : 'A single safety signal was detected. Awaiting confirmation.';
    case 'ALERT':
      return 'Multiple safety signals detected. Guardian escalation in progress.';
    case 'CRITICAL':
    default:
      return 'Emergency workflow activated by the traveller.';
  }
}

export function describeReason(reason: RiskReason): string {
  const sign = reason.delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(reason.delta)} ${reason.label}`;
}

/**
 * Explains, in plain language, what the number is and — more importantly —
 * what it is not. Used by the "Why this score?" panel.
 */
export function explainScore(assessment: RiskAssessment): string {
  const positives = assessment.reasons.filter((r) => r.delta > 0);
  if (positives.length === 0) {
    return 'No safety signals are open right now. The score reflects journey timing, route status and completed check-ins.';
  }

  const names: Record<RiskSignalCode, string> = {
    late_arrival: 'a later-than-expected arrival',
    risk_zone: 'movement inside a demo higher-risk zone',
    route_deviation: 'a route deviation',
    repeated_deviation: 'repeated route deviations',
    missed_checkin: 'a missed safety check-in',
    repeated_missed_checkin: 'several unanswered check-ins',
    explicit_sos: 'an explicit SOS signal',
    safe_confirmation: 'a confirmed-safe message',
  };
  const listed = positives.map((r) => names[r.code]).filter(Boolean);
  const last = listed.pop();
  const phrase = listed.length ? `${listed.join(', ')} and ${last}` : last ?? '';

  return `The safety state increased because the Safety Risk Engine detected ${phrase}. This does not determine that you are in danger — it tells your trusted circle where to look first.`;
}

export function guardianActionFor(band: RiskBand): {
  title: string;
  body: string;
  tone: 'safe' | 'watch' | 'alert' | 'critical';
} {
  switch (band) {
    case 'SAFE':
      return {
        title: 'Journey proceeding normally',
        body: 'No action required. SURAKSHA will raise this card if a signal appears.',
        tone: 'safe',
      };
    case 'WATCH':
      return {
        title: 'Traveller is late or a minor anomaly was detected',
        body: 'Nothing has been confirmed. Consider a quick message to check in.',
        tone: 'watch',
      };
    case 'ALERT':
      return {
        title: 'Multiple safety signals detected',
        body: 'Route deviation and an unanswered check-in. Please acknowledge and try to reach the traveller.',
        tone: 'alert',
      };
    case 'CRITICAL':
    default:
      return {
        title: 'Emergency workflow activated',
        body: 'The traveller triggered SOS. Acknowledge now, then follow the escalation list. SURAKSHA does not contact emergency services for you.',
        tone: 'critical',
      };
  }
}
