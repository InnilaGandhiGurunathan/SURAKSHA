import { Router } from 'express';
import { nanoid } from 'nanoid';
import type { ReportSubmissionPayload } from '@suraksha/shared';
// The single shared implementation of the human tracking reference. The app, the
// website and this server must derive the *same* string from a clientReportId, so
// there is deliberately only one algorithm in the repository.
import { reportReference } from '@suraksha/shared';
import { REPORT_CATEGORIES, REPORT_SUBMISSION_SOURCES } from '../constants.js';
import { config, localAdminAllowed, supabaseEnabled } from '../config.js';
import { authoriseResponder, requireResponder, responderAuthNote } from '../rbac.js';
import { db, mirror, persist, type StoredReport } from '../store.js';

/**
 * Incident reporting API — the primary channel described in the product brief.
 *
 * Contract with the client:
 *  - the client generates `clientReportId` **on the device** and sends it with
 *    every attempt, including the fallback website submission. This endpoint is
 *    idempotent on that value, so a report that arrives twice (queued app copy +
 *    website copy) is stored once and the second caller is told it was a
 *    duplicate;
 *  - a 2xx response **is** the acknowledgement. It always carries a server-side
 *    `serverAckId`, which is the only thing the app treats as "delivered";
 *  - nothing is ever reported as delivered by the app before this endpoint (or
 *    the equivalent website call) answers.
 */
export const reportsRouter = Router();

reportsRouter.post('/reports', async (req, res) => {
  const payload = req.body as ReportSubmissionPayload | undefined;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ ok: false, error: 'A report payload is required.' });
    return;
  }
  if (!payload.clientReportId || typeof payload.clientReportId !== 'string') {
    res.status(400).json({
      ok: false,
      error: 'clientReportId is required — it is what prevents duplicate reports.',
      code: 'missing_client_report_id',
    });
    return;
  }
  if (!payload.title || !payload.description) {
    res.status(400).json({ ok: false, error: 'Both a title and a description are required.' });
    return;
  }
  if (!REPORT_CATEGORIES.includes(payload.category)) {
    res.status(400).json({ ok: false, error: `Unknown category “${payload.category}”.` });
    return;
  }
  if (payload.source && !REPORT_SUBMISSION_SOURCES.includes(payload.source)) {
    res.status(400).json({ ok: false, error: `Unknown source “${payload.source}”.` });
    return;
  }

  const existing = db().reports.find((report) => report.clientReportId === payload.clientReportId);
  if (existing) {
    // Idempotent: return the original acknowledgement so the client can stop retrying.
    res.status(200).json({
      ok: true,
      data: {
        ok: true,
        serverAckId: existing.ackId,
        reportId: existing.id,
        receivedAt: existing.receivedAt,
        duplicate: true,
        status: existing.status,
      },
    });
    return;
  }

  const now = new Date().toISOString();
  const record: StoredReport = {
    id: `rpt_${nanoid(14)}`,
    clientReportId: payload.clientReportId,
    category: payload.category,
    severity: payload.severity ?? 'medium',
    title: payload.title.slice(0, 200),
    description: payload.description.slice(0, 8000),
    occurredAt: payload.occurredAt ?? now,
    anonymity: payload.anonymity ?? 'named',
    reporterName: payload.anonymity === 'anonymous' ? undefined : payload.reporterName,
    reporterContact: payload.anonymity === 'anonymous' ? undefined : payload.reporterContact,
    location: payload.location,
    locationLabel: payload.locationLabel,
    journeyId: payload.journeyId,
    attachments: payload.attachments,
    riskScore: payload.riskScore,
    source: payload.source ?? 'pwa',
    status: payload.riskScore && payload.riskScore >= 50 ? 'acknowledged' : 'submitted',
    verification: 'unverified',
    isCommunityVisible: false,
    // The owning account, when the caller sent one. Anonymous reports keep no
    // owner link at all, so a published community item cannot be traced back.
    ownerId:
      payload.anonymity === 'anonymous'
        ? undefined
        : (req.header('x-suraksha-owner') ?? undefined),
    receivedAt: now,
    updatedAt: now,
    ackId: `ack_${nanoid(16)}`,
  };

  db().reports.unshift(record);
  await persist('reports');
  await mirror('incident_reports', {
    id: record.id,
    client_report_id: record.clientReportId,
    category: record.category,
    severity: record.severity,
    title: record.title,
    description: record.description,
    occurred_at: record.occurredAt,
    anonymity: record.anonymity,
    reporter_name: record.reporterName ?? null,
    reporter_contact: record.reporterContact ?? null,
    location: record.location ?? null,
    location_label: record.locationLabel ?? null,
    journey_id: record.journeyId ?? null,
    risk_score: record.riskScore ?? null,
    source: record.source,
    status: record.status,
    verification: record.verification,
    is_community_visible: record.isCommunityVisible,
    received_at: record.receivedAt,
  });

  console.log(
    `[suraksha] report ${record.clientReportId.slice(0, 8)} received from ${record.source} (${record.category}/${record.severity})`,
  );

  res.status(201).json({
    ok: true,
    data: {
      ok: true,
      serverAckId: record.ackId,
      reportId: record.id,
      receivedAt: record.receivedAt,
      duplicate: false,
      status: record.status,
    },
  });
});

