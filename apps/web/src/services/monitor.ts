import { evaluateJourney, assessRisk } from '@suraksha/risk-engine';
import type { Journey, MonitorTickResult, RiskAssessment, SafetyRules } from '@suraksha/shared';
import { db, getSetting, setSetting, type CheckInRecord } from '@/lib/db';
import { uuid } from '@/lib/id';
import { DEFAULT_SAFETY_RULES } from '@/lib/constants';
import { recordEvent } from './events';
import {
  activeJourney,
  completeJourney,
  markCheckpointMissed,
  markCheckpointReached,
  pauseJourney,
  startJourney,
  updateJourney,
} from './journeys';
import { journeyTrack, recordJourneyLocation, requestWakeLock, releaseWakeLock, watchLocation } from './location';
import { notifyContacts } from './guardian';
import { pushNotification } from './notifications';
import { enqueue, PRIORITY } from './outbox';
import { useMonitor } from '@/store/monitor';

/**
 * The monitoring loop.
 *
 * One tick does three things: it reads the journey plus its device-local track,
 * asks the risk engine what the situation looks like, and then performs the
 * resulting actions **locally** — events, check-ins, snapshots. Contact
 * notification goes through `notifyContacts`, which is honest about which
 * channels actually worked.
 *
 * The loop is deliberately simple (a timer, not a background daemon) because a
 * browser cannot promise background execution. The UI says so out loud.
 */

export interface MonitorStatus {
  running: boolean;
  journeyId?: string;
  lastTickAt?: string;
  nextTickAt?: string;
  tickCount: number;
  intervalSeconds: number;
  wakeLock: boolean;
  message: string;
}

let interval: ReturnType<typeof setInterval> | undefined;
let stopWatch: (() => void) | undefined;
let status: MonitorStatus = {
  running: false,
  tickCount: 0,
  intervalSeconds: DEFAULT_SAFETY_RULES.monitoringIntervalSeconds,
  wakeLock: false,
  message: 'Monitoring is off. Journeys are planned but nothing is being watched.',
};
let currentOwnerId: string | undefined;

export function monitoringStatus(): MonitorStatus {
  return status;
}

export async function loadSafetyRules(ownerId: string): Promise<SafetyRules> {
  const user = await db.users.get(ownerId);
  return { ...DEFAULT_SAFETY_RULES, ...(user?.rules ?? {}) };
}

export async function startMonitoring(ownerId: string): Promise<MonitorStatus> {
  await stopMonitoring();
  currentOwnerId = ownerId;

  const rules = await loadSafetyRules(ownerId);
  const journey = await activeJourney(ownerId);

  status = {
    running: true,
    journeyId: journey?.id,
    tickCount: 0,
    intervalSeconds: rules.monitoringIntervalSeconds,
    wakeLock: false,
    message: journey
      ? 'Monitoring this journey on your device.'
      : 'Monitoring is on and waiting for an active journey.',
    lastTickAt: undefined,
    nextTickAt: new Date(Date.now() + rules.monitoringIntervalSeconds * 1000).toISOString(),
  };

  const wake = await requestWakeLock();
  status.wakeLock = wake.granted;

  useMonitor.getState().setMonitoring(true, status.message);
  useMonitor.getState().setJourney(journey);

  stopWatch = watchLocation({
    minDistanceMeters: 25,
    minIntervalMs: 15_000,
    onSample: async (sample) => {
      if (!currentOwnerId) return;
      const active = await activeJourney(currentOwnerId);
      if (!active || active.status !== 'active') return;
      await recordJourneyLocation({ journeyId: active.id, ownerId: currentOwnerId, sample });
      await enqueue({
        ownerId: currentOwnerId,
        kind: 'location',
        priority: PRIORITY.location,
        endpoint: `/journeys/${active.id}/locations`,
        method: 'POST',
        body: { point: sample.point, recordedAt: sample.recordedAt },
        // Only the newest position per journey matters server-side.
        dedupeKey: `location:${active.id}`,
      });
    },
    onError: async (failure) => {
      if (!currentOwnerId) return;
      await pushNotification({
        ownerId: currentOwnerId,
        kind: 'system',
        title: 'Location unavailable',
        body: `${failure.message} ${failure.remedy}`,
        severity: 'warning',
      });
    },
  });

  void tick(ownerId, 'start');
  interval = setInterval(() => void tick(ownerId, 'timer'), rules.monitoringIntervalSeconds * 1000);

  return status;
}

