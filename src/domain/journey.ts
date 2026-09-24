/** Journey construction + derived read-outs (ETA, link quality, labels). */

import type { Journey, Point, UserProfile } from './types';
import { EMPTY_RISK_INPUTS, scoreRisk } from './riskEngine';
import { buildRoutePlan, CAMPUS_POINT, HOME_POINT, EXPECTED_ROUTE, TRAVELLER_ID } from './seed';
import { distanceToPath, pointAtProgress } from './geo';

export interface StartJourneyConfig {
  originLabel: string;
  destinationLabel: string;
  expectedArrivalAt: number;
  /** Planned duration in minutes, used for progress pacing. */
  etaMinutes: number;
  checkInIntervalMinutes: number;
  gracePeriodMinutes: number;
  primaryContactId: string;
  backupContactId: string;
  routePoints?: Point[];
  /** Demo pacing: first check-in after 60 s instead of a full interval. */
  demoPacing?: boolean;
  traveller?: UserProfile;
}

let journeyCounter = 0;

export function createJourney(config: StartJourneyConfig, now: number, travellerName: string): Journey {
  journeyCounter += 1;
  const id = `jny-${now.toString(36)}-${journeyCounter}`;
  const route = buildRoutePlan(config.routePoints ?? EXPECTED_ROUTE);
  const firstCheckInAt = now + (config.demoPacing ? 60_000 : config.checkInIntervalMinutes * 60_000);

  const escalationOrder = [config.primaryContactId, config.backupContactId].filter(Boolean);

  const skeleton: Journey = {
    id,
    travellerId: config.traveller?.id ?? TRAVELLER_ID,
    travellerName,
    originLabel: config.originLabel || 'IIT Campus',
    destinationLabel: config.destinationLabel || 'Home',
    startedAt: now,
    expectedArrivalAt: config.expectedArrivalAt,
    etaMinutes: Math.max(1, Math.round((config.expectedArrivalAt - now) / 60_000)),
    checkInIntervalMinutes: config.checkInIntervalMinutes,
    gracePeriodMinutes: config.gracePeriodMinutes,
    status: 'ACTIVE',
    primaryContactId: config.primaryContactId,
    backupContactId: config.backupContactId,
    escalationOrder,
    route,
    position: { ...route.expected[0] },
    progress: 0,
    offRouteProgress: 0,
    offRouteSince: null,
    offRouteAccumulatedMs: 0,
    lastPositionAt: now,
    locationAvailable: true,
    deviationActive: false,
    deviationCount: 0,
    inRiskZone: false,
    zoneExcursion: false,
    lateMinutes: 0,
    checkIn: {
      state: 'IDLE',
      dueAt: firstCheckInAt,
      requestedAt: null,
      expiresAt: null,
      lastCompletedAt: null,
      lastMissedAt: null,
      completedCount: 0,
      missedCount: 0,
    },
    risk: scoreRisk(EMPTY_RISK_INPUTS),
    safeConfirmationCount: 0,
    escalationLevel: 0,
    guardianNotifiedAt: null,
    guardianAcknowledgedAt: null,
    incidentId: null,
    pausedAt: null,
    endedAt: null,
    resolvedBy: null,
  };

  return skeleton;
}

/**
 * Estimated arrival = planned arrival + the time already lost off-route + a
 * projection of the current off-route delay. Deliberately conservative and
 * always labelled as an estimate.
 */
export function estimatedArrivalAt(journey: Journey, now: number): number {
  const currentDetour = journey.offRouteSince ? now - journey.offRouteSince : 0;
  return journey.expectedArrivalAt + journey.offRouteAccumulatedMs + currentDetour;
}

export function remainingMinutes(journey: Journey, now: number): number {
  return Math.max(0, Math.round((estimatedArrivalAt(journey, now) - now) / 60_000));
}

export function minutesLate(journey: Journey, now: number): number {
  const eta = estimatedArrivalAt(journey, now);
  return Math.max(0, Math.round((now - eta) / 60_000));
}

/** Distance of the traveller from the expected corridor, in map units. */
export function corridorDistance(journey: Journey): number {
  return distanceToPath(journey.position, journey.route.expected);
}

export type LinkQuality = 'connected' | 'delayed' | 'lost' | 'unavailable';

export function linkQuality(journey: Journey | null, now: number): LinkQuality {
  if (!journey) return 'unavailable';
  if (!journey.locationAvailable) return 'unavailable';
  const age = now - journey.lastPositionAt;
  if (age > 240_000) return 'lost';
  if (age > 90_000) return 'delayed';
  return 'connected';
}

export function positionOnRoute(journey: Journey): Point {
  return pointAtProgress(journey.route.expected, journey.progress);
}

export function originPoint(journey: Journey): Point {
  return journey.route.expected[0] ?? CAMPUS_POINT;
}

export function destinationPoint(journey: Journey): Point {
  return journey.route.expected[journey.route.expected.length - 1] ?? HOME_POINT;
}
