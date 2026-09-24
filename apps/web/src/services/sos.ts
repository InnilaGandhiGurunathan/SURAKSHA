import type { Journey, RiskAssessment, UserProfile } from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { ApiRequestError, apiFetch } from './api';
import { currentAccessToken } from './auth';
import { recordEvent } from './events';
import { notifyContacts, publishSnapshots, type NotifyOutcome } from './guardian';
import { activeJourney, updateJourney } from './journeys';
import { lastKnownLocation } from './location';
import { pushNotification, vibrate } from './notifications';
import { enqueue, PRIORITY } from './outbox';
import { copyText, openSmsHandoff, smsCapability } from './sms';

/**
 * SOS.
 *
 * Order of operations, chosen so the user's own device is never waiting on the
 * network to act:
 *  1. the SOS event and the escalated journey state are written locally;
 *  2. the device vibrates (unless the silent trigger was used) so the user knows
 *     the trigger registered even with the screen off;
 *  3. an alert is posted to the reporting server, and if that fails it goes into
 *     the priority outbox so it leaves the moment a connection exists;
 *  4. guardian snapshots are republished;
 *  5. the delivery result is reported **exactly as it happened** — queued means
 *     queued, and nothing claims that help is on the way.
 */

export type SosTriggerSource = 'button' | 'silent_gesture' | 'hardware' | 'checkin_declined';

export interface SosResult {
  alertId: string;
  triggeredAt: string;
  journey?: Journey;
  location?: { lat: number; lng: number };
  deliveryStatus: 'server_acknowledged' | 'queued_on_device' | 'failed';
  deliveryMessage: string;
  notify?: NotifyOutcome;
  smsMessage?: string;
  emergencyNumber: string;
  silent: boolean;
  disclaimer: string;
}

