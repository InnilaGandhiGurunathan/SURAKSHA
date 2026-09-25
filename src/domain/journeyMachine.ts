/**
 * Journey state machine.
 *
 *   SAFE ──route deviation──▶ WATCH ──missed check-in (+ persistent
 *   deviation)──▶ ALERT ──explicit SOS──▶ CRITICAL ──ack/resolve──▶ …
 *
 * The machine is deliberately *reversible*: a confirmed-safe message steps the
 * state down, and ending a journey resolves it. Escalation only ever raises the
 * floor while signals stay open.
 */

import type { Journey, JourneyStatus, RiskAssessment, RiskBand } from './types';
import { EMPTY_RISK_INPUTS, scoreRisk, type RiskInputs } from './riskEngine';
import {
  LOCATION_STALE_AFTER_MS,
  effectiveNow,
  minutesLate,
  remainingMinutes as remainingJourneyMinutes,
} from './journey';

export type JourneyAction =
  | { type: 'START'; journey: Journey }
  | { type: 'TICK' }
  | { type: 'ROUTE_DEVIATION' }
  | { type: 'ROUTE_RESTORED' }
  | { type: 'CHECKIN_DUE' }
  | { type: 'CHECKIN_MISSED' }
  | { type: 'SAFE_CONFIRMED' }
  | { type: 'SOS' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'END' };

const BAND_ORDER: RiskBand[] = ['SAFE', 'WATCH', 'ALERT', 'CRITICAL'];

export function bandRank(band: RiskBand): number {
  return BAND_ORDER.indexOf(band);
}

export function maxBand(a: RiskBand, b: RiskBand): RiskBand {
  return bandRank(a) >= bandRank(b) ? a : b;
}

export function journeyToRiskInputs(journey: Journey, now: number): RiskInputs {
  // Compare with the agreed deadline, not the continuously moving ETA.
  const at = effectiveNow(journey, now);
  const lateMinutes = minutesLate(journey, now);
  const pastExpectedArrival = journey.status !== 'ENDED' && lateMinutes > 0;

  /*
   * Location is now a first-class signal. "Lost" is an explicit outage; "stale"
   * is a stopped feed while the device is still reachable. Only one is charged.
   */
  const locationLost = !journey.locationAvailable;
  const locationAge = Math.max(0, at - journey.lastPositionAt);
  const locationStale = !locationLost && locationAge > LOCATION_STALE_AFTER_MS;

  return {
    pastExpectedArrival,
    lateMinutes,
    inRiskZone: journey.inRiskZone,
    deviationCount: journey.deviationCount,
    deviationActive: journey.deviationActive,
    missedCheckInCount: journey.checkIn.missedCount,
    completedCheckInCount: journey.checkIn.completedCount,
    locationLost,
    locationStale,
    sosActive: journey.risk.reasons.some((r) => r.code === 'explicit_sos'),
    safeConfirmationCount: journey.safeConfirmationCount ?? 0,
  };
}

/** Recomputes the risk assessment for a journey at time `now`. */
export function assessJourney(journey: Journey, now: number): RiskAssessment {
  if (journey.status === 'ENDED') return scoreRisk(EMPTY_RISK_INPUTS);
  return scoreRisk(journeyToRiskInputs(journey, now));
}

export function canTransition(from: JourneyStatus, action: JourneyAction['type']): boolean {
  switch (action) {
    case 'START':
      return from === 'ACTIVE';
    case 'PAUSE':
      return from === 'ACTIVE';
    case 'RESUME':
      return from === 'PAUSED';
    case 'END':
      return from === 'ACTIVE' || from === 'PAUSED';
    default:
      return from !== 'ENDED';
  }
}

/**
 * Applies an action and returns the next journey. Pure — the store supplies
 * timestamps and side effects (events, notifications).
 */
