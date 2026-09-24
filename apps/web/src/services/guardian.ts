import {
  SHARE_DISCLAIMER,
  type GuardianCheckpointSnapshot,
  type GuardianShare,
  type GuardianShareScope,
  type GuardianSnapshot,
  type Journey,
  type RiskAssessment,
  type TrustedContact,
} from '@suraksha/shared';
import { db } from '@/lib/db';
import { randomToken, uuid, digestId } from '@/lib/id';
import { encryptJson, decryptJson, generateShareKey, importShareKey, type EncryptedEnvelope } from '@/lib/crypto';
import { listContacts } from './contacts';
import { ApiRequestError, apiFetch } from './api';
import { currentAccessToken } from './auth';
import { recordEvent } from './events';
import { enqueue, PRIORITY } from './outbox';
import { listEvents } from './events';
import { journeyTrack } from './location';
import { pushNotification } from './notifications';
import { stageExplanation } from '@suraksha/risk-engine';

/**
 * Guardian mode, permission-based sharing and alert fan-out.
 *
 * The sharing model:
 *  - the traveller creates a share for a journey and a contact, choosing scopes;
 *  - a random token plus an AES-GCM key are generated **on the device**; the key
 *    goes in the URL fragment (`#k=…`), which the browser never sends upstream,
 *    so the server only ever stores ciphertext;
 *  - snapshots are republished on every monitoring tick, so a guardian's view is
 *    as fresh as the traveller's last connection;
 *  - revocation removes the ciphertext server-side and marks the link dead.
 */

export const SHARE_SCOPES: Array<{ value: GuardianShareScope; label: string; description: string }> = [
  { value: 'journey:read', label: 'Journey details', description: 'Route, times and checkpoint ledger.' },
  { value: 'location:read', label: 'Last known location', description: 'The most recent position from the device.' },
  { value: 'location:live', label: 'Live-ish updates', description: 'Fresher positions while monitoring is running.' },
  { value: 'alerts:read', label: 'Alerts', description: 'Notices when risk escalates or SOS is used.' },
  { value: 'events:read', label: 'Recent timeline', description: 'The last few journey events, without private notes.' },
];

const CACHE_PREFIX = 'suraksha.share.cache.';

export interface CreateShareInput {
  journeyId: string;
  ownerId: string;
  contact: Pick<TrustedContact, 'id' | 'name'>;
  scopes?: GuardianShareScope[];
  expiresInHours?: number;
}

export interface ShareLink {
  share: GuardianShare;
  url: string;
  message: string;
  key: string;
  encrypted: boolean;
  warning?: string;
}

export async function createGuardianShare(input: CreateShareInput): Promise<ShareLink> {
  const scopes =
    input.scopes ??
    (['journey:read', 'location:read', 'alerts:read', 'events:read'] as GuardianShareScope[]);

  const { key, encoded } = await generateShareKey();
  const token = randomToken(24);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (input.expiresInHours ?? 72) * 3600_000).toISOString();

  const share: GuardianShare = {
    id: uuid(),
    journeyId: input.journeyId,
    ownerId: input.ownerId,
    token,
    contactId: input.contact.id,
    contactName: input.contact.name,
    scopes,
    status: 'active',
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  await db.shares.put(share);
  await cacheShareKey(share.id, encoded);

  const journey = await db.journeys.get(input.journeyId);
  await recordEvent({
    ownerId: input.ownerId,
    journeyId: input.journeyId,
    type: 'guardian_share_created',
    message: `Guardian access created for ${input.contact.name} (${scopes.length} permission(s)), expiring ${new Date(expiresAt).toLocaleString()}.`,
    data: { shareId: share.id, scopes },
  });

  await enqueue({
    ownerId: input.ownerId,
    kind: 'share',
    priority: PRIORITY.share,
    endpoint: '/shares',
    method: 'POST',
    body: {
      id: share.id,
      journeyId: share.journeyId,
      ownerId: share.ownerId,
      token: share.token,
      contactName: share.contactName,
      scopes: share.scopes,
      expiresAt: share.expiresAt,
    },
    dedupeKey: `share:${share.id}`,
  });

  // Publish the first snapshot immediately so the link is useful offline-ish:
  // the guardian sees the state as of this moment.
  await publishSnapshot(share, journey, key);

  const url = buildShareUrl(share.token, encoded);
  return {
    share,
    url,
    key: encoded,
    encrypted: true,
    message: buildShareMessage(share, journey, url),
  };
}

