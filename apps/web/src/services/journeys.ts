import {
  type GeoPoint,
  type Journey,
  type JourneyCheckpoint,
  type JourneyStatus,
  type RouteInfo,
  type TransportMode,
  type UserProfile,
} from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { JOURNEY_DEFAULTS } from '@/lib/constants';
import { minutesBetween, toDate } from '@/lib/time';
import { estimateMinutes } from '@/lib/geo';
import { recordEvent } from './events';
import { enqueue, PRIORITY } from './outbox';

/**
 * Journeys — created, monitored and completed entirely on the device.
 *
 * A journey stores its checkpoints, its guardian selection and (optionally) a
 * cached route. Nothing about creating one needs a network: the route is fetched
 * opportunistically, and if routing is unavailable the journey is stored with an
 * explicitly approximate straight-line corridor that the UI labels as such.
 */

export interface CreateJourneyInput {
  owner: UserProfile;
  title: string;
  originLabel: string;
  origin: GeoPoint;
  destinationLabel: string;
  destination: GeoPoint;
  scheduledStartAt: string;
  transportMode: TransportMode;
  checkpoints?: JourneyCheckpoint[];
  guardianContactIds?: string[];
  route?: RouteInfo;
  notes?: string;
  /** Offline map pack id, set once the corridor download finishes. */
  mapPackId?: string;
  isDemo?: boolean;
}

export function makeCheckpoint(input: {
  label: string;
  location: GeoPoint;
  expectedOffsetMinutes: number;
  windowMinutes?: number;
}): JourneyCheckpoint {
  return {
    id: uuid(),
    label: input.label,
    location: input.location,
    expectedOffsetMinutes: input.expectedOffsetMinutes,
    windowMinutes: input.windowMinutes ?? JOURNEY_DEFAULTS.checkInGraceMinutes,
    status: 'pending',
  };
}

export function buildRouteInfo(geometry: GeoPoint[], durationMinutes: number, provider: RouteInfo['provider']): RouteInfo {
  const totalMeters = geometry.length > 1 ? polylineLength(geometry) : 0;
  return {
    provider,
    distanceMeters: Math.round(totalMeters),
    durationMinutes: Math.max(1, Math.round(durationMinutes)),
    geometry,
    fetchedAt: new Date().toISOString(),
    approximate: provider !== 'osrm' && provider !== 'cached',
  };
}

function polylineLength(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += roughMeters(points[i - 1], points[i]);
  return total;
}

function roughMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export async function createJourney(input: CreateJourneyInput): Promise<Journey> {
  const now = new Date().toISOString();
  const route = input.route;
  const expectedArrivalAt = route
    ? new Date(new Date(input.scheduledStartAt).getTime() + route.durationMinutes * 60_000).toISOString()
    : new Date(new Date(input.scheduledStartAt).getTime() + estimateMinutes(3000, 'drive') * 60_000).toISOString();

  const journey: Journey = {
    id: uuid(),
    ownerId: input.owner.id,
    title: input.title.trim() || `${input.originLabel} → ${input.destinationLabel}`,
    status: 'planned',
    transportMode: input.transportMode,
    originLabel: input.originLabel,
    origin: input.origin,
    destinationLabel: input.destinationLabel,
    destination: input.destination,
    scheduledStartAt: input.scheduledStartAt,
    expectedArrivalAt,
    checkpoints: input.checkpoints ?? [],
    route,
    corridorMeters: JOURNEY_DEFAULTS.deviationThresholdMeters,
    guardianContactIds: input.guardianContactIds ?? [],
    monitoringEnabled: true,
    notes: input.notes,
    mapPackId: input.mapPackId,
    isDemo: input.isDemo,
    createdAt: now,
    updatedAt: now,
  };

  await db.journeys.put(journey);
  await recordEvent({
    ownerId: input.owner.id,
    journeyId: journey.id,
    type: 'journey_created',
    message: `Journey planned: ${journey.originLabel} → ${journey.destinationLabel} (${journey.checkpoints.length} checkpoint(s)).`,
    data: { approximateRoute: Boolean(route?.approximate) },
    isDemo: input.isDemo,
  });
  await queueJourney(journey);
  return journey;
}

export async function updateJourney(journeyId: string, patch: Partial<Journey>): Promise<void> {
  await db.journeys.update(journeyId, { ...patch, updatedAt: new Date().toISOString() });
  const journey = await db.journeys.get(journeyId);
  if (journey) await queueJourney(journey);
}

