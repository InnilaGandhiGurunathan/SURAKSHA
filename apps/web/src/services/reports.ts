import {
  REPORT_ACK_TIMEOUT_MS,
  REPORT_CATEGORIES,
  deliverySummary,
  redactForCommunity,
  reportReference,
  type GeoPoint,
  type IncidentReport,
  type ReportAnonymity,
  type ReportAttachment,
  type ReportCategory,
  type ReportDeliverySummary,
  type ReportSeverity,
  type ReportSubmissionPayload,
  type UserProfile,
} from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { REPORT_MAX_ATTEMPTS } from '@/lib/constants';
import { appEnv } from '@/lib/env';
import { ApiRequestError, apiFetch } from './api';
import { currentAccessToken } from './auth';

/**
 * Incident reporting.
 *
 * The contract, in order:
 *  1. the report is written to IndexedDB **first** and the UI says "queued";
 *  2. `submitReport` tries the primary channel with a hard 30-second
 *     acknowledgement deadline — no acknowledgement means no delivery claim;
 *  3. if the deadline passes, the fallback reporting website is opened carrying
 *     the same `clientReportId` and the same details, so a duplicate cannot be
 *     created no matter which channel arrives first;
 *  4. with no internet the report stays queued, is visibly marked as on-device
 *     only, and is retried automatically when connectivity returns.
 */

export const REPORT_FALLBACK_STORAGE_PREFIX = 'suraksha.report.handoff.';
export { REPORT_ACK_TIMEOUT_MS, deliverySummary };
export type { ReportDeliverySummary };

export interface CreateReportInput {
  owner: UserProfile;
  category: ReportCategory;
  severity: ReportSeverity;
  title: string;
  description: string;
  occurredAt?: string;
  location?: GeoPoint;
  locationLabel?: string;
  journeyId?: string;
  attachments?: ReportAttachment[];
  anonymity?: ReportAnonymity;
  riskScore?: number;
  /** Skip the automatic send attempt (drafts and demo data). */
  defer?: boolean;
}

export interface SubmitOptions {
  /** Open `/report-site` with the details when the 30-second deadline expires. */
  openFallbackWindow?: boolean;
  timeoutMs?: number;
  onProgress?: (elapsedMs: number, remainingMs: number) => void;
}

export interface SubmitOutcome {
  report: IncidentReport;
  acknowledged: boolean;
  duplicate: boolean;
  timedOut: boolean;
  fallbackOpened: boolean;
  fallbackUrl?: string;
  message: string;
}

/* --------------------------------- Create --------------------------------- */

export async function createReport(input: CreateReportInput): Promise<IncidentReport> {
  const now = new Date().toISOString();
  const report: IncidentReport = {
    id: uuid(),
    clientReportId: `srk-${uuid()}`,
    ownerId: input.owner.id,
    ownerDisplayName: input.anonymity === 'anonymous' ? undefined : input.owner.fullName,
    journeyId: input.journeyId,
    category: input.category,
    severity: input.severity,
    title: input.title.trim().slice(0, 160),
    description: input.description.trim(),
    occurredAt: input.occurredAt ?? now,
    location: input.location,
    locationLabel: input.locationLabel?.trim() || undefined,
    attachments: (input.attachments ?? []).slice(0, 4),
    anonymity: input.anonymity ?? 'named',
    status: 'queued',
    deliveryChannel: 'app',
    attempts: 0,
    verification: 'unverified',
    isCommunityVisible: false,
    riskScore: input.riskScore,
    createdAt: now,
    updatedAt: now,
  };

  await db.reports.put(report);
  return report;
}

/* --------------------------------- Submit --------------------------------- */

function toPayload(report: IncidentReport, source: ReportSubmissionPayload['source']): ReportSubmissionPayload {
  return {
    clientReportId: report.clientReportId,
    category: report.category,
    severity: report.severity,
    title: report.title,
    description: report.description,
    occurredAt: report.occurredAt,
    anonymity: report.anonymity,
    reporterName: report.anonymity === 'anonymous' ? undefined : report.ownerDisplayName,
    location: report.location,
    locationLabel: report.locationLabel,
    journeyId: report.journeyId,
    // Photos are base64 data URLs. They are deliberately kept local unless the
    // server is reachable and the upload succeeds; the report itself never waits
    // for media.
    attachments: report.attachments.filter((attachment) => Boolean(attachment.remoteUrl)),
    riskScore: report.riskScore,
    source,
  };
}