export async function triggerSos(input: {
  user: UserProfile;
  source?: SosTriggerSource;
  silent?: boolean;
  note?: string;
  location?: { lat: number; lng: number };
}): Promise<SosResult> {
  const triggeredAt = new Date().toISOString();
  const alertId = `sos-${uuid()}`;
  const silent = input.silent ?? input.user.rules?.silentSos ?? false;
  const journey = await activeJourney(input.user.id);

  const stored = input.location ?? (await lastKnownLocation())?.point;
  const point = stored && 'lat' in stored ? { lat: stored.lat, lng: stored.lng } : undefined;

  // 1. Local truth first.
  await recordEvent({
    ownerId: input.user.id,
    journeyId: journey?.id,
    type: 'sos_triggered',
    message: silent
      ? 'Silent SOS triggered. The alert is being prepared quietly.'
      : 'SOS triggered. Location, journey details and recent events were captured.',
    severity: 'critical',
    location: point,
    data: { alertId, source: input.source ?? 'button', silent },
  });

  await pushNotification({
    ownerId: input.user.id,
    kind: 'sos',
    title: 'SOS activated',
    body: silent
      ? 'Silent SOS is running. Your selected contacts are being alerted through the channels that work.'
      : 'Your trusted contacts are being alerted. This device cannot guarantee a rescue — call emergency services if you can.',
    severity: 'critical',
    journeyId: journey?.id,
    actionUrl: '/app/sos',
    system: !silent,
  });

  if (!silent) vibrate([200, 80, 200, 80, 400]);

  if (journey) {
    await updateJourney(journey.id, { status: 'escalated', monitoringEnabled: true });
  }

  // 2. Server alert (or priority queue).
  const recentEvents = journey
    ? (await db.events.where('journeyId').equals(journey.id).toArray())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 12)
        .map((event) => ({ type: event.type, message: event.message, createdAt: event.createdAt }))
    : [];

  const body = {
    id: alertId,
    ownerId: input.user.id,
    ownerName: input.user.fullName,
    journeyId: journey?.id,
    journeyTitle: journey?.title,
    triggeredAt,
    location: point,
    silent,
    note: input.note,
    source: input.source ?? 'button',
    lastEvents: recentEvents,
  };

  let deliveryStatus: SosResult['deliveryStatus'] = 'queued_on_device';
  let deliveryMessage = '';

  try {
    await apiFetch('/alerts/sos', {
      method: 'POST',
      body,
      token: await currentAccessToken(),
      ownerId: input.user.id,
      timeoutMs: 15_000,
    });
    deliveryStatus = 'server_acknowledged';
    deliveryMessage =
      'The reporting server acknowledged the alert. It will relay it to your trusted contacts.';
    await recordEvent({
      ownerId: input.user.id,
      journeyId: journey?.id,
      type: 'sos_delivered',
      message: 'Reporting server acknowledged the SOS alert.',
      severity: 'notice',
      location: point,
      data: { alertId },
    });
  } catch (error) {
    const apiError = error instanceof ApiRequestError ? error : undefined;
    deliveryStatus = apiError?.offline ? 'queued_on_device' : 'failed';
    deliveryMessage = apiError?.offline
      ? 'No internet connection. The alert is stored on this device at the highest priority and will be sent automatically the moment a connection returns.'
      : `The alert could not be sent (${apiError?.message ?? 'unknown error'}). It stays on this device and will be retried.`;

    await enqueue({
      ownerId: input.user.id,
      kind: 'report',
      priority: PRIORITY.sos,
      endpoint: '/alerts/sos',
      method: 'POST',
      body,
      dedupeKey: `sos:${alertId}`,
    });

    await recordEvent({
      ownerId: input.user.id,
      journeyId: journey?.id,
      type: 'sos_delivery_failed',
      message: `${deliveryMessage} Nothing is confirmed as delivered to anyone yet.`,
      severity: 'critical',
      location: point,
      data: { alertId },
    });
  }

  // 3. Contacts + guardian snapshots (they are best-effort and reported honestly).
  const notify = await notifyContacts({
    ownerId: input.user.id,
    journey:
      journey ??
      ({
        id: 'no-journey',
        ownerId: input.user.id,
        title: 'SOS without an active journey',
        status: 'escalated',
        transportMode: 'other',
        originLabel: 'Unknown',
        origin: point ?? { lat: 0, lng: 0 },
        destinationLabel: 'Unknown',
        destination: point ?? { lat: 0, lng: 0 },
        scheduledStartAt: triggeredAt,
        checkpoints: [],
        corridorMeters: 400,
        guardianContactIds: [],
        monitoringEnabled: false,
        createdAt: triggeredAt,
        updatedAt: triggeredAt,
      } as Journey),
    reason: 'sos',
    assessment: await latestAssessment(journey?.id),
    note: input.note,
    location: point,
  });

  const published = await publishSnapshots(input.user.id).catch(() => 0);

  const contacts = await db.contacts.where('ownerId').equals(input.user.id).toArray();
  const capability = smsCapability(
    contacts.filter((contact) => contact.canReceiveAlerts).map((contact) => contact.phone),
  );

  return {
    alertId,
    triggeredAt,
    journey,
    location: point,
    deliveryStatus,
    deliveryMessage,
    notify,
    smsMessage: capability.supported
      ? 'SMS handoff is available: use it to open your messaging app with the alert pre-filled.'
      : capability.reason,
    emergencyNumber: input.user.emergency.emergencyNumber || '112',
    silent,
    disclaimer: `Guardian snapshots republished: ${published}. SURAKSHA cannot guarantee that anyone will reach you — if you can, call ${input.user.emergency.emergencyNumber || 'your local emergency number'} yourself.`,
  };
}

async function latestAssessment(journeyId?: string): Promise<RiskAssessment | undefined> {
  if (!journeyId) return undefined;
  const snapshots = await db.riskSnapshots.where('journeyId').equals(journeyId).toArray();
  const latest = snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!latest) return undefined;
  return {
    score: latest.score,
    band: latest.band as RiskAssessment['band'],
    stage: latest.stage as RiskAssessment['stage'],
    signals: latest.signals as RiskAssessment['signals'],
    rationale: latest.rationale,
    requiresHumanConfirmation: true,
    evaluatedAt: latest.createdAt,
    disclaimer:
      'Heuristic indicator from on-device rules with prototype weights — not a probability, and not validated.',
  };
}

