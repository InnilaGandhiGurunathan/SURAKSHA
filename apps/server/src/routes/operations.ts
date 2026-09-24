import { Router } from 'express';
import { nanoid } from 'nanoid';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, mirror, persist, type StoredAlert } from '../store.js';
import { resolveCaller, requireRole } from '../supabase.js';
import { authoriseResponder, requireResponder, responderAuthNote } from '../rbac.js';
import { optionalSms, smsConfigured } from '../sms.js';

/**
 * Journeys, timeline events, contacts, alerts and guardian shares.
 *
 * Everything here is written to survive being offline on the client: every
 * endpoint is idempotent on a client-generated id, so retries from the outbox
 * are safe.
 */
export const operationsRouter = Router();

/* --------------------------------- Journeys -------------------------------- */

operationsRouter.post('/journeys', async (req, res) => {
  const journey = req.body as { id?: string; ownerId?: string; status?: string } | undefined;
  if (!journey?.id || !journey.ownerId) {
    res.status(400).json({ ok: false, error: 'id and ownerId are required.' });
    return;
  }

  const existingIndex = db().journeys.findIndex((item) => item.id === journey.id);
  const record = {
    id: journey.id,
    ownerId: journey.ownerId,
    payload: journey,
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) db().journeys[existingIndex] = record;
  else db().journeys.unshift(record);

  await persist('journeys');
  await mirror('journeys', {
    id: journey.id,
    owner_id: journey.ownerId,
    payload: journey,
    updated_at: record.updatedAt,
  });

  res.status(existingIndex >= 0 ? 200 : 201).json({ ok: true, data: { id: journey.id, updatedAt: record.updatedAt } });
});

operationsRouter.post('/journeys/:journeyId/locations', async (req, res) => {
  const { journeyId } = req.params;
  const body = req.body as { point?: { lat: number; lng: number }; recordedAt?: string } | undefined;
  if (!body?.point) {
    res.status(400).json({ ok: false, error: 'point is required.' });
    return;
  }

  const journey = db().journeys.find((item) => item.id === journeyId);
  if (journey) {
    (journey.payload as { lastKnownLocation?: unknown }).lastKnownLocation = body.point;
    journey.updatedAt = new Date().toISOString();
  }

  const alertList = db().alerts;
  const locationRecord = {
    id: `loc_${nanoid(12)}`,
    journeyId,
    point: body.point,
    recordedAt: body.recordedAt ?? new Date().toISOString(),
  };

  await mirror('journey_locations', {
    id: locationRecord.id,
    journey_id: journeyId,
    lat: body.point.lat,
    lng: body.point.lng,
    recorded_at: locationRecord.recordedAt,
  });

  if (journey) await persist('journeys');
  void alertList;

  res.status(202).json({ ok: true, data: { accepted: true, journeyKnown: Boolean(journey) } });
});

operationsRouter.post('/contacts', async (req, res) => {
  const contact = req.body as { id?: string; ownerId?: string } | undefined;
  if (!contact?.id || !contact.ownerId) {
    res.status(400).json({ ok: false, error: 'id and ownerId are required.' });
    return;
  }
  const index = db().contacts.findIndex((item) => item.id === contact.id);
  const record = { id: contact.id, ownerId: contact.ownerId, payload: contact, updatedAt: new Date().toISOString() };
  if (index >= 0) db().contacts[index] = record;
  else db().contacts.unshift(record);
  await persist('contacts');
  await mirror('trusted_contacts', {
    id: contact.id,
    owner_id: contact.ownerId,
    payload: contact,
    updated_at: record.updatedAt,
  });
  res.status(index >= 0 ? 200 : 201).json({ ok: true, data: { id: contact.id } });
});

/* ------------------------------ Event timeline ----------------------------- */

operationsRouter.post('/events', async (req, res) => {
  const body = req.body as { events?: Array<{ id: string; ownerId: string; createdAt?: string }> } | undefined;
  const incoming = body?.events ?? [];

  if (!Array.isArray(incoming) || incoming.length === 0) {
    res.json({ ok: true, data: { accepted: [] } });
    return;
  }
  if (incoming.length > 200) {
    res.status(413).json({ ok: false, error: 'Send at most 200 events per batch.' });
    return;
  }

  const accepted: string[] = [];
  for (const event of incoming) {
    if (!event?.id || !event.ownerId) continue;
    const exists = db().events.some((item) => item.id === event.id);
    if (exists) {
      accepted.push(event.id);
      continue;
    }
    db().events.unshift({
      id: event.id,
      ownerId: event.ownerId,
      journeyId: (event as { journeyId?: string }).journeyId,
      payload: event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    });
    accepted.push(event.id);
  }

  await persist('events');
  await mirror('journey_events', {
    id: `batch_${nanoid(10)}`,
    batch: incoming,
    received_at: new Date().toISOString(),
  });

  res.status(202).json({ ok: true, data: { accepted } });
});

