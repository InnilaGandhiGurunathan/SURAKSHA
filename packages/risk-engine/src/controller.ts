import {
  type CheckpointStatus,
  type GeoPoint,
  type Journey,
  type JourneyCheckpoint,
  type JourneyEvent,
  type JourneyLocationPoint,
  type MonitorTickResult,
  type RiskAssessment,
} from '@suraksha/shared';
import { DEFAULT_SAFETY_RULES, assessRisk, evaluateJourneyGeometry, type AssessInput } from './engine.js';

/**
 * The monitoring tick.
 *
 * `assessRisk` decides *how worried* the engine is; `evaluateJourney` decides
 * *what should happen next* — and every action it emits is something the app
 * performs locally first. Nothing here contacts anybody by itself; the caller
 * (which has the user's consent settings and the network stack) decides how to
 * deliver the actions, which is what keeps offline monitoring honest.
 */

export interface EvaluateOptions extends AssessInput {
  /** Explicitly ask the engine to start a journey that has reached its time. */
  autoStart?: boolean;
  /** Prevent duplicate check-in prompts for the same episode. */
  waitingCheckIn?: boolean;
}

export function evaluateCheckpoints(
  journey: Journey,
  track: JourneyLocationPoint[],
  now: Date,
): JourneyCheckpoint[] {
  const reference = journey.startedAt ? new Date(journey.startedAt) : null;
  if (!reference) return journey.checkpoints;

  const elapsedMinutes = (now.getTime() - reference.getTime()) / 60_000;

  return journey.checkpoints.map((checkpoint) => {
    if (checkpoint.status === 'reached' || checkpoint.status === 'skipped') return checkpoint;

    const dueAt = checkpoint.expectedOffsetMinutes + (checkpoint.windowMinutes ?? 10);
    const overdue = elapsedMinutes > dueAt;

    // A checkpoint also counts as reached if the traveller is standing in it.
    const nearCheckpoint = track.some((entry) => {
      if (new Date(entry.recordedAt) < reference) return false;
      const distance = haversine(entry.point, checkpoint.location);
      return distance <= Math.max(150, checkpoint.windowMinutes * 25);
    });

    if (nearCheckpoint) {
      return {
        ...checkpoint,
        status: 'reached' as CheckpointStatus,
        reachedAt: checkpoint.reachedAt ?? latestAt(track, checkpoint.location, reference) ?? now.toISOString(),
      };
    }

    if (overdue) {
      return {
        ...checkpoint,
        status: 'missed' as CheckpointStatus,
        missedAt: checkpoint.missedAt ?? now.toISOString(),
      };
    }
    return checkpoint;
  });
}

function latestAt(
  track: JourneyLocationPoint[],
  point: GeoPoint,
  after: Date,
): string | undefined {
  const candidates = track
    .filter((entry) => new Date(entry.recordedAt) >= after)
    .filter((entry) => haversine(entry.point, point) <= 200);
  if (!candidates.length) return undefined;
  return candidates[candidates.length - 1].recordedAt;
}

