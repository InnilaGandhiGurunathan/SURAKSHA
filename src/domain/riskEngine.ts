/**
 * Safety Risk Engine
 * ------------------
 * A transparent, deterministic, rule-based scorer. No machine learning, no
 * inference about people — every point is an itemised, auditable reason you
 * can read in the "Why this score?" panel.
 *
 * Three ideas hold the whole thing together:
 *
 *  1. **Signals are grouped into families.** A route deviation and a repeated
 *     deviation are two halves of one worry, not two independent ones. Unrelated
 *     *families* stacking up is what compounds — and only up to a cap.
 *  2. **The ledger reconciles.** The sum of every reason's `delta` always equals
 *     the displayed score. The passive ceiling, the SOS floor and the band floor
 *     are emitted as their own reason lines, never applied silently.
 *  3. **The engine never concludes danger.** It raises a state so a human looks
 *     sooner. CRITICAL is reserved for the traveller explicitly saying so.
 */

import type { RiskAssessment, RiskBand, RiskReason, RiskSignalCode } from './types';

export const RISK_WEIGHTS = {
  /** Later than the planned arrival window (detours included). */
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
  /** Location is off entirely — we do not know where the traveller is. */
  locationLost: 25,
  /** Position has stopped updating but the device is still reachable. */
  locationStale: 10,
  /** Explicit distress signal — the traveller pressed Quick SOS. */
  explicitSos: 50,
  /** Credit applied when the traveller confirms safety after a signal. */
  safeConfirmationCredit: 15,
  /** Maximum total credit from confirmed-safe events. */
  safeConfirmationCreditCap: 30,
  /** Points added per *additional* unrelated signal family. */
  compoundingPerFamily: 6,
  /** Hard cap on the per-family compounding contribution. */
  compoundingCap: 18,
  /** Pairing bonus: in a flagged zone *and* not answering check-ins. */
  compoundingZoneUnreachable: 10,
  /** Pairing bonus: location lost *and* not answering check-ins. */
  compoundingLocationLost: 10,
  /**
   * Hard ceiling for passively detected signals. CRITICAL is reserved for the
   * traveller explicitly activating the emergency workflow.
   */
  passiveScoreCeiling: 74,
} as const;

/**
 * Signal families. Related events share a family so they are never treated as
 * fully independent worries.
 */
export type RiskFamily = 'late' | 'zone' | 'deviation' | 'checkin' | 'location' | 'sos';