/* ---------------------------------- Alerts --------------------------------- */

operationsRouter.post('/alerts/sos', async (req, res) => {
  const payload = req.body as {
    id?: string;
    ownerId: string;
    ownerName?: string;
    journeyId?: string;
    journeyTitle?: string;
    triggeredAt?: string;
    location?: { lat: number; lng: number };
    silent?: boolean;
    note?: string;
    lastEvents?: unknown;
  };

  if (!payload?.ownerId) {
    res.status(400).json({ ok: false, error: 'ownerId is required.' });
    return;
  }

  const alert: StoredAlert = {
    id: payload.id ?? `sos_${nanoid(14)}`,
    kind: 'sos',
    ownerId: payload.ownerId,
    ownerName: payload.ownerName,
    journeyId: payload.journeyId,
    journeyTitle: payload.journeyTitle,
    location: payload.location,
    message: payload.silent ? 'Silent SOS activated by the traveller.' : 'SOS activated by the traveller.',
    payload,
    status: 'received',
    createdAt: payload.triggeredAt ?? new Date().toISOString(),
  };

  const existing = db().alerts.find((item) => item.id === alert.id);
  if (existing) {
    res.json({ ok: true, data: { ok: true, alertId: existing.id, notified: 0, duplicate: true } });
    return;
  }

  db().alerts.unshift(alert);
  await persist('alerts');
  await mirror('alerts', {
    id: alert.id,
    kind: alert.kind,
    owner_id: alert.ownerId,
    journey_id: alert.journeyId ?? null,
    message: alert.message,
    location: alert.location ?? null,
    status: alert.status,
    created_at: alert.createdAt,
  });

  // Optional server-side SMS to the traveller's contacts (only when a gateway is
  // configured). Never reported as delivered to the client unless it succeeds.
  let notified = 0;
  if (smsConfigured() && payload.note !== undefined) {
    notified = await optionalSms(alert);
  }

  console.log(`[suraksha] SOS alert ${alert.id} recorded for owner ${alert.ownerId.slice(0, 8)}`);
  res.status(201).json({ ok: true, data: { ok: true, alertId: alert.id, notified } });
});

operationsRouter.post('/alerts/escalation', async (req, res) => {
  const payload = req.body as {
    id?: string;
    ownerId: string;
    ownerName?: string;
    journeyId?: string;
    reason?: string;
    score?: number;
    location?: { lat: number; lng: number };
  };

  if (!payload?.ownerId) {
    res.status(400).json({ ok: false, error: 'ownerId is required.' });
    return;
  }

  const alert: StoredAlert = {
    id: payload.id ?? `esc_${nanoid(14)}`,
    kind: 'escalation',
    ownerId: payload.ownerId,
    ownerName: payload.ownerName,
    journeyId: payload.journeyId,
    location: payload.location,
    message: `Risk escalated to ${payload.score ?? '?'} — ${payload.reason ?? 'signals accumulated'}.`,
    payload,
    status: 'received',
    createdAt: new Date().toISOString(),
  };

  db().alerts.unshift(alert);
  await persist('alerts');
  await mirror('alerts', {
    id: alert.id,
    kind: alert.kind,
    owner_id: alert.ownerId,
    journey_id: alert.journeyId ?? null,
    message: alert.message,
    location: alert.location ?? null,
    status: alert.status,
    created_at: alert.createdAt,
  });

  res.status(201).json({ ok: true, data: { ok: true, alerted: true } });
});