function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function evaluateJourney(options: EvaluateOptions): MonitorTickResult {
  const now = options.now ?? new Date();
  const rules = { ...DEFAULT_SAFETY_RULES, ...(options.rules ?? {}) };
  const journey: Journey = options.journey;

  const checkpoints = evaluateCheckpoints(journey, options.track ?? [], now);
  const journeyWithCheckpoints: Journey = { ...journey, checkpoints };

  const geometry = evaluateJourneyGeometry({ ...options, journey: journeyWithCheckpoints, rules });
  const assessment: RiskAssessment = assessRisk({
    ...options,
    journey: journeyWithCheckpoints,
    rules,
    now,
  });

  const actions: MonitorTickResult['actions'] = [];

  // A planned journey whose departure time has arrived starts monitoring.
  if (options.autoStart && journey.status === 'planned' && new Date(journey.scheduledStartAt) <= now) {
    actions.push({ type: 'start_journey', detail: 'Departure time reached; journey monitoring started.' });
  }

  // Checkpoint transitions.
  journey.checkpoints.forEach((before, index) => {
    const after = checkpoints[index];
    if (before.status !== after.status) {
      if (after.status === 'reached') {
        actions.push({
          type: 'mark_checkpoint_reached',
          detail: `Checkpoint “${after.label}” confirmed reached.`,
          payload: { checkpointId: after.id, reachedAt: after.reachedAt },
        });
      }
      if (after.status === 'missed') {
        actions.push({
          type: 'mark_checkpoint_missed',
          detail: `Checkpoint “${after.label}” passed its window without confirmation.`,
          payload: { checkpointId: after.id, missedAt: after.missedAt },
        });
      }
    }
  });

  // Deviation episodes.
  if (geometry.offRoute) {
    actions.push({
      type: 'record_event',
      detail: `Off the planned corridor by ${geometry.deviationMeters} m.`,
      payload: { deviationMeters: geometry.deviationMeters },
    });
  } else if (options.events?.some((event) => event.type === 'route_deviation')) {
    actions.push({ type: 'clear_deviation', detail: 'Back on the planned route.' });
  }

  if (assessment.stage === 'discreet_checkin' && !options.waitingCheckIn) {
    actions.push({
      type: 'prompt_checkin',
      detail: 'Offering a discreet safety check-in on the device.',
      payload: { graceMinutes: rules.checkInGraceMinutes },
    });
  }

  // The only automatic notification path: the emergency workflow, which requires
  // either an explicit user signal or several independent accumulated signals.
  if (assessment.stage === 'emergency_workflow') {
    actions.push({
      type: 'open_emergency_workflow',
      detail:
        assessment.triggeredBy === 'manual_sos'
          ? 'SOS was triggered by the traveller.'
          : assessment.triggeredBy === 'declined_checkin'
            ? 'The traveller answered that they are not safe.'
            : 'Accumulated signals met the escalation criteria.',
      payload: { score: assessment.score, band: assessment.band, trigger: assessment.triggeredBy },
    });
  } else if (assessment.stage === 'trusted_contact_notice') {
    actions.push({
      type: 'notify_guardians',
      detail: `Risk reached ${assessment.score}/100 across ${assessment.signals.length} signals.`,
      payload: { score: assessment.score, signals: assessment.signals.map((entry) => entry.kind) },
    });
  }

  // Journey completion: arrived at the destination with all checkpoints resolved.
  const nearDestination =
    geometry.latestPoint !== undefined && haversine(geometry.latestPoint, journey.destination) <= 200;
  const allResolved = checkpoints.every((checkpoint) => checkpoint.status !== 'pending');
  if (journeyWithCheckpoints.status === 'active' && nearDestination && allResolved) {
    actions.push({ type: 'complete_journey', detail: 'Destination reached and all checkpoints resolved.' });
  }

  if (assessment.score >= 10) {
    actions.push({
      type: 'record_event',
      detail: `Risk indicator at ${assessment.score}/100 (${assessment.signals.length} signal(s)).`,
      payload: { score: assessment.score, band: assessment.band, rationale: assessment.rationale },
    });
  }

  return {
    journeyId: journey.id,
    assessment,
    actions,
    deviationMeters: geometry.deviationMeters,
    progress: geometry.progress,
    delayMinutes: geometry.delayMinutes,
    offRoute: geometry.offRoute,
    evaluatedAt: now.toISOString(),
  };
}

/** Summaries used by the journey history screen. */
export function summariseEvents(events: JourneyEvent[]): {
  total: number;
  critical: number;
  warnings: number;
  notices: number;
  checkpointsReached: number;
  checkpointsMissed: number;
  firstAt?: string;
  lastAt?: string;
} {
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return {
    total: sorted.length,
    critical: sorted.filter((event) => event.severity === 'critical').length,
    warnings: sorted.filter((event) => event.severity === 'warning').length,
    notices: sorted.filter((event) => event.severity === 'notice').length,
    checkpointsReached: sorted.filter((event) => event.type === 'checkpoint_reached').length,
    checkpointsMissed: sorted.filter((event) => event.type === 'checkpoint_missed').length,
    firstAt: sorted[0]?.createdAt,
    lastAt: sorted[sorted.length - 1]?.createdAt,
  };
}
