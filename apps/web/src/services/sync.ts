import { db, getSetting, setSetting, SETTING_KEYS, pruneLocalHistory, type SyncLogRecord } from '@/lib/db';
import { uuid } from '@/lib/id';
import { ApiRequestError, apiFetch } from './api';
import { currentAccessToken } from './auth';
import {
  coalesceOutbox,
  markOutboxDone,
  markOutboxFailed,
  markOutboxInflight,
  outboxSummary,
  pendingOutbox,
} from './outbox';
import { retryPendingReports } from './reports';
import { recordEvent } from './events';
import { publishSnapshots } from './guardian';

/**
 * Synchronisation.
 *
 * Sync is strictly best-effort and never blocks the safety features: journeys,
 * checkpoints, risk scoring and SOS all work with the outbox full and the
 * network down. What sync adds is a mirror of the data (for guardians and
 * responders) plus the delivery confirmations the UI reports.
 */

export interface SyncResult {
  ok: boolean;
  pushed: number;
  failed: number;
  reportsRetried: number;
  reportsAcknowledged: number;
  sharesPublished: number;
  remaining: number;
  message: string;
  startedAt: string;
  finishedAt: string;
}

let running = false;

export function isSyncing(): boolean {
  return running;
}

export function syncAllowed(): boolean {
  return navigator.onLine;
}

export async function runSync(ownerId: string, options: { reason?: string } = {}): Promise<SyncResult> {
  const startedAt = new Date().toISOString();

  if (running) {
    return {
      ok: false,
      pushed: 0,
      failed: 0,
      reportsRetried: 0,
      reportsAcknowledged: 0,
      sharesPublished: 0,
      remaining: 0,
      message: 'A sync is already running on this device.',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  if (!navigator.onLine) {
    return {
      ok: false,
      pushed: 0,
      failed: 0,
      reportsRetried: 0,
      reportsAcknowledged: 0,
      sharesPublished: 0,
      remaining: 0,
      message: 'Offline — nothing was sent. Everything stays queued on this device.',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  running = true;
  const token = await currentAccessToken();

  try {
    const items = coalesceOutbox(await pendingOutbox(ownerId, 25));
    let pushed = 0;
    let failed = 0;

    for (const item of items) {
      await markOutboxInflight(item.id);
      try {
        await apiFetch(item.endpoint, {
          method: item.method,
          body: item.body,
          token,
          ownerId,
          timeoutMs: item.kind === 'report' ? 25_000 : 12_000,
        });
        await markOutboxDone(item.id);
        pushed += 1;
      } catch (error) {
        failed += 1;
        const apiError = error instanceof ApiRequestError ? error : undefined;
        const attempts = (await db.outbox.get(item.id))?.attempts ?? 1;
        await markOutboxFailed(item.id, apiError?.message ?? 'Unknown error', attempts);

        if (apiError?.offline) {
          // Connectivity died mid-sync; stop rather than burn attempts.
          break;
        }
      }
    }

    // Reports are handled by their own queue so their delivery status stays exact.
    const reportSummary = await retryPendingReports(ownerId, 5);

    // Refresh anything a guardian can currently see.
    const sharesPublished = await publishSnapshots(ownerId).catch(() => 0);

    await pruneLocalHistory(120).catch(() => 0);

    const summary = await outboxSummary(ownerId);
    const finishedAt = new Date().toISOString();

    const message =
      failed === 0
        ? items.length === 0 && reportSummary.acknowledged === 0
          ? 'Everything on this device is already in sync.'
          : `Sent ${pushed} item(s); ${reportSummary.acknowledged} report(s) acknowledged.`
        : `Sent ${pushed} item(s), ${failed} could not be delivered. They stay queued on this device.`;

    const log: SyncLogRecord = {
      id: uuid(),
      ownerId,
      kind: 'outbox',
      status: failed === 0 ? 'ok' : pushed > 0 ? 'partial' : 'failed',
      items: items.length,
      failed,
      message,
      startedAt,
      finishedAt,
      createdAt: finishedAt,
    };
    await db.syncLog.put(log);
    await setSetting(SETTING_KEYS.lastSyncAt, finishedAt);

    if (failed > 0 && pushed === 0) {
      await recordEvent({
        ownerId,
        type: 'sync_failed',
        message,
        localOnly: true,
      });
    } else if (items.length > 0) {
      await recordEvent({ ownerId, type: 'sync_completed', message, localOnly: true });
    }

    return {
      ok: failed === 0,
      pushed,
      failed,
      reportsRetried: reportSummary.attempted,
      reportsAcknowledged: reportSummary.acknowledged,
      sharesPublished,
      remaining: summary.pending,
      message,
      startedAt,
      finishedAt,
    };
  } finally {
    running = false;
  }
}

export async function syncNow(ownerId: string): Promise<SyncResult> {
  return runSync(ownerId, { reason: 'manual' });
}

export async function lastSyncAt(): Promise<string | undefined> {
  return getSetting<string>(SETTING_KEYS.lastSyncAt);
}

export async function syncHistory(ownerId: string, limit = 20): Promise<SyncLogRecord[]> {
  const rows = await db.syncLog.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}

/* ------------------------------- Auto sync -------------------------------- */

let autoSyncStarted = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

export interface AutoSyncOptions {
  intervalMs?: number;
  ownerId: string;
  onResult?: (result: SyncResult) => void;
}

/**
 * Wires reconnect events and a slow timer to `runSync`.
 *
 * Reconnecting gets a 2.5 s debounce because radios flap: the first request
 * after a tunnel often fails, and retrying gently avoids a storm of failures.
 */
export function startAutoSync(options: AutoSyncOptions): () => void {
  if (autoSyncStarted) return () => undefined;
  autoSyncStarted = true;

  const intervalMs = options.intervalMs ?? 120_000;

  const attempt = async (reason: string) => {
    if (!navigator.onLine) return;
    const result = await runSync(options.ownerId, { reason });
    options.onResult?.(result);
  };

  const onOnline = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void attempt('reconnect'), 2500);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void attempt('visible');
  };

  const timer = setInterval(() => void attempt('interval'), intervalMs);

  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onOnline);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    autoSyncStarted = false;
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Progress used by the "sync status" card in Settings. */
export async function syncStatus(ownerId: string): Promise<{
  online: boolean;
  syncing: boolean;
  lastSyncAt?: string;
  pending: number;
  failed: number;
  message: string;
}> {
  const summary = await outboxSummary(ownerId);
  const last = await lastSyncAt();
  return {
    online: navigator.onLine,
    syncing: running,
    lastSyncAt: last,
    pending: summary.pending,
    failed: summary.failed,
    message: !navigator.onLine
      ? `${summary.pending} item(s) waiting on this device. They will be sent when a connection returns.`
      : summary.pending === 0
        ? last
          ? 'Everything on this device has been mirrored.'
          : 'Nothing to sync yet.'
        : `${summary.pending} item(s) queued for the next sync.`,
  };
}