operationsRouter.get('/alerts', async (req, res) => {
  const auth = await authoriseResponder(req);
  if (!auth.authorised) {
    await requireResponder(req, res); // writes the explanatory 403
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const items = db()
    .alerts.slice(0, limit)
    .map((alert) => {
      const payload = (alert.payload ?? {}) as { score?: number; reason?: string; silent?: boolean; note?: string };
      const score = typeof payload.score === 'number' ? payload.score : undefined;
      return {
        id: alert.id,
        kind: alert.kind,
        ownerId: alert.ownerId,
        ownerName: alert.ownerName,
        journeyId: alert.journeyId,
        journeyTitle: alert.journeyTitle,
        message: alert.message,
        location: alert.location,
        status: alert.status,
        riskScore: score,
        riskBand: score === undefined ? undefined : bandForScore(score),
        silent: payload.silent,
        reason: payload.reason,
        note: payload.note,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        isDemo: Boolean((alert.payload as { isDemo?: boolean } | undefined)?.isDemo),
      };
    });

  res.json({
    ok: true,
    data: {
      items,
      authNote: responderAuthNote(auth),
      disclaimer:
        'Alerts appear here only when a device could reach the server. An empty queue is not evidence that nothing happened.',
    },
  });
});

/**
 * Response status update: acknowledge or resolve an alert.
 * Recorded with who did it and when, because "someone saw this" matters.
 */
operationsRouter.post('/alerts/:alertId/status', async (req, res) => {
  if (!(await requireResponder(req, res))) return;

  const { status, note } = req.body as { status?: string; note?: string };
  const allowed = ['received', 'acknowledged', 'responding', 'resolved', 'cancelled'];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ ok: false, error: `status must be one of ${allowed.join(', ')}.` });
    return;
  }

  const alert = db().alerts.find((item) => item.id === req.params.alertId);
  if (!alert) {
    res.status(404).json({ ok: false, error: 'No alert found with that id.' });
    return;
  }

  alert.status = status;
  if (status === 'acknowledged') alert.acknowledgedAt = new Date().toISOString();
  (alert.payload as Record<string, unknown>) = {
    ...(alert.payload as Record<string, unknown> | undefined),
    responseStatus: status,
    responseNote: note?.slice(0, 500),
    responseUpdatedAt: new Date().toISOString(),
  };

  await persist('alerts');
  await mirror('alerts', {
    id: alert.id,
    kind: alert.kind,
    owner_id: alert.ownerId,
    journey_id: alert.journeyId ?? null,
    message: alert.message,
    location: alert.location ?? null,
    status: alert.status,
    created_at: alert.createdAt,
    acknowledged_at: alert.acknowledgedAt ?? null,
  });

  res.json({ ok: true, data: { id: alert.id, status: alert.status, acknowledgedAt: alert.acknowledgedAt } });
});

/* ----------------------------- Guardian sharing ---------------------------- */

/** Mirrors the client's risk bands so the console colours match the travel app. */
function bandForScore(score: number): string {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score >= 10) return 'low';
  return 'safe';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