export async function stopMonitoring(reason = 'Monitoring stopped.'): Promise<void> {
  if (interval) clearInterval(interval);
  interval = undefined;
  stopWatch?.();
  stopWatch = undefined;
  await releaseWakeLock();
  status = {
    ...status,
    running: false,
    wakeLock: false,
    nextTickAt: undefined,
    message: reason,
  };
  currentOwnerId = undefined;
  useMonitor.getState().setMonitoring(false, reason);
  useMonitor.getState().setCheckIn(undefined);
}

/** Runs one evaluation. Exported so tests and the manual "check now" button share it. */
export async function tick(ownerId: string, source: 'start' | 'timer' | 'manual' = 'manual'): Promise<MonitorTickResult | undefined> {
  const journey = await activeJourney(ownerId);
  if (!journey) {
    if (status.running) {
      status = { ...status, journeyId: undefined, message: 'Monitoring is on and waiting for an active journey.' };
    }
    return undefined;
  }

  const rules = await loadSafetyRules(ownerId);
  const track = await journeyTrack(journey.id, 400);
  const events = await db.events.where('journeyId').equals(journey.id).toArray();

  const pendingCheckIn = await db.checkIns
    .where('journeyId')
    .equals(journey.id)
    .filter((checkIn) => checkIn.status === 'pending')
    .first();

  const lastTimedOut = [...events]
    .filter((event) => event.type === 'checkin_timed_out')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const lastConfirmedSafe = [...events]
    .filter((event) => event.type === 'checkin_confirmed_safe')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const assessmentEvaluation = evaluateJourney(
    {
      journey,
      route: journey.route?.geometry,
      track,
      events,
      rules,
      autoStart: true,
      waitingCheckIn: Boolean(pendingCheckIn),
      checkInTimedOutAt: lastTimedOut?.createdAt,
      confirmedSafeAt: lastConfirmedSafe?.createdAt,
    },
  );

  const actions = assessmentEvaluation.actions ?? [];
  const assessment = assessmentEvaluation.assessment;

  // `assessment` is optional on a tick result (for example when a journey exists
  // but has not started). The actions are still performed; only the parts that
  // need a score are skipped, and the UI keeps showing the previous one.
  if (!assessment) {
    return assessmentEvaluation;
  }

  for (const action of actions) {
    switch (action.type) {
      case 'start_journey':
        await startJourney(journey.id);
        break;
      case 'complete_journey':
        await completeJourney(journey.id, 'Destination reached.');
        break;
      case 'mark_checkpoint_reached':
        await markCheckpointReached(journey.id, String(action.payload?.checkpointId ?? ''), {
          reachedAt: action.payload?.reachedAt as string | undefined,
          automatic: true,
        });
        break;
      case 'mark_checkpoint_missed':
        await markCheckpointMissed(journey.id, String(action.payload?.checkpointId ?? ''));
        break;
      case 'prompt_checkin':
        await createCheckIn({
          journey,
          reason: 'Signals accumulated on the device. Confirm you are safe — nobody has been contacted.',
          score: assessment.score,
          graceMinutes: rules.checkInGraceMinutes,
        });
        break;
      case 'notify_guardians':
        await notifyContacts({
          ownerId,
          journey,
          reason: 'trusted_contact_notice',
          assessment,
        });
        break;
      case 'open_emergency_workflow':
        await enqueueEmergency(ownerId, journey, assessment);
        break;
      case 'clear_deviation':
        await recordEvent({
          ownerId,
          journeyId: journey.id,
          type: 'deviation_cleared',
          message: 'Back inside the monitored corridor.',
          severity: 'info',
        });
        break;
      case 'record_event':
      default:
        break;
    }
  }

  // The deviation event is written once per episode, not once per tick.
  const wasOffRoute = events.some(
    (event) => event.type === 'route_deviation' && Date.now() - new Date(event.createdAt).getTime() < 30 * 60_000,
  );
  if (assessmentEvaluation.offRoute && !wasOffRoute) {
    await recordEvent({
      ownerId,
      journeyId: journey.id,
      type: 'route_deviation',
      message: `About ${assessmentEvaluation.deviationMeters} m from the planned route. A deviation on its own does not alert anyone — it is one signal among several.`,
      location: track[track.length - 1]?.point,
      riskScore: assessment.score,
      data: { deviationMeters: assessmentEvaluation.deviationMeters, corridorMeters: journey.corridorMeters },
    });
  }

  await db.riskSnapshots.put({
    id: uuid(),
    journeyId: journey.id,
    ownerId,
    score: assessment.score,
    band: assessment.band,
    stage: assessment.stage,
    signals: assessment.signals,
    rationale: assessment.rationale,
    createdAt: assessment.evaluatedAt,
  });

  await db.journeys.update(journey.id, {
    riskScore: assessment.score,
    riskBand: assessment.band,
    escalationStage: assessment.stage,
    updatedAt: new Date().toISOString(),
  });

  status = {
    ...status,
    running: status.running,
    journeyId: journey.id,
    lastTickAt: assessment.evaluatedAt,
    tickCount: status.tickCount + 1,
    nextTickAt: new Date(Date.now() + rules.monitoringIntervalSeconds * 1000).toISOString(),
    message:
      assessment.score >= 10
        ? `Risk indicator ${assessment.score}/100 (${assessment.signals.length} signal(s)) — heuristic, not a rescue guarantee.`
        : 'All quiet. Nothing has been sent to anyone.',
  };

  useMonitor.getState().setAssessment(assessment, {
    deviationMeters: assessmentEvaluation.deviationMeters,
    progress: assessmentEvaluation.progress ?? 0,
    delayMinutes: assessmentEvaluation.delayMinutes ?? 0,
  });
  return assessmentEvaluation;
}