export const RISK_FAMILY: Partial<Record<RiskSignalCode, RiskFamily>> = {
  late_arrival: 'late',
  risk_zone: 'zone',
  route_deviation: 'deviation',
  repeated_deviation: 'deviation',
  missed_checkin: 'checkin',
  repeated_missed_checkin: 'checkin',
  location_lost: 'location',
  location_stale: 'location',
  explicit_sos: 'sos',
};

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
  /** Position is unavailable — the traveller has gone dark. */
  locationLost: boolean;
  /** Position has stopped updating but the device is still reachable. */
  locationStale: boolean;
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
  locationLost: false,
  locationStale: false,
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
 * Deterministically score a journey. `scoreRisk()` is pure: the same inputs
 * always produce the same score and the same ordered reason list, and the
 * reason deltas always sum to the returned score.
 *
 * It reads no clock. An earlier version stamped the result with
 * `computedAt: Date.now()`, which made a function documented as pure depend on
 * the wall clock — and would have shown a real-world time beside a simulated
 * one the first time anything rendered it. Nothing ever read the field, so it
 * is gone rather than threaded through every caller.
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
            ? `${inputs.lateMinutes < 1 ? 'Less than 1' : Math.round(inputs.lateMinutes)} min past the expected arrival window (detours included)`
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

  /**
   * Location is its own family. "Lost" and "stale" describe the same worry at
   * two strengths, so only one of them is charged — otherwise a single outage
   * would be counted twice.
   */
  if (inputs.locationLost) {
    push(
      {
        code: 'location_lost',
        label: 'Location unavailable — traveller has gone dark',
        delta: RISK_WEIGHTS.locationLost,
        detail: 'No position is being received. The last known position is used.',
      },
    );
  } else if (inputs.locationStale) {
    push(
      {
        code: 'location_stale',
        label: 'Location updates have stopped',
        delta: RISK_WEIGHTS.locationStale,
        detail: 'The device is still reachable but has not sent a position recently.',
      },
    );
  }

  if (inputs.sosActive) {
    push({
      code: 'explicit_sos',
      label: 'Explicit distress signal (Quick SOS)',
      delta: RISK_WEIGHTS.explicitSos,
      detail: 'The traveller activated the emergency workflow',
    });
  }

  const families = new Set<RiskFamily>();
  reasons.forEach((reason) => {
    const family = RISK_FAMILY[reason.code];
    if (family) families.add(family);
  });

  /* --- Recovery: the traveller told us they are okay ----------------
   * A confirmed-safe message steps the score down (−15 per confirmation, capped
   * at −30) rather than erasing what happened. The events stay in the timeline.
   * It is never applied to an explicit SOS — you cannot cancel a distress call
   * by confirming safety; that needs an explicit resolution.
   */
  let creditApplied = 0;
  if (inputs.safeConfirmationCount > 0) {
    const positiveSum = reasons.reduce((sum, r) => sum + r.delta, 0);
    const credit = Math.min(
      inputs.safeConfirmationCount * RISK_WEIGHTS.safeConfirmationCredit,
      RISK_WEIGHTS.safeConfirmationCreditCap,
    );
    if (positiveSum > 0 && !inputs.sosActive) {
      creditApplied = Math.min(credit, positiveSum);
      reasons.push({
        code: 'safe_confirmation',
        label: 'Safety confirmed by traveller',
        delta: -creditApplied,
        detail: 'Resolves part of the raised signals — the event log still records them',
      });
    }
  }

  /* --- Compounding: unrelated worries stacking up ------------------- */
  const zoneOpen = families.has('zone');
  const checkinOpen = families.has('checkin');
  const locationOpen = families.has('location');

  /*
   * Compounding is forced to 0 while an explicit SOS is active. An SOS resolves
   * the uncertainty that compounding is modelling; amplifying it saturated the
   * score at 100 and broke the documented killer-flow arithmetic (20+25+50=95).
   */
  const sosActive = inputs.sosActive;
  const extraFamilies = Math.max(0, families.size - 1);
  const baseCompounding = sosActive
    ? 0
    : Math.min(extraFamilies * RISK_WEIGHTS.compoundingPerFamily, RISK_WEIGHTS.compoundingCap);
  const zoneUnreachable =
    !sosActive && zoneOpen && checkinOpen ? RISK_WEIGHTS.compoundingZoneUnreachable : 0;
  const locationUnreachable =
    !sosActive && locationOpen && checkinOpen ? RISK_WEIGHTS.compoundingLocationLost : 0;
  const compounding = baseCompounding + zoneUnreachable + locationUnreachable;

  if (compounding > 0) {
    const bonuses: string[] = [];
    if (zoneUnreachable) bonuses.push(`in a flagged zone while not answering (+${zoneUnreachable})`);
    if (locationUnreachable) bonuses.push(`location lost while not answering (+${locationUnreachable})`);
    push({
      code: 'compounding',
      label: 'Unrelated safety signals stacking up',
      delta: compounding,
      detail:
        `${families.size} independent signal families open — ${[...families].join(', ')}. ` +
        `Compounding is capped at +${RISK_WEIGHTS.compoundingCap}` +
        (bonuses.length ? `, plus ${bonuses.join(' and ')}` : ''),
    });
  }

  let sum = reasons.reduce((total, reason) => total + reason.delta, 0);

  /* --- Invariant 1: passive signals never reach CRITICAL ------------ */
  if (!sosActive && sum > RISK_WEIGHTS.passiveScoreCeiling) {
    const ceiling = RISK_WEIGHTS.passiveScoreCeiling;
    push({
      code: 'passive_ceiling',
      label: 'Held below CRITICAL',
      delta: ceiling - sum,
      detail:
        `Passively detected signals are capped at ${ceiling}. CRITICAL is reserved for the ` +
        'traveller explicitly activating the emergency workflow.',
    });
    sum = ceiling;
  }

  /* --- Invariant 2: an explicit SOS is always CRITICAL -------------- */
  if (sosActive && sum < bandRange('CRITICAL').min) {
    const floor = bandRange('CRITICAL').min;
    push({
      code: 'sos_floor',
      label: 'Explicit SOS pinned to CRITICAL',
      delta: floor - sum,
      detail: 'An explicit distress signal is always CRITICAL, so the number and the band never contradict.',
    });
    sum = floor;
  }

  /*
   * --- Hard cap: the score can never exceed 100 ----------------------
   *
   * Only reachable with an explicit SOS plus a pile of open signals. Emitted as
   * its own reason line for the same reason as the passive ceiling — a clamp
   * that is applied silently breaks the guarantee that the itemised reasons
   * reconcile to the number on screen.
   */
  if (sum > 100) {
    push({
      code: 'score_ceiling',
      label: 'Maximum score reached',
      delta: 100 - sum,
      detail: 'The score is capped at 100. Points above the cap are shown here rather than dropped.',
    });
    sum = 100;
  }

  /*
   * --- Band floor: one open signal reads as WATCH, not SAFE ----------
   *
   * Bands were purely score-based, and the heaviest single signal is +25, so no
   * single signal could ever leave SAFE. A traveller who had gone completely
   * silent still saw "SAFE — everything looks normal". The README already
   * documented WATCH as "one signal — confirm with the traveller", so the band
   * is floored while a signal is open.
   *
   * It is gated on *unrecovered worries*, counted in families — not in raw
   * reasons, because two deviations are one worry, not two. A worry that a
   * confirmed-safe message has cleared must not be dragged back up, or recovery
   * would stop working: one deviation plus one confirmation is 20 − 15 = 5 and
   * must stay SAFE, and a second deviation plus a confirmation must still fall.
   */
  const confirmationsConsumed =
    creditApplied > 0 ? Math.ceil(creditApplied / RISK_WEIGHTS.safeConfirmationCredit) : 0;
  const openFamilies = Math.max(0, families.size - confirmationsConsumed);
  if (!sosActive && sum < bandRange('WATCH').min && openFamilies > 0) {
    const floor = bandRange('WATCH').min;
    push({
      code: 'band_floor',
      label: 'Open signal — confirm with the traveller',
      delta: floor - sum,
      detail:
        `${openFamilies} signal family/families are still open after confirmed-safe credit. ` +
        'WATCH means "confirm with the traveller", not an emergency.',
    });
    sum = floor;
  }

  const score = Math.max(0, Math.min(100, Math.round(sum)));
  const band = bandForScore(score);

  return {
    score,
    band,
    reasons,
    headline: headlineFor(band, inputs, reasons),
    hasRecovery: reasons.some((r) => r.code === 'safe_confirmation'),
  };
}