async function queueJourney(journey: Journey): Promise<void> {
  await enqueue({
    ownerId: journey.ownerId,
    kind: 'journey',
    priority: PRIORITY.journey,
    endpoint: '/journeys',
    method: 'POST',
    body: serialiseJourney(journey),
    dedupeKey: `journey:${journey.id}`,
  });
}

export function serialiseJourney(journey: Journey): Record<string, unknown> {
  return {
    id: journey.id,
    ownerId: journey.ownerId,
    title: journey.title,
    status: journey.status,
    transportMode: journey.transportMode,
    originLabel: journey.originLabel,
    origin: journey.origin,
    destinationLabel: journey.destinationLabel,
    destination: journey.destination,
    scheduledStartAt: journey.scheduledStartAt,
    startedAt: journey.startedAt,
    completedAt: journey.completedAt,
    expectedArrivalAt: journey.expectedArrivalAt,
    checkpoints: journey.checkpoints,
    corridorMeters: journey.corridorMeters,
    guardianContactIds: journey.guardianContactIds,
    lastKnownLocation: journey.lastKnownLocation,
    lastLocationAt: journey.lastLocationAt,
    riskScore: journey.riskScore,
    riskBand: journey.riskBand,
    escalationStage: journey.escalationStage,
    approximateRoute: journey.route?.approximate ?? true,
  };
}

/* ------------------------------ Lifecycle --------------------------------- */

export async function startJourney(journeyId: string): Promise<Journey | undefined> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return undefined;

  const startedAt = new Date().toISOString();
  const durationMinutes = journey.route?.durationMinutes ?? estimateMinutes(3000, 'drive');
  const expectedArrivalAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();

  await db.journeys.update(journeyId, {
    status: 'active' as JourneyStatus,
    startedAt,
    expectedArrivalAt,
    updatedAt: startedAt,
  });

  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'journey_started',
    message: `Journey started. Expected arrival ${new Date(expectedArrivalAt).toLocaleTimeString()}.`,
    data: { approximateEta: journey.route?.approximate ?? true },
  });

  const updated = await db.journeys.get(journeyId);
  if (updated) await queueJourney(updated);
  return updated;
}

export async function pauseJourney(journeyId: string): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey || journey.status !== 'active') return;
  await db.journeys.update(journeyId, { status: 'paused', pausedAt: new Date().toISOString() });
  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'journey_paused',
    message: 'Monitoring paused by the traveller. Risk signals stop accumulating.',
  });
}

export async function resumeJourney(journeyId: string): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey || journey.status !== 'paused') return;
  await db.journeys.update(journeyId, { status: 'active', pausedAt: undefined, updatedAt: new Date().toISOString() });
  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'journey_resumed',
    message: 'Monitoring resumed.',
  });
}

export async function completeJourney(journeyId: string, note?: string): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return;
  const now = new Date().toISOString();
  await db.journeys.update(journeyId, {
    status: 'completed',
    completedAt: now,
    actualArrivalAt: now,
    updatedAt: now,
  });
  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'journey_completed',
    message: note ? `Journey completed. ${note}` : 'Journey completed. Monitoring stopped.',
    severity: 'info',
  });
  const updated = await db.journeys.get(journeyId);
  if (updated) await queueJourney(updated);
}

export async function cancelJourney(journeyId: string, reason = 'Cancelled by the traveller.'): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return;
  await db.journeys.update(journeyId, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'journey_cancelled',
    message: reason,
    severity: 'notice',
  });
}

export async function deleteJourney(journeyId: string): Promise<void> {
  await db.journeys.delete(journeyId);
  const locations = await db.locations.where('journeyId').equals(journeyId).primaryKeys();
  await db.locations.bulkDelete(locations);
  const events = await db.events.where('journeyId').equals(journeyId).primaryKeys();
  await db.events.bulkDelete(events);
  const shares = await db.shares.where('journeyId').equals(journeyId).toArray();
  await db.shares.bulkDelete(shares.map((share) => share.id));
  const packs = await db.mapPacks.where('journeyId').equals(journeyId).toArray();
  await db.mapPacks.bulkDelete(packs.map((pack) => pack.id));
}

/* ------------------------------- Checkpoints ------------------------------ */

export async function markCheckpointReached(
  journeyId: string,
  checkpointId: string,
  options: { reachedAt?: string; automatic?: boolean; location?: GeoPoint } = {},
): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return;

  const checkpoints = journey.checkpoints.map((checkpoint) =>
    checkpoint.id === checkpointId
      ? { ...checkpoint, status: 'reached' as const, reachedAt: options.reachedAt ?? new Date().toISOString() }
      : checkpoint,
  );

  await db.journeys.update(journeyId, { checkpoints, updatedAt: new Date().toISOString() });
  const checkpoint = checkpoints.find((item) => item.id === checkpointId);

  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'checkpoint_reached',
    message: options.automatic
      ? `Checkpoint “${checkpoint?.label}” reached (location matched).`
      : `Checkpoint “${checkpoint?.label}” confirmed by the traveller.`,
    location: options.location,
    data: { checkpointId, automatic: Boolean(options.automatic) },
  });
}