export async function submitReport(reportId: string, options: SubmitOptions = {}): Promise<SubmitOutcome> {
  const report = await db.reports.get(reportId);
  if (!report) throw new Error('That report is not on this device any more.');

  const timeoutMs = options.timeoutMs ?? REPORT_ACK_TIMEOUT_MS;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  await db.reports.update(reportId, {
    status: 'submitting',
    attempts: report.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const token = await currentAccessToken();

  try {
    const ack = await apiFetch<{
      ok: boolean;
      serverAckId: string;
      reportId: string;
      receivedAt: string;
      duplicate: boolean;
      status: string;
    }>('/reports', {
      method: 'POST',
      body: toPayload(report, 'pwa'),
      token,
      timeoutMs,
      ownerId: report.ownerId,
    });

    options.onProgress?.(Date.now() - startedAt, Math.max(0, deadline - Date.now()));

    const updated: IncidentReport = {
      ...report,
      status: ack.duplicate ? 'synced' : 'acknowledged',
      attempts: report.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      serverAckId: ack.serverAckId,
      receivedAt: ack.receivedAt ?? new Date().toISOString(),
      deliveryChannel: 'app',
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };
    await db.reports.put(updated);

    return {
      report: updated,
      acknowledged: true,
      duplicate: Boolean(ack.duplicate),
      timedOut: false,
      fallbackOpened: false,
      message: ack.duplicate
        ? 'The server already had this report — nothing was duplicated.'
        : 'The reporting server acknowledged your report.',
    };
  } catch (error) {
    const apiError = error instanceof ApiRequestError ? error : undefined;
    const elapsed = Date.now() - startedAt;
    const offline = apiError?.offline ?? !navigator.onLine;
    const isTimeout = Boolean(apiError?.timeout);

    // Waiting out the full window keeps the promise the UI made to the user:
    // the fallback only appears after the primary channel has genuinely had
    // 30 seconds to answer.
    if (!offline && !isTimeout && elapsed < timeoutMs) {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await sleep(Math.min(remaining, 1500));
        options.onProgress?.(Date.now() - startedAt, Math.max(0, deadline - Date.now()));
      }
    }

    const nextStatus: IncidentReport['status'] = offline
      ? 'queued'
      : isTimeout || elapsed >= timeoutMs
        ? 'timeout'
        : 'failed';

    const pending: IncidentReport = {
      ...report,
      status: nextStatus,
      attempts: report.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: apiError?.message ?? (error as Error)?.message,
      updatedAt: new Date().toISOString(),
    };
    await db.reports.put(pending);

    let fallbackOpened = false;
    let fallbackUrl: string | undefined;

    if (options.openFallbackWindow && !offline && nextStatus === 'timeout') {
      const opened = await openFallbackWebsite(pending);
      fallbackOpened = opened.opened;
      fallbackUrl = opened.url;
    }

    const finalReport = (await db.reports.get(reportId)) ?? pending;

    return {
      report: finalReport,
      acknowledged: false,
      duplicate: false,
      timedOut: nextStatus === 'timeout',
      fallbackOpened,
      fallbackUrl,
      message: offline
        ? 'No internet connection. The report is stored on this device and will be retried automatically.'
        : fallbackOpened
          ? 'No acknowledgement within 30 seconds, so the reporting website was opened with your details.'
          : 'The report could not be delivered yet. It stays on this device and will be retried.',
    };
  }
}

/* --------------------------- Fallback reporting site ---------------------- */

function compactPayload(report: IncidentReport): ReportSubmissionPayload {
  return {
    ...toPayload(report, 'website'),
    // Free text only: media can be added on the website, and keeping the URL
    // short means the handoff works even when localStorage is unavailable.
    attachments: [],
  };
}

export function encodePayload(payload: ReportSubmissionPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePayload(encoded: string): ReportSubmissionPayload {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as ReportSubmissionPayload;
}

export interface FallbackHandoff {
  url: string;
  opened: boolean;
  carriedInUrl: boolean;
  reference: string;
  key: string;
}

/**
 * Builds the handoff to the reporting website.
 *
 * The details are parked in `localStorage` under a key derived from the unique
 * report id (works when the website shares this origin — the default setup),
 * and *also* carried in the URL when they fit, which covers a website on a
 * different origin. `clientReportId` travels either way: that is what makes the
 * fallback safe to use after a timeout, because the server dedupes on it.
 */
export async function buildFallbackHandoff(report: IncidentReport): Promise<FallbackHandoff> {
  const payload = compactPayload(report);
  const key = `${REPORT_FALLBACK_STORAGE_PREFIX}${report.clientReportId}`;

  let carriedInUrl = false;
  let encoded = '';
  try {
    encoded = encodePayload(payload);
    carriedInUrl = encoded.length < 3500;
    localStorage.setItem(
      key,
      JSON.stringify({ payload, createdAt: new Date().toISOString(), reference: reportReferenceText(report) }),
    );
  } catch {
    // Private browsing or a full quota: fall back to URL carriage only.
    carriedInUrl = encoded.length > 0 && encoded.length < 6000;
  }

  const base = appEnv.fallbackReportUrl.startsWith('http')
    ? appEnv.fallbackReportUrl
    : `${window.location.origin}${appEnv.fallbackReportUrl}`;

  const url = new URL(base);
  url.searchParams.set('id', report.clientReportId);
  url.searchParams.set('ref', reportReferenceText(report));
  url.searchParams.set('source', 'pwa-fallback');
  if (carriedInUrl) url.searchParams.set('d', encoded);
  else url.searchParams.set('handoff', report.clientReportId);

  return { url: url.toString(), opened: false, carriedInUrl, reference: reportReferenceText(report), key };
}

/**
 * The human tracking reference. There is exactly one implementation, in
 * `@suraksha/shared`, so the string a traveller reads here is the same string the
 * server prints and the website accepts.
 */
export function reportReferenceText(report: IncidentReport): string {
  return reportReference(report.clientReportId);
}

export async function openFallbackWebsite(report: IncidentReport): Promise<fallbackResult> {
  const handoff = await buildFallbackHandoff(report);
  let opened = false;
  try {
    const popup = window.open(handoff.url, 'suraksha-report-site', 'noopener,noreferrer');
    opened = Boolean(popup);
  } catch {
    opened = false;
  }

  await db.reports.update(report.id, {
    status: 'fallback_opened',
    deliveryChannel: 'website',
    fallbackOpenedAt: new Date().toISOString(),
    fallbackUrl: handoff.url,
    updatedAt: new Date().toISOString(),
  });

  return { ...handoff, opened };
}

type fallbackResult = FallbackHandoff;

/* ------------------------------ Queue handling ----------------------------- */

export async function queuedReports(ownerId: string): Promise<IncidentReport[]> {
  const rows = await db.reports.where('ownerId').equals(ownerId).toArray();
  return rows
    .filter((report) => ['queued', 'failed', 'timeout', 'fallback_opened', 'submitting'].includes(report.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export interface RetrySummary {
  attempted: number;
  acknowledged: number;
  stillPending: number;
}

/** Called on reconnect and by the periodic sync. Safe to call often. */
export async function retryPendingReports(ownerId: string, limit = 5): Promise<RetrySummary> {
  const pending = (await queuedReports(ownerId)).slice(0, limit);
  let acknowledged = 0;

  for (const report of pending) {
    if (report.attempts >= REPORT_MAX_ATTEMPTS && report.status !== 'fallback_opened') {
      // Give up quietly but keep the data; the user can resend manually.
      await db.reports.update(report.id, { status: 'failed', updatedAt: new Date().toISOString() });
      continue;
    }
    const outcome = await submitReport(report.id, { timeoutMs: 15_000, openFallbackWindow: false });
    if (outcome.acknowledged) acknowledged += 1;
    // Sequential on purpose: one report at a time keeps bandwidth for SOS.
  }

  const stillPending = (await queuedReports(ownerId)).length;
  return { attempted: pending.length, acknowledged, stillPending };
}

export async function retryAllReports(ownerId: string): Promise<RetrySummary> {
  const pending = await queuedReports(ownerId);
  for (const report of pending) {
    if (report.attempts < REPORT_MAX_ATTEMPTS) {
      await db.reports.update(report.id, { attempts: 0, updatedAt: new Date().toISOString() });
    }
  }
  return retryPendingReports(ownerId, 20);
}

export interface OutboxStats {
  total: number;
  pending: number;
  failed: number;
  acknowledged: number;
  fallback: number;
  oldestPendingAt?: string;
}

export async function reportQueueStats(ownerId: string): Promise<OutboxStats> {
  const rows = await db.reports.where('ownerId').equals(ownerId).toArray();
  const pendingRows = rows.filter((report) =>
    ['queued', 'submitting', 'failed', 'timeout', 'fallback_opened'].includes(report.status),
  );
  return {
    total: rows.length,
    pending: pendingRows.length,
    failed: rows.filter((report) => report.status === 'failed').length,
    acknowledged: rows.filter((report) => Boolean(report.serverAckId)).length,
    fallback: rows.filter((report) => report.status === 'fallback_opened').length,
    oldestPendingAt: pendingRows
      .map((report) => report.createdAt)
      .sort()[0],
  };
}

export async function listReports(ownerId: string): Promise<IncidentReport[]> {
  const rows = await db.reports.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function deleteReport(reportId: string): Promise<void> {
  await db.reports.delete(reportId);
  try {
    localStorage.removeItem(`${REPORT_FALLBACK_STORAGE_PREFIX}${reportId}`);
  } catch {
    /* ignore */
  }
}

/** Community-safe projection: verified, community-visible and identity-stripped. */
export async function publishableReports(): Promise<
  Array<{
    id: string;
    category: ReportCategory;
    severity: ReportSeverity;
    title: string;
    summary: string;
    locationLabel?: string;
    location?: GeoPoint;
    occurredAt: string;
    reference: string;
  }>
> {
  const rows = await db.reports.toArray();
  return rows
    .filter((report) => report.verification === 'verified' && report.isCommunityVisible)
    .map((report) => ({
      id: report.id,
      category: report.category,
      severity: report.severity,
      title: report.title,
      summary: redactForCommunity(report.description).slice(0, 280),
      locationLabel: report.locationLabel,
      location: report.location,
      occurredAt: report.occurredAt,
      reference: reportReferenceText(report),
    }));
}

export function categoryLabel(category: ReportCategory): string {
  return REPORT_CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