async function enqueueEmergency(ownerId: string, journey: Journey, assessment: RiskAssessment): Promise<void> {
  // The SOS/enquiry already exists as an event; this marks the journey so the UI
  // can show the escalated state even after a reload.
  await recordEvent({
    ownerId,
    journeyId: journey.id,
    type: 'alert_queued',
    message: `Emergency workflow opened at ${assessment.score}/100. Detailed alert prepared for trusted contacts.`,
    riskScore: assessment.score,
    data: { trigger: assessment.triggeredBy, signals: assessment.signals.map((entry) => entry.kind) },
  });
}

/* -------------------------------- Check-ins -------------------------------- */

export interface CreateCheckInInput {
  journey: Journey;
  reason: string;
  score: number;
  graceMinutes?: number;
  checkpointId?: string;
}

export async function createCheckIn(input: CreateCheckInInput): Promise<CheckInRecord> {
  const existing = await db.checkIns
    .where('journeyId')
    .equals(input.journey.id)
    .filter((checkIn) => checkIn.status === 'pending')
    .first();
  if (existing) return existing;

  const now = Date.now();
  const graceMinutes = input.graceMinutes ?? DEFAULT_SAFETY_RULES.checkInGraceMinutes;

  const checkIn: CheckInRecord = {
    id: uuid(),
    journeyId: input.journey.id,
    ownerId: input.journey.ownerId,
    checkpointId: input.checkpointId,
    prompt: input.reason,
    reason: input.reason,
    riskScore: input.score,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    dueAt: new Date(now + graceMinutes * 60_000).toISOString(),
  };

  await db.checkIns.put(checkIn);
  useMonitor.getState().setCheckIn(checkIn);
  await recordEvent({
    ownerId: input.journey.ownerId,
    journeyId: input.journey.id,
    type: 'checkin_prompted',
    message: `Discreet safety check-in offered (${graceMinutes} min to answer). No contact has been notified.`,
    riskScore: input.score,
    data: { checkInId: checkIn.id },
  });

  return checkIn;
}

export async function pendingCheckInFor(journeyId: string): Promise<CheckInRecord | undefined> {
  return db.checkIns
    .where('journeyId')
    .equals(journeyId)
    .filter((checkIn) => checkIn.status === 'pending')
    .first();
}

export type CheckInResponse = 'safe' | 'not_safe' | 'snoozed' | 'timeout';

export interface CheckInOutcome {
  status: CheckInResponse;
  message: string;
  escalated: boolean;
  assessment: RiskAssessment;
}

/**
 * Handles the answer to a check-in.
 *
 * "I am safe" clears accumulated signals — that is the whole point of asking.
 * "I am not safe" is the only *user-driven* path into the emergency workflow
 * besides SOS. Silence (timeout) raises risk but still does **not** open the
 * emergency workflow on its own, which is what keeps the promise that a single
 * missed checkpoint can never trigger an emergency.
 */
