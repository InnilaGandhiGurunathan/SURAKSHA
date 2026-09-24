import { db, type OutboxRecord } from '@/lib/db';
import { uuid } from '@/lib/id';
import { backoffDelayMs } from './api';

/**
 * The offline outbox.
 *
 * Everything that eventually needs to reach the server goes through here, which
 * gives three properties the product depends on:
 *  - **survives reloads** (IndexedDB, not memory), so a report queued in a tunnel
 *    is still queued after the phone restarts;
 *  - **deduplicated** by `dedupeKey`, so the same logical write cannot be sent
 *    twice when two code paths notice it;
 *  - **prioritised**, so an SOS alert (priority 100) always leaves before routine
 *    location telemetry.
 */

export interface EnqueueInput {
  ownerId: string;
  kind: OutboxRecord['kind'];
  endpoint: string;
  method?: OutboxRecord['method'];
  body: unknown;
  dedupeKey: string;
  priority?: number;
}

export const PRIORITY = {
  sos: 100,
  escalation: 85,
  report: 70,
  share: 60,
  journey: 50,
  event: 30,
  contact: 40,
  notification: 20,
  location: 10,
} as const;

export async function enqueue(input: EnqueueInput): Promise<OutboxRecord> {
  const existing = await db.outbox.where('dedupeKey').equals(input.dedupeKey).first();
  if (existing && existing.status !== 'done') {
    // Refresh the payload but keep the schedule so retries are not reset.
    const updated: OutboxRecord = { ...existing, body: input.body, priority: input.priority ?? existing.priority };
    await db.outbox.put(updated);
    return updated;
  }
  if (existing?.status === 'done') return existing;

  const record: OutboxRecord = {
    id: uuid(),
    ownerId: input.ownerId,
    kind: input.kind,
    endpoint: input.endpoint,
    method: input.method ?? 'POST',
    body: input.body,
    dedupeKey: input.dedupeKey,
    priority: input.priority ?? PRIORITY[input.kind] ?? 30,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextAttemptAt: new Date().toISOString(),
  };
  await db.outbox.put(record);
  return record;
}

export async function pendingOutbox(ownerId: string, limit = 25): Promise<OutboxRecord[]> {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
  const now = Date.now();
  return rows
    .filter((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'inflight')
    .filter((item) => new Date(item.nextAttemptAt).getTime() <= now)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .slice(0, limit);
}

/** Groups event rows so a batch of timeline entries is one request, not fifty. */
export function coalesceOutbox(items: OutboxRecord[]): OutboxRecord[] {
  const eventItems = items.filter((item) => item.kind === 'event');
  if (eventItems.length < 2) return items;

  const others = items.filter((item) => item.kind !== 'event');
  const events = eventItems.flatMap((item) => {
    const body = item.body as { events?: unknown[] };
    return body?.events ?? [];
  });

  const batch: OutboxRecord = {
    ...eventItems[0],
    body: { events: events.slice(0, 60) },
    dedupeKey: `event-batch:${eventItems.map((item) => item.id).sort().join(',')}`,
  };

  return [...others, batch].sort((a, b) => b.priority - a.priority);
}

export async function markOutboxDone(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'done' });
  // Keep the table small: completed rows are only needed for a short audit.
  const done = await db.outbox.where('status').equals('done').toArray();
  const stale = done.filter((item) => Date.now() - new Date(item.createdAt).getTime() > 24 * 3600_000);
  if (stale.length) await db.outbox.bulkDelete(stale.map((item) => item.id));
}

export async function markOutboxFailed(id: string, error: string, attempts: number): Promise<void> {
  await db.outbox.update(id, {
    status: attempts >= 8 ? 'failed' : 'pending',
    attempts,
    lastError: error,
    nextAttemptAt: new Date(Date.now() + backoffDelayMs(attempts)).toISOString(),
  });
}

export async function markOutboxInflight(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'inflight', attempts: (await db.outbox.get(id))!.attempts + 1 });
}

export async function outboxSummary(ownerId: string): Promise<{
  pending: number;
  failed: number;
  oldestAt?: string;
}> {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
  const open = rows.filter((item) => item.status !== 'done');
  return {
    pending: open.length,
    failed: open.filter((item) => item.status === 'failed').length,
    oldestAt: open.map((item) => item.createdAt).sort()[0],
  };
}

export async function clearOutbox(ownerId: string): Promise<void> {
  const keys = await db.outbox.where('ownerId').equals(ownerId).primaryKeys();
  await db.outbox.bulkDelete(keys);
}