export async function markCheckpointMissed(journeyId: string, checkpointId: string): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return;
  const checkpoints = journey.checkpoints.map((checkpoint) =>
    checkpoint.id === checkpointId && checkpoint.status === 'pending'
      ? { ...checkpoint, status: 'missed' as const, missedAt: new Date().toISOString() }
      : checkpoint,
  );
  await db.journeys.update(journeyId, { checkpoints, updatedAt: new Date().toISOString() });
  const checkpoint = checkpoints.find((item) => item.id === checkpointId);

  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'checkpoint_missed',
    message: `Checkpoint “${checkpoint?.label}” was not confirmed in its window (+${checkpoint?.windowMinutes ?? 10} min grace). This alone does not alert anyone — a discreet check-in is offered instead.`,
    data: { checkpointId },
  });
}

export async function skipCheckpoint(journeyId: string, checkpointId: string, reason?: string): Promise<void> {
  const journey = await db.journeys.get(journeyId);
  if (!journey) return;
  const checkpoints = journey.checkpoints.map((checkpoint) =>
    checkpoint.id === checkpointId ? { ...checkpoint, status: 'skipped' as const } : checkpoint,
  );
  await db.journeys.update(journeyId, { checkpoints, updatedAt: new Date().toISOString() });
  await recordEvent({
    ownerId: journey.ownerId,
    journeyId,
    type: 'checkpoint_skipped',
    message: reason ?? 'Checkpoint skipped by the traveller.',
    severity: 'notice',
  });
}

/* -------------------------------- Queries --------------------------------- */

export async function listJourneys(ownerId: string): Promise<Journey[]> {
  const rows = await db.journeys.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function activeJourney(ownerId: string): Promise<Journey | undefined> {
  const rows = await db.journeys.where('ownerId').equals(ownerId).toArray();
  return rows
    .filter((journey) => journey.status === 'active' || journey.status === 'paused' || journey.status === 'escalated')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
}

export async function nextPlannedJourney(ownerId: string): Promise<Journey | undefined> {
  const rows = await db.journeys.where('ownerId').equals(ownerId).toArray();
  return rows
    .filter((journey) => journey.status === 'planned')
    .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime())[0];
}

export interface JourneySummary {
  total: number;
  active: number;
  planned: number;
  completed: number;
  checkpointsReached: number;
  checkpointsMissed: number;
  lastCompletedAt?: string;
  distanceMeters: number;
}

export async function journeySummary(ownerId: string): Promise<JourneySummary> {
  const journeys = await listJourneys(ownerId);
  return {
    total: journeys.length,
    active: journeys.filter((journey) => journey.status === 'active' || journey.status === 'escalated').length,
    planned: journeys.filter((journey) => journey.status === 'planned').length,
    completed: journeys.filter((journey) => journey.status === 'completed').length,
    checkpointsReached: journeys.reduce(
      (total, journey) => total + journey.checkpoints.filter((item) => item.status === 'reached').length,
      0,
    ),
    checkpointsMissed: journeys.reduce(
      (total, journey) => total + journey.checkpoints.filter((item) => item.status === 'missed').length,
      0,
    ),
    lastCompletedAt: journeys
      .filter((journey) => journey.completedAt)
      .map((journey) => journey.completedAt!)
      .sort()
      .reverse()[0],
    distanceMeters: journeys.reduce((total, journey) => total + (journey.route?.distanceMeters ?? 0), 0),
  };
}

/** Human status text used in list rows and the dashboard. */
export function journeyStatusLabel(journey: Journey): string {
  switch (journey.status) {
    case 'planned':
      return `Starts ${toDate(journey.scheduledStartAt)?.toLocaleString() ?? 'soon'}`;
    case 'active':
      // Delay is computed from the live assessment (see `useMonitor`), never
      // stored on the journey row, so the label stays factual here.
      return 'In progress';
    case 'paused':
      return 'Monitoring paused';
    case 'escalated':
      return 'Escalated — emergency workflow open';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return journey.status;
  }
}

/** Minutes until departure (negative when overdue). */
export function departureInMinutes(journey: Journey): number {
  return minutesBetween(new Date(), journey.scheduledStartAt);
}

export function canStartJourney(journey: Journey): boolean {
  return journey.status === 'planned' || journey.status === 'paused';
}
