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
import { scoreRisk, type RiskInputs } from './riskEngine';

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
  const pastExpectedArrival = now > journey.expectedArrivalAt;
  const lateMinutes = pastExpectedArrival
    ? Math.max(0, (now - journey.expectedArrivalAt) / 60_000)
    : 0;

  return {
    pastExpectedArrival,
    lateMinutes,
    inRiskZone: journey.inRiskZone,
    deviationCount: journey.deviationCount,
    deviationActive: journey.deviationActive,
    missedCheckInCount: journey.checkIn.missedCount,
    completedCheckInCount: journey.checkIn.completedCount,
    sosActive: journey.risk.reasons.some((r) => r.code === 'explicit_sos'),
    safeConfirmationCount: journey.safeConfirmationCount ?? 0,
  };
}

/** Recomputes the risk assessment for a journey at time `now`. */
export function assessJourney(journey: Journey, now: number): RiskAssessment {
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
      // A paused journey keeps its risk assessment live but does not accrue lateness.
      if (next.status !== 'PAUSED') {
        const late = now > next.expectedArrivalAt;
        next.lateMinutes = late ? Math.max(0, (now - next.expectedArrivalAt) / 60_000) : 0;
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
      const pausedFor = next.pausedAt ? now - next.pausedAt : 0;
      next.expectedArrivalAt += pausedFor;
      if (next.checkIn.dueAt) next.checkIn.dueAt += pausedFor;
      if (next.checkIn.expiresAt) next.checkIn.expiresAt += pausedFor;
      next.pausedAt = null;
      break;
    }

    case 'END': {
      next.status = 'ENDED';
      next.endedAt = now;
      next.checkIn = { ...next.checkIn, state: 'IDLE', dueAt: null, expiresAt: null, requestedAt: null };
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
  return Math.max(0, Math.min(1, (now - journey.startedAt) / total));
}

export function remainingMinutes(journey: Journey, now: number): number {
  return Math.max(0, Math.round((journey.expectedArrivalAt - now) / 60_000));
}