/** Fetch one report by device id (used by the fallback website pre-fill). */
reportsRouter.get('/reports/:clientReportId', (req, res) => {
  const report = db().reports.find((item) => item.clientReportId === req.params.clientReportId);
  if (!report) {
    res.status(404).json({ ok: false, error: 'No report found with that id.' });
    return;
  }
  res.json({
    ok: true,
    data: {
      report: {
        clientReportId: report.clientReportId,
        category: report.category,
        severity: report.severity,
        title: report.title,
        description: report.description,
        occurredAt: report.occurredAt,
        anonymity: report.anonymity,
        location: report.location,
        locationLabel: report.locationLabel,
        journeyId: report.journeyId,
        attachments: report.attachments,
        riskScore: report.riskScore,
        source: report.source,
        status: report.status,
      },
    },
  });
});

/**
 * Public tracking. Accepts the human reference (`SRK-4F9A21`) or the raw
 * client id, and returns only non-identifying status information.
 */
reportsRouter.get('/reports/track/:reference', (req, res) => {
  const reference = req.params.reference.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const report = db().reports.find(
    (item) =>
      item.clientReportId.toUpperCase() === reference || reportReference(item.clientReportId) === reference,
  );

  if (!report) {
    res.status(404).json({ ok: false, error: 'No report found with that tracking reference.' });
    return;
  }

  res.json({
    ok: true,
    data: {
      status: report.status,
      receivedAt: report.receivedAt,
      verification: report.verification,
      note: report.verificationNote,
      fallbackReportingUrl: config.fallbackReportUrl,
    },
  });
});

/**
 * Admin: incident queue for the response dashboard.
 *
 * Role-gated server-side (see `rbac.ts`). Reporter contact details are returned
 * for named reports — a responder cannot follow up otherwise — but never for
 * anonymous ones, and never in the community feed.
 */