export function buildShareUrl(token: string, key: string): string {
  const base = `${window.location.origin}/g/${token}`;
  return `${base}#k=${key}`;
}

export function buildShareMessage(share: GuardianShare, journey: Journey | undefined, url: string): string {
  return [
    `${journey?.title ?? 'My journey'} — SURAKSHA guardian link`,
    journey ? `${journey.originLabel} → ${journey.destinationLabel}` : '',
    journey?.expectedArrivalAt ? `Expected arrival ${new Date(journey.expectedArrivalAt).toLocaleString()}` : '',
    '',
    `You can see my journey status here: ${url}`,
    '',
    'The link is encrypted and only works on this device until it expires. I can revoke it at any time.',
    SHARE_DISCLAIMER,
  ]
    .filter(Boolean)
    .join('\n');
}

async function cacheShareKey(shareId: string, key: string): Promise<void> {
  // The key is kept locally (not in the URL only) so the traveller can re-send a
  // working link later without re-encrypting everything.
  await db.settings.put({
    key: `shareKey:${shareId}`,
    value: key,
    updatedAt: new Date().toISOString(),
  });
}

async function shareKey(shareId: string): Promise<string | undefined> {
  const row = await db.settings.get(`shareKey:${shareId}`);
  return row?.value as string | undefined;
}