export async function cancelSos(input: { user: UserProfile; alertId?: string; reason?: string }): Promise<void> {
  const journey = await activeJourney(input.user.id);
  await recordEvent({
    ownerId: input.user.id,
    journeyId: journey?.id,
    type: 'sos_cancelled',
    message: input.reason ?? 'SOS cancelled by the traveller.',
    severity: 'notice',
    data: { alertId: input.alertId },
  });

  await pushNotification({
    ownerId: input.user.id,
    kind: 'sos',
    title: 'SOS cancelled',
    body: 'You cancelled the SOS. Tell your contacts directly if they were already alerted — SURAKSHA cannot recall an alert that has left the device.',
    severity: 'warning',
    journeyId: journey?.id,
    system: false,
  });

  if (journey) await updateJourney(journey.id, { status: 'active' });
}

export interface SmsHandoffOptions {
  user: UserProfile;
  journey?: Journey;
  assessment?: RiskAssessment;
  note?: string;
}

export async function startSmsHandoff(options: SmsHandoffOptions): Promise<{
  outcome: 'handoff' | 'unsupported' | 'unavailable';
  message: string;
}> {
  const contacts = (await db.contacts.where('ownerId').equals(options.user.id).toArray()).filter(
    (contact) => contact.canReceiveAlerts,
  );

  const location = await lastKnownLocation();
  const body = [
    `SURAKSHA: ${options.user.fullName} may need help.`,
    options.journey ? `${options.journey.title} (${options.journey.originLabel} → ${options.journey.destinationLabel})` : '',
    location ? `Last known location: ${location.point.lat.toFixed(5)}, ${location.point.lng.toFixed(5)} (${new Date(location.recordedAt).toLocaleString()})` : '',
    options.assessment ? `On-device risk indicator ${options.assessment.score}/100 (heuristic).` : '',
    options.note ?? '',
    'If you cannot reach me, contact local emergency services.',
  ]
    .filter(Boolean)
    .join('\n');

  const result = openSmsHandoff({ recipients: contacts.map((contact) => contact.phone), body });

  await recordEvent({
    ownerId: options.user.id,
    journeyId: options.journey?.id,
    type: 'sms_handoff_opened',
    message:
      result.outcome === 'handoff'
        ? 'SMS handoff opened in the messaging app with the alert text and recipients.'
        : `SMS handoff unavailable: ${result.message}`,
    severity: result.outcome === 'handoff' ? 'notice' : 'warning',
  });

  return { outcome: result.outcome, message: result.message };
}

export async function copyAlertToClipboard(options: SmsHandoffOptions): Promise<boolean> {
  const contacts = (await db.contacts.where('ownerId').equals(options.user.id).toArray()).filter(
    (contact) => contact.canReceiveAlerts,
  );
  const location = await lastKnownLocation();

  const text = [
    `SURAKSHA alert from ${options.user.fullName}`,
    `Contacts: ${contacts.map((contact) => `${contact.name} (${contact.phone})`).join(', ') || 'none stored'}`,
    options.journey ? `Journey: ${options.journey.title} — ${options.journey.originLabel} → ${options.journey.destinationLabel}` : '',
    location ? `Last known location: ${location.point.lat.toFixed(5)}, ${location.point.lng.toFixed(5)}` : '',
    `Emergency number: ${options.user.emergency.emergencyNumber || '112'}`,
    'Copy this into any messaging app if the automatic handoff does not work.',
  ]
    .filter(Boolean)
    .join('\n');

  return copyText(text);
}

export function emergencyDialLink(user: UserProfile): string {
  const number = user.emergency.emergencyNumber || '112';
  return `tel:${number.replace(/[^\d+]/g, '')}`;
}

export async function sosHistory(ownerId: string, limit = 20) {
  const events = await db.events.where('ownerId').equals(ownerId).toArray();
  return events
    .filter((event) => event.type.startsWith('sos_') || event.type === 'alert_queued')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