export async function respondToCheckIn(
  checkInId: string,
  response: CheckInResponse,
  location?: { lat: number; lng: number },
): Promise<CheckInOutcome> {
  const checkIn = await db.checkIns.get(checkInId);
  if (!checkIn) throw new Error('That check-in is no longer open.');

  const journey = await db.journeys.get(checkIn.journeyId);
  const now = new Date().toISOString();
  useMonitor.getState().setCheckIn(undefined);

  await db.checkIns.update(checkInId, {
    status: response === 'timeout' ? 'timed_out' : response,
    respondedAt: now,
    respondedLocation: location,
    snoozedUntil: response === 'snoozed' ? new Date(Date.now() + 10 * 60_000).toISOString() : undefined,
  });

  const rules = journey ? await loadSafetyRules(journey.ownerId) : DEFAULT_SAFETY_RULES;
  const track = journey ? await journeyTrack(journey.id, 200) : [];
  const events = journey ? await db.events.where('journeyId').equals(journey.id).toArray() : [];

  if (journey) {
    if (response === 'safe') {
      await recordEvent({
        ownerId: journey.ownerId,
        journeyId: journey.id,
        type: 'checkin_confirmed_safe',
        message: 'Confirmed safe by the traveller. Accumulated signals were cleared.',
        location,
        severity: 'info',
      });
    } else if (response === 'not_safe') {
      await recordEvent({
        ownerId: journey.ownerId,
        journeyId: journey.id,
        type: 'checkin_declined',
        message: 'The traveller answered that they are not safe. Emergency workflow opening.',
        location,
        severity: 'critical',
      });
    } else if (response === 'snoozed') {
      await recordEvent({
        ownerId: journey.ownerId,
        journeyId: journey.id,
        type: 'checkin_prompted',
        message: 'Check-in postponed by 10 minutes at the traveller’s request.',
        severity: 'notice',
      });
    } else {
      await recordEvent({
        ownerId: journey.ownerId,
        journeyId: journey.id,
        type: 'checkin_timed_out',
        message:
          'The safety check-in was not answered in time. Risk rises, but nobody is contacted automatically from a silence alone — escalation waits for the emergency workflow criteria or an explicit answer.',
        severity: 'warning',
      });
    }
  }

  const assessment = journey
    ? assessRisk({
        journey,
        route: journey.route?.geometry,
        track,
        events,
        rules,
        declinedCheckIn: response === 'not_safe',
        checkInTimedOutAt: response === 'timeout' ? now : undefined,
        confirmedSafeAt: response === 'safe' ? now : undefined,
      })
    : undefined;

  if (journey && assessment) {
    await db.journeys.update(journey.id, {
      riskScore: assessment.score,
      riskBand: assessment.band,
      escalationStage: assessment.stage,
      updatedAt: now,
    });

    if (response === 'not_safe') {
      await updateJourney(journey.id, { status: 'escalated' });
    }
  }

  const message =
    response === 'safe'
      ? 'Thanks — signals cleared. Nothing was sent to your contacts.'
      : response === 'not_safe'
        ? 'Your trusted contacts are being alerted now.'
        : response === 'snoozed'
          ? 'Check-in moved 10 minutes later.'
          : 'No answer recorded. Risk went up; contacts are notified only if escalation criteria are met.';

  return {
    status: response,
    message,
    escalated: response === 'not_safe',
    assessment: assessment as RiskAssessment,
  };
}

export async function cancelCheckIn(checkInId: string): Promise<void> {
  await db.checkIns.update(checkInId, { status: 'timed_out' });
}

export async function recentCheckIns(ownerId: string, limit = 20): Promise<CheckInRecord[]> {
  const rows = await db.checkIns.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}

/** Expires overdue check-ins; called by the tick and on app focus. */
export async function expireOverdueCheckIns(ownerId: string): Promise<number> {
  const open = await db.checkIns
    .where('ownerId')
    .equals(ownerId)
    .filter((checkIn) => checkIn.status === 'pending' && new Date(checkIn.dueAt).getTime() < Date.now())
    .toArray();

  for (const checkIn of open) {
    await respondToCheckIn(checkIn.id, 'timeout');
  }
  return open.length;
}

export async function setMonitoringPreference(ownerId: string, enabled: boolean): Promise<void> {
  await setSetting(`monitoring:${ownerId}`, enabled);
  if (enabled) await startMonitoring(ownerId);
  else await stopMonitoring('Monitoring turned off in Settings.');
}

export async function monitoringPreference(ownerId: string): Promise<boolean> {
  const value = await getSetting<boolean>(`monitoring:${ownerId}`);
  return value ?? false;
}

export async function stopMonitoringForPause(journeyId: string): Promise<void> {
  await pauseJourney(journeyId);
  await stopMonitoring('Monitoring paused with the journey.');
}