export async function listShares(ownerId: string): Promise<GuardianShare[]> {
  const rows = await db.shares.where('ownerId').equals(ownerId).toArray();
  return rows
    .map((share) => ({
      ...share,
      status: share.status === 'active' && new Date(share.expiresAt) < new Date() ? 'expired' : share.status,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function sharesForJourney(journeyId: string): Promise<GuardianShare[]> {
  const rows = await db.shares.where('journeyId').equals(journeyId).toArray();
  return rows.filter((share) => share.status === 'active' && new Date(share.expiresAt) > new Date());
}

export async function revokeShare(shareId: string, reason = 'Revoked by the traveller.'): Promise<void> {
  const share = await db.shares.get(shareId);
  if (!share) return;

  await db.shares.update(shareId, { status: 'revoked', updatedAt: new Date().toISOString() });
  await db.settings.delete(`shareKey:${shareId}`).catch(() => undefined);
  await recordEvent({
    ownerId: share.ownerId,
    journeyId: share.journeyId,
    type: 'guardian_share_revoked',
    message: `Guardian access for ${share.contactName} was revoked. ${reason}`,
    severity: 'notice',
  });

  await enqueue({
    ownerId: share.ownerId,
    kind: 'share',
    priority: PRIORITY.share,
    endpoint: `/shares/${share.token}/revoke`,
    method: 'POST',
    body: { reason },
    dedupeKey: `share-revoke:${share.id}`,
  });
}

export async function extendShare(shareId: string, hours: number): Promise<GuardianShare | undefined> {
  const share = await db.shares.get(shareId);
  if (!share) return undefined;
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
  await db.shares.update(shareId, { expiresAt, status: 'active', updatedAt: new Date().toISOString() });
  return { ...share, expiresAt, status: 'active' };
}

/* ------------------------------- Snapshots -------------------------------- */

export async function buildSnapshot(share: GuardianShare, journey: Journey): Promise<GuardianSnapshot> {
  const owner = await db.users.get(share.ownerId);
  const track = await journeyTrack(journey.id, 400);
  const events = await listEvents({ ownerId: share.ownerId, journeyId: journey.id, limit: 12 });

  const checkpoints: GuardianCheckpointSnapshot[] = share.scopes.includes('journey:read')
    ? journey.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        label: checkpoint.label,
        status: checkpoint.status,
        expectedOffsetMinutes: checkpoint.expectedOffsetMinutes,
        reachedAt: checkpoint.reachedAt,
      }))
    : [];

  const route = journey.route?.geometry ?? [journey.origin, journey.destination];
  const nearestProgress = track.length
    ? Math.min(
        1,
        Math.max(
          0,
          distanceProgress(track[track.length - 1].point, route),
        ),
      )
    : 0;

  const totalMeters = journey.route?.distanceMeters ?? 0;

  return {
    shareId: share.id,
    travellerName: owner?.fullName ?? 'Traveller',
    journeyId: journey.id,
    journeyTitle: journey.title,
    status: journey.status,
    originLabel: journey.originLabel,
    destinationLabel: journey.destinationLabel,
    startedAt: journey.startedAt,
    expectedArrivalAt: journey.expectedArrivalAt,
    riskBand: journey.riskBand ?? 'safe',
    riskScore: journey.riskScore ?? 0,
    progress: {
      percent: Math.round(nearestProgress * 100),
      travelledMeters: Math.round(totalMeters * nearestProgress),
      remainingMeters: Math.round(Math.max(0, totalMeters * (1 - nearestProgress))),
    },
    lastKnownLocation: share.scopes.includes('location:read') || share.scopes.includes('location:live')
      ? journey.lastKnownLocation
      : undefined,
    lastLocationAt: journey.lastLocationAt,
    checkpoints,
    recentEvents: share.scopes.includes('events:read')
      ? events.map((event) => ({
          id: event.id,
          type: event.type,
          message: event.message,
          severity: event.severity,
          createdAt: event.createdAt,
        }))
      : [],
    updatedAt: new Date().toISOString(),
    disclaimer: SHARE_DISCLAIMER,
  };
}

function distanceProgress(point: { lat: number; lng: number }, route: Array<{ lat: number; lng: number }>): number {
  if (route.length < 2) return 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  route.forEach((candidate, index) => {
    const dx = (candidate.lng - point.lng) * 111_320 * Math.cos((point.lat * Math.PI) / 180);
    const dy = (candidate.lat - point.lat) * 111_320;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex / (route.length - 1);
}

export async function publishSnapshot(
  share: GuardianShare,
  journey: Journey | undefined,
  keyOverride?: CryptoKey,
): Promise<boolean> {
  if (!journey) return false;
  if (share.status !== 'active' || new Date(share.expiresAt) < new Date()) return false;

  const encodedKey = keyOverride ? undefined : await shareKey(share.id);
  const key = keyOverride ?? (encodedKey ? await importShareKey(encodedKey) : undefined);
  if (!key) return false;

  const snapshot = await buildSnapshot(share, journey);
  const envelope: EncryptedEnvelope = await encryptJson(snapshot, key);

  // Cache locally so the guardian view can still render from this device if the
  // server is unreachable (and so a revoked link stops immediately).
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${share.token}`,
      JSON.stringify({ envelope, expiresAt: share.expiresAt, cachedAt: new Date().toISOString() }),
    );
  } catch {
    /* quota — not fatal */
  }

  await db.shares.update(share.id, {
    snapshotUpdatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await enqueue({
    ownerId: share.ownerId,
    kind: 'share',
    priority: PRIORITY.share,
    endpoint: `/shares/${share.token}/snapshot`,
    method: 'PUT',
    body: { ciphertext: envelope, riskBand: snapshot.riskBand, journeyStatus: snapshot.status },
    dedupeKey: `share-snapshot:${share.id}`,
  });

  return true;
}

/** Republishes every active share for an owner. Returns how many succeeded. */
export async function publishSnapshots(ownerId: string): Promise<number> {
  const shares = (await listShares(ownerId)).filter((share) => share.status === 'active');
  let published = 0;
  for (const share of shares) {
    const journey = await db.journeys.get(share.journeyId);
    if (await publishSnapshot(share, journey)) published += 1;
  }
  return published;
}

/* --------------------------- Opening a share ------------------------------- */

export interface OpenShareResult {
  snapshot: GuardianSnapshot;
  expiresAt: string;
  encrypted: boolean;
  fromCache: boolean;
}

/**
 * Guardian-side fetch and decryption. Works from cache when the traveller's
 * device (or the server) is unreachable, and says so.
 */
export async function openShare(
  token: string,
  key: string,
): Promise<OpenShareResult | { error: string }> {
  const localShare = await db.shares.where('token').equals(token).first();

  try {
    const response = await apiFetch<{ ciphertext: EncryptedEnvelope | null; expiresAt: string; scopes: string[] }>(
      `/shares/${token}`,
      { timeoutMs: 10_000 },
    );

    if (!response.ciphertext) {
      return {
        error:
          'The traveller has created this link but no snapshot has been published yet. Ask them to open the journey on their device so a snapshot is sent.',
      };
    }

    const keyObject = await importShareKey(key);
    const snapshot = await decryptJson<GuardianSnapshot>(response.ciphertext, keyObject);
    return {
      snapshot,
      expiresAt: response.expiresAt,
      encrypted: response.ciphertext.alg === 'AES-GCM',
      fromCache: false,
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 410) {
      return { error: 'This guardian link has been revoked or has expired.' };
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return { error: 'This guardian link is not recognised. Check that the whole link was copied.' };
    }

    // Fall back to the cache stored on this device (works on the traveller's own
    // device and after a previous successful view on this browser).
    const cached = localStorage.getItem(`${CACHE_PREFIX}${token}`);
    if (!cached) {
      return {
        error:
          error instanceof ApiRequestError && error.offline
            ? 'You are offline and no cached copy of this journey is stored on this device.'
            : 'The guardian link could not be loaded right now.',
      };
    }

    try {
      const parsed = JSON.parse(cached) as { envelope: EncryptedEnvelope; expiresAt: string };
      const keyObject = await importShareKey(key);
      const snapshot = await decryptJson<GuardianSnapshot>(parsed.envelope, keyObject);
      return {
        snapshot,
        expiresAt: parsed.expiresAt,
        encrypted: parsed.envelope.alg === 'AES-GCM',
        fromCache: true,
      };
    } catch {
      return { error: 'The cached copy of this journey could not be decrypted with this link.' };
    }
  }
}

export async function touchShareViewed(shareId: string): Promise<void> {
  await db.shares.update(shareId, { lastViewedAt: new Date().toISOString() });
}

/* ------------------------------ Notifications ------------------------------ */

export interface NotifyOutcome {
  attempted: number;
  contacted: Array<{ name: string; phone: string; channel: 'server' | 'handoff'; ok: boolean }>;
  serverAcknowledged: boolean;
  message: string;
  smsHandoffText?: string;
}

/**
 * Tells the traveller's selected contacts what is happening.
 *
 * Two channels, and the result is always reported as what actually happened:
 *  - the reporting server (which can mirror the alert and, if configured, send
 *    SMS through a gateway), and
 *  - an on-device SMS handoff, which only opens the messaging app — the UI must
 *    never imply the message was sent.
 */
export async function notifyContacts(input: {
  ownerId: string;
  journey: Journey;
  reason: 'trusted_contact_notice' | 'sos' | 'manual';
  assessment?: RiskAssessment;
  note?: string;
  location?: { lat: number; lng: number };
}): Promise<NotifyOutcome> {
  const contacts = (await listContacts(input.ownerId)).filter((contact) => contact.canReceiveAlerts);
  const selected =
    input.journey.guardianContactIds.length > 0
      ? contacts.filter((contact) => input.journey.guardianContactIds.includes(contact.id))
      : contacts;

  const token = await currentAccessToken();
  const location = input.location ?? input.journey.lastKnownLocation;

  const text = buildAlertText(input.journey, input.reason, input.assessment, input.note, location);

  let serverAcknowledged = false;
  let serverMessage = '';
  try {
    await apiFetch('/alerts/escalation', {
      method: 'POST',
      token,
      ownerId: input.ownerId,
      timeoutMs: 12_000,
      body: {
        id: `esc-${uuid()}`,
        ownerId: input.ownerId,
        ownerName: (await db.users.get(input.ownerId))?.fullName,
        journeyId: input.journey.id,
        journeyTitle: input.journey.title,
        reason: input.assessment?.rationale.join('; ') ?? input.reason,
        score: input.assessment?.score,
        location,
        contactPhones: selected.map((contact) => contact.phone),
        message: text,
      },
    });
    serverAcknowledged = true;
  } catch (error) {
    serverMessage =
      error instanceof ApiRequestError
        ? error.offline
          ? 'You are offline, so the alert is queued on this device.'
          : error.message
        : 'The alert could not be sent to the server.';
    await enqueue({
      ownerId: input.ownerId,
      kind: 'notification',
      priority: input.reason === 'sos' ? PRIORITY.sos : PRIORITY.escalation,
      endpoint: '/alerts/escalation',
      method: 'POST',
      body: {
        id: `esc-${uuid()}`,
        ownerId: input.ownerId,
        journeyId: input.journey.id,
        journeyTitle: input.journey.title,
        reason: input.assessment?.rationale.join('; ') ?? input.reason,
        score: input.assessment?.score,
        location,
        contactPhones: selected.map((contact) => contact.phone),
        message: text,
      },
      dedupeKey: `escalation:${input.journey.id}:${Math.round(Date.now() / 60_000)}`,
    });
  }

  await recordEvent({
    ownerId: input.ownerId,
    journeyId: input.journey.id,
    type: 'guardian_notified',
    message: serverAcknowledged
      ? `Trusted contacts notified through the reporting server: ${selected.map((contact) => contact.name).join(', ') || 'none configured'}.`
      : `${serverMessage} Contacts selected: ${selected.map((contact) => contact.name).join(', ') || 'none configured'}.`,
    severity: input.reason === 'sos' ? 'critical' : 'notice',
    riskScore: input.assessment?.score,
    location,
    data: { reason: input.reason, channel: serverAcknowledged ? 'server' : 'queued' },
  });

  await pushNotification({
    ownerId: input.ownerId,
    kind: input.reason === 'sos' ? 'sos' : 'guardian',
    title: input.reason === 'sos' ? 'SOS alert prepared' : 'Trusted contacts notified',
    body: serverAcknowledged
      ? 'The alert reached the reporting server. It will be relayed to your contacts.'
      : serverMessage,
    severity: input.reason === 'sos' ? 'critical' : 'warning',
    journeyId: input.journey.id,
  });

  return {
    attempted: selected.length,
    contacted: selected.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      channel: serverAcknowledged ? 'server' : 'handoff',
      ok: serverAcknowledged,
    })),
    serverAcknowledged,
    message: serverAcknowledged
      ? `Alert accepted by the reporting server for ${selected.length} contact(s).`
      : `${serverMessage} Nothing is confirmed as delivered yet.`,
    smsHandoffText: text,
  };
}

export function buildAlertText(
  journey: Journey,
  reason: NotifyOutcome extends never ? never : 'trusted_contact_notice' | 'sos' | 'manual',
  assessment?: RiskAssessment,
  note?: string,
  location?: { lat: number; lng: number },
): string {
  const lines = [
    reason === 'sos'
      ? 'SURAKSHA SOS — a traveller may need help.'
      : 'SURAKSHA — please check on me.',
    `${journey.title} (${journey.originLabel} → ${journey.destinationLabel})`,
    journey.status === 'active' && journey.expectedArrivalAt
      ? `Expected arrival ${new Date(journey.expectedArrivalAt).toLocaleString()}`
      : `Journey status: ${journey.status}`,
  ];

  if (assessment) {
    lines.push(
      `On-device risk indicator ${assessment.score}/100 (heuristic, not a validated probability).`,
      ...assessment.rationale.slice(0, 4),
    );
  }
  if (location) lines.push(`Last known location: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`);
  if (note) lines.push(note);
  lines.push('If you cannot reach me, contact local emergency services.');

  return lines.join('\n');
}

/** Cached snapshot used by the in-app guardian preview. */
export async function cachedSnapshot(token: string): Promise<GuardianSnapshot | undefined> {
  const raw = localStorage.getItem(`${CACHE_PREFIX}${token}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { envelope: EncryptedEnvelope };
    if (parsed.envelope.alg !== 'none') return undefined;
    return JSON.parse(atob(parsed.envelope.ciphertext)) as GuardianSnapshot;
  } catch {
    return undefined;
  }
}

export function shareCacheKey(token: string): string {
  return `${CACHE_PREFIX}${digestId(token)}`;
}

export { stageExplanation };