reportsRouter.get('/admin/incidents', async (req, res) => {
  const auth = await authoriseResponder(req);
  if (!auth.authorised) {
    await requireResponder(req, res);
    return;
  }

  const verification = req.query.verification as string | undefined;
  const items = db()
    .reports.filter((report) => (verification ? report.verification === verification : true))
    .map((report) => ({
      id: report.id,
      clientReportId: report.clientReportId,
      reference: reportReference(report.clientReportId),
      ownerId: report.ownerId ?? '',
      ownerDisplayName: report.anonymity === 'anonymous' ? undefined : report.reporterName,
      reporterName: report.anonymity === 'anonymous' ? undefined : report.reporterName,
      reporterContact: report.anonymity === 'anonymous' ? undefined : report.reporterContact,
      category: report.category,
      severity: report.severity,
      title: report.title,
      description: report.description,
      location: report.location,
      locationLabel: report.locationLabel,
      journeyId: report.journeyId,
      riskScore: report.riskScore,
      source: report.source,
      occurredAt: report.occurredAt,
      anonymity: report.anonymity,
      attachments: report.attachments ?? [],
      status: report.status,
      attempts: 0,
      verification: report.verification,
      verificationNote: report.verificationNote,
      isCommunityVisible: report.isCommunityVisible,
      receivedAt: report.receivedAt,
      createdAt: report.receivedAt,
      updatedAt: report.updatedAt,
      isDemo: Boolean((report as { isDemo?: boolean }).isDemo),
    }));

  res.json({
    ok: true,
    data: {
      // `items` is the shape the console reads; `incidents` is kept for any older
      // client that was written against the first draft of this endpoint.
      items,
      incidents: items,
      count: items.length,
      authNote: responderAuthNote(auth),
      storage: supabaseEnabled ? 'supabase' : 'local-json-store',
      localStorageOnly: !supabaseEnabled,
      localAdminMode: localAdminAllowed,
    },
  });
});

/** Admin: verify / reject / request more information. */
reportsRouter.post('/admin/incidents/:clientReportId/verification', async (req, res) => {
  if (!(await requireResponder(req, res))) return;

  const { verification, note, communityVisible } = req.body as {
    verification?: string;
    note?: string;
    communityVisible?: boolean;
  };
  const allowed = ['verified', 'rejected', 'needs_info', 'unverified'];

  if (!verification || !allowed.includes(verification)) {
    res.status(400).json({
      ok: false,
      error: `verification must be one of ${allowed.join(', ')}.`,
    });
    return;
  }

  const report = db().reports.find((item) => item.clientReportId === req.params.clientReportId);
  if (!report) {
    res.status(404).json({ ok: false, error: 'No report found with that id.' });
    return;
  }

  report.verification = verification as StoredReport['verification'];
  report.verificationNote = note?.slice(0, 1000);
  // Publishing is an explicit decision: a reviewer may verify a report and still
  // choose to keep it private (for example when it identifies a person).
  report.isCommunityVisible = verification === 'verified' ? communityVisible !== false : false;
  report.status = verification === 'verified' ? 'verified' : report.status;
  report.updatedAt = new Date().toISOString();

  await persist('reports');
  await mirror('incident_reports', {
    id: report.id,
    client_report_id: report.clientReportId,
    verification: report.verification,
    verification_note: report.verificationNote ?? null,
    is_community_visible: report.isCommunityVisible,
    status: report.status,
    updated_at: report.updatedAt,
  });

  res.json({ ok: true, data: { verification: report.verification, updatedAt: report.updatedAt } });
});

/**
 * Community feed.
 *
 * Only verified + explicitly community-visible reports are returned, and all
 * identifying fields are reduced here (never trusted to the client alone).
 */
reportsRouter.get('/community/feed', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusKm = Number(req.query.radiusKm ?? 0);

  const hasCenter = Number.isFinite(lat) && Number.isFinite(lng) && radiusKm > 0;

  const items = db()
    .reports.filter((report) => report.verification === 'verified' && report.isCommunityVisible)
    .filter((report) => {
      if (!hasCenter || !report.location) return true;
      const distance = haversineKm(lat, lng, report.location.lat, report.location.lng);
      return distance <= radiusKm;
    })
    .slice(0, 200)
    .map((report) => ({
      id: report.id,
      category: report.category,
      severity: report.severity,
      title: report.title,
      summary: redact(report.description),
      locationLabel: report.locationLabel,
      location: report.location ? { lat: report.location.lat, lng: report.location.lng } : undefined,
      occurredAt: report.occurredAt,
      verification: report.verification,
      reference: reportReference(report.clientReportId),
      reporterRef: `Report ${reportReference(report.clientReportId)}`,
      confirmations: 0,
    }));

  res.json({ ok: true, data: { items, fetchedAt: new Date().toISOString() } });
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Removes identifying detail before anything is published to the community. */
function redact(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[email removed]')
    .replace(/(\+?\d[\d\s-]{7,}\d)/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .slice(0, 260);
}