export function reduceJourney(journey: Journey, action: JourneyAction, now: number): Journey {
  const next: Journey = {
    ...journey,
    route: { ...journey.route },
    checkIn: { ...journey.checkIn },
    risk: journey.risk,
  };

  switch (action.type) {
    case 'START':
      return action.journey;

    case 'TICK': {
      // A paused journey keeps its risk assessment live but its timers frozen,
      // so lateness uses the agreed expected arrival and frozen pause clock.
      if (next.status !== 'PAUSED') {
        next.lateMinutes = minutesLate(next, now);
        // Earlier check-ins cannot pre-discount a newly overdue arrival.
        if (journey.lateMinutes === 0 && next.lateMinutes > 0) next.safeConfirmationCount = 0;
      }
      break;
    }

    case 'ROUTE_DEVIATION': {
      next.deviationActive = true;
      next.deviationCount = Math.max(1, next.deviationCount + 1);
      break;
    }

    case 'ROUTE_RESTORED': {
      next.deviationActive = false;
      break;
    }

    case 'CHECKIN_DUE': {
      next.checkIn = {
        ...next.checkIn,
        state: 'REQUESTED',
        requestedAt: now,
        expiresAt: now + next.gracePeriodMinutes * 60_000,
      };
      break;
    }

    case 'CHECKIN_MISSED': {
      next.checkIn = {
        ...next.checkIn,
        state: 'MISSED',
        lastMissedAt: now,
        missedCount: next.checkIn.missedCount + 1,
        dueAt: now + next.checkInIntervalMinutes * 60_000,
        expiresAt: null,
        requestedAt: null,
      };
      break;
    }

    case 'SAFE_CONFIRMED': {
      next.checkIn = {
        ...next.checkIn,
        state: 'COMPLETED',
        lastCompletedAt: now,
        requestedAt: null,
        expiresAt: null,
        dueAt: now + next.checkInIntervalMinutes * 60_000,
        completedCount: next.checkIn.completedCount + 1,
      };
      next.safeConfirmationCount = (next.safeConfirmationCount ?? 0) + 1;
      // Confirming safety means "I am okay right now" — the traveller is treated
      // as being back inside the corridor until the position says otherwise.
      next.deviationActive = false;
      break;
    }

    case 'SOS': {
      break;
    }

    case 'PAUSE': {
      next.status = 'PAUSED';
      next.pausedAt = now;
      break;
    }

    case 'RESUME': {
      next.status = 'ACTIVE';
      // Shift every deadline the pause was holding back, so resuming does not
      // immediately fire a check-in or escalate a help request that was frozen.
      const pausedFor = next.pausedAt ? now - next.pausedAt : 0;
      next.expectedArrivalAt += pausedFor;
      if (next.checkIn.dueAt) next.checkIn.dueAt += pausedFor;
      if (next.checkIn.expiresAt) next.checkIn.expiresAt += pausedFor;
      if (next.helpDeadlineAt) next.helpDeadlineAt += pausedFor;
      next.pausedAt = null;
      break;
    }

    case 'END': {
      next.status = 'ENDED';
      next.lateMinutes = minutesLate(journey, now);
      next.endedAt = now;
      next.checkIn = { ...next.checkIn, state: 'IDLE', dueAt: null, expiresAt: null, requestedAt: null };
      // An ended journey has nothing left to follow up on.
      next.helpRequestedAt = null;
      next.helpDeadlineAt = null;
      next.resolvedBy = bandRank(next.risk.band) >= bandRank('ALERT') ? 'resolved_after_alert' : 'ended_normally';
      break;
    }

    default:
      break;
  }

  next.risk = assessJourney(next, now);
  return next;
}

/**
 * Decides what the store should do next given the current journey and clock.
 * Returns a list of intent strings the store turns into events/notifications.
 */
export interface JourneyIntent {
  kind:
    | 'none'
    | 'request_checkin'
    | 'miss_checkin'
    | 'escalate_help'
    | 'escalate_guardian'
    | 'late_arrival'
    | 'risk_zone_entered'
    | 'risk_zone_left';
  detail?: string;
}

export function evaluateIntents(journey: Journey, now: number): JourneyIntent[] {
  if (journey.status !== 'ACTIVE') return [];
  const intents: JourneyIntent[] = [];

  const due = journey.checkIn.dueAt;
  const expires = journey.checkIn.expiresAt;

  /*
   * A help request that nobody answered inside its grace window escalates. This
   * is evaluated here, with the clock, rather than once when the button is
   * pressed — otherwise "I need help" stayed a fire-and-forget event that did
   * nothing if the traveller never heard back.
   */
  if (journey.helpDeadlineAt && now >= journey.helpDeadlineAt) {
    intents.push({ kind: 'escalate_help' });
  }

  // Any state except "currently being asked" can start a new check-in cycle —
  // a missed check-in must not silence every later prompt.
  if (journey.checkIn.state !== 'REQUESTED' && due && now >= due) {
    intents.push({ kind: 'request_checkin' });
  }
  if (journey.checkIn.state === 'REQUESTED' && expires && now >= expires) {
    intents.push({ kind: 'miss_checkin' });
  }
  return intents;
}

/** Progress along the planned journey, 0..1 based on elapsed time. */
export function timeProgress(journey: Journey, now: number): number {
  const total = journey.expectedArrivalAt - journey.startedAt;
  if (total <= 0) return 1;
  // A paused journey does not creep forward along the route.
  return Math.max(0, Math.min(1, (effectiveNow(journey, now) - journey.startedAt) / total));
}

/**
 * Kept for callers of this module. Delegates to `@/domain/journey` so there is
 * exactly one ETA implementation and it cannot drift out of step with the one
 * the risk engine scores against.
 */
export function remainingMinutes(journey: Journey, now: number): number {
  return remainingJourneyMinutes(journey, now);
}