function headlineFor(band: RiskBand, inputs: RiskInputs, reasons: RiskReason[]): string {
  const has = (code: RiskSignalCode) => reasons.some((r) => r.code === code);

  switch (band) {
    case 'SAFE':
      return inputs.safeConfirmationCount > 0
        ? 'Safety confirmed. No open signals.'
        : 'Everything looks normal.';
    case 'WATCH':
      if (has('route_deviation')) {
        return 'Route deviation detected. Awaiting traveller confirmation.';
      }
      if (has('location_lost')) {
        return "We have lost the traveller's location. Awaiting confirmation.";
      }
      if (has('late_arrival')) {
        return 'Traveller is later than planned. Awaiting confirmation.';
      }
      return 'A single safety signal was detected. Awaiting confirmation.';
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
/**
 * Reconciliation lines keep the ledger honest but are not things the engine
 * "detected", so they are kept out of the plain-language narrative.
 */
const BOOKKEEPING_CODES: RiskSignalCode[] = ['passive_ceiling', 'score_ceiling', 'band_floor', 'sos_floor'];

export function explainScore(assessment: RiskAssessment): string {
  const positives = assessment.reasons.filter(
    (r) => r.delta > 0 && !BOOKKEEPING_CODES.includes(r.code),
  );
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
    location_lost: 'a lost location signal',
    location_stale: 'location updates stopping',
    explicit_sos: 'an explicit SOS signal',
    safe_confirmation: 'a confirmed-safe message',
    compounding: 'several unrelated signals stacking up',
    passive_ceiling: 'the ceiling that applies to passively detected signals',
    score_ceiling: 'the cap on the maximum score',
    band_floor: 'the minimum band that applies while a signal is open',
    sos_floor: 'the floor that applies to an explicit SOS',
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
        title: 'One safety signal is open — confirm with the traveller',
        body: 'Nothing has been confirmed. A quick message is the right response, not an escalation.',
        tone: 'watch',
      };
    case 'ALERT':
      return {
        title: 'Multiple safety signals detected',
        body: 'Signals from unrelated sources have stacked up. Please acknowledge and try to reach the traveller.',
        tone: 'alert',
      };
    case 'CRITICAL':
    default:
      return {
        title: 'Emergency workflow activated',
        body: 'The traveller triggered SOS. Acknowledge now, then follow the escalation list. SURAKSHA never dials emergency services for you.',
        tone: 'critical',
      };
  }
}