operationsRouter.post('/shares', async (req, res) => {
  const body = req.body as {
    id?: string;
    journeyId?: string;
    ownerId?: string;
    token?: string;
    tokenHash?: string;
    scopes?: string[];
    expiresAt?: string;
    contactName?: string;
  };

  if (!body?.journeyId || !body.ownerId || !body.token) {
    res.status(400).json({ ok: false, error: 'journeyId, ownerId and token are required.' });
    return;
  }

  const share = {
    id: body.id ?? `shr_${nanoid(12)}`,
    token: body.token,
    tokenHash: body.tokenHash ? hashToken(body.tokenHash) : hashToken(body.token),
    journeyId: body.journeyId,
    ownerId: body.ownerId,
    contactName: body.contactName ?? 'Guardian',
    scopes: body.scopes ?? ['journey:read', 'location:read'],
    status: 'active' as const,
    expiresAt: body.expiresAt ?? new Date(Date.now() + 72 * 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const index = db().shares.findIndex((item) => item.id === share.id);
  if (index >= 0) db().shares[index] = { ...db().shares[index], ...share };
  else db().shares.unshift(share);

  await persist('shares');
  await mirror('guardian_shares', {
    id: share.id,
    token_hash: share.tokenHash,
    journey_id: share.journeyId,
    owner_id: share.ownerId,
    contact_name: share.contactName,
    scopes: share.scopes,
    status: share.status,
    expires_at: share.expiresAt,
  });

  res.status(index >= 0 ? 200 : 201).json({ ok: true, data: { id: share.id, expiresAt: share.expiresAt } });
});

/**
 * Guardian fetch. Returns **ciphertext only** — the decryption key lives in the
 * URL fragment, which browsers never send to a server.
 */
operationsRouter.get('/shares/:token', async (req, res) => {
  const token = req.params.token;
  const share = db().shares.find((item) => item.token === token);
  if (!share) {
    res.status(404).json({ ok: false, error: 'This guardian link is not recognised.' });
    return;
  }
  if (share.status !== 'active') {
    res.status(410).json({ ok: false, error: 'This guardian link has been revoked.' });
    return;
  }
  if (new Date(share.expiresAt).getTime() < Date.now()) {
    share.status = 'expired';
    await persist('shares');
    res.status(410).json({ ok: false, error: 'This guardian link has expired.' });
    return;
  }

  share.lastViewedAt = new Date().toISOString();
  await persist('shares');

  res.json({
    ok: true,
    data: {
      ciphertext: share.ciphertext ?? null,
      scopes: share.scopes,
      expiresAt: share.expiresAt,
      contactName: share.contactName,
      encryptionNotice:
        'The snapshot is end-to-end encrypted. Only the key in the link fragment can decrypt it.',
    },
  });
});

operationsRouter.put('/shares/:token/snapshot', async (req, res) => {
  const share = db().shares.find((item) => item.token === req.params.token);
  if (!share) {
    res.status(404).json({ ok: false, error: 'Unknown guardian share.' });
    return;
  }
  if (share.status !== 'active') {
    res.status(410).json({ ok: false, error: 'This share is no longer active.' });
    return;
  }

  const body = req.body as { ciphertext?: unknown; riskBand?: string; journeyStatus?: string };
  share.ciphertext = body?.ciphertext ?? share.ciphertext;
  share.updatedAt = new Date().toISOString();
  await persist('shares');
  await mirror('guardian_shares', {
    id: share.id,
    token_hash: share.tokenHash,
    ciphertext: share.ciphertext ?? null,
    status: share.status,
    expires_at: share.expiresAt,
    updated_at: share.updatedAt,
  });

  res.json({ ok: true, data: { updated: true, updatedAt: share.updatedAt } });
});

operationsRouter.post('/shares/:token/revoke', async (req, res) => {
  const share = db().shares.find((item) => item.token === req.params.token);
  if (!share) {
    res.status(404).json({ ok: false, error: 'Unknown guardian share.' });
    return;
  }
  share.status = 'revoked';
  share.ciphertext = undefined;
  share.updatedAt = new Date().toISOString();
  await persist('shares');
  await mirror('guardian_shares', {
    id: share.id,
    token_hash: share.tokenHash,
    status: 'revoked',
    ciphertext: null,
    updated_at: share.updatedAt,
  });
  res.json({ ok: true, data: { status: 'revoked', revokedAt: share.updatedAt } });
});

/**
 * Journey event timeline, as seen by a responder.
 *
 * Events are only returned to a responder or admin: a timeline contains movement
 * patterns, which are more sensitive than the incident report that referenced it.
 */
operationsRouter.get('/journeys/:journeyId/events', async (req, res) => {
  if (!(await requireResponder(req, res))) return;

  const items = db()
    .events.filter((event) => event.journeyId === req.params.journeyId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((event) => {
      const payload = (event.payload ?? {}) as {
        type?: string;
        message?: string;
        severity?: string;
        location?: { lat: number; lng: number };
        riskScore?: number;
      };
      return {
        id: event.id,
        type: payload.type ?? 'journey_event',
        message: payload.message ?? '',
        severity: payload.severity ?? 'info',
        location: payload.location,
        riskScore: payload.riskScore,
        createdAt: event.createdAt,
      };
    });

  res.json({ ok: true, data: { items } });
});

/**
 * Guardian link inventory for the console.
 *
 * The raw token is never returned — only a short preview plus the hash — so
 * opening the console can never be enough to impersonate a guardian.
 */
operationsRouter.get('/admin/shares', async (req, res) => {
  const auth = await authoriseResponder(req);
  if (!auth.authorised) {
    await requireResponder(req, res);
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const items = db()
    .shares.slice(0, limit)
    .map((share) => ({
      id: share.id,
      journeyId: share.journeyId,
      ownerId: share.ownerId,
      contactName: share.contactName,
      scopes: share.scopes,
      status: share.status,
      expiresAt: share.expiresAt,
      lastViewedAt: share.lastViewedAt,
      createdAt: share.createdAt,
      tokenPreview: `${share.token.slice(0, 4)}…${share.token.slice(-2)}`,
      hasSnapshot: Boolean(share.ciphertext),
    }));

  res.json({
    ok: true,
    data: {
      items,
      authNote: responderAuthNote(auth),
      encryptionNotice:
        'Snapshots are end-to-end encrypted. The server stores ciphertext only, so no console can read a shared journey.',
    },
  });
});

/* --------------------------------- Shield meta ------------------------------ */

operationsRouter.get('/meta', (_req, res) => {
  res.json({
    ok: true,
    data: {
      service: 'suraksha-reporting',
      version: config.version,
      ackTimeoutSeconds: config.reporting.ackTimeoutSeconds,
      fallbackReportUrl: config.fallbackReportUrl,
      smsGatewayConfigured: smsConfigured(),
      riskWeights: {
        missed_checkpoint: 10,
        route_deviation_contextual: 25,
        manual_sos: 50,
      },
      disclaimer:
        'Risk weights are heuristic prototype indicators produced on the traveller’s device. They are not probabilities of danger and do not replace emergency services.',
      tokenHint: randomBytes(2).toString('hex'),
    },
  });
});
