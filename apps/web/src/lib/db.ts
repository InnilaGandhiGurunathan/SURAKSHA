import Dexie, { type EntityTable } from 'dexie';
import type {
  AppNotification,
  GuardianShare,
  IncidentReport,
  Journey,
  JourneyEvent,
  JourneyLocationPoint,
  OfflineMapPack,
  SyncLogEntry,
  TrustedContact,
  UserProfile,
} from '@suraksha/shared';

/**
 * The device database. **This is the source of truth for the app.**
 *
 * Everything the user does is written here first and stays readable without a
 * network: journeys, checkpoints, events, reports, contacts, notifications and
 * the sync outbox. Supabase (or any server) only ever mirrors what is already
 * stored locally, which is what allows first-time setup to be the only moment
 * the internet is genuinely required.
 */

export interface SessionRecord {
  id: string;
  userId: string;
  /** `device` sessions never leave this browser; `remote` sessions belong to Supabase. */
  mode: 'device' | 'remote';
  salt: string;
  verifier: string;
  accessToken?: string;
  refreshToken?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt?: string;
}

export interface CheckInRecord {
  id: string;
  journeyId: string;
  ownerId: string;
  checkpointId?: string;
  prompt: string;
  reason: string;
  riskScore: number;
  status: 'pending' | 'safe' | 'not_safe' | 'snoozed' | 'timed_out';
  createdAt: string;
  dueAt: string;
  respondedAt?: string;
  snoozedUntil?: string;
  respondedLocation?: { lat: number; lng: number };
}

export interface OutboxRecord {
  id: string;
  ownerId: string;
  kind: 'journey' | 'event' | 'report' | 'location' | 'share' | 'contact' | 'notification';
  /** Higher runs first: an SOS beats routine telemetry. */
  priority: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body: unknown;
  /** Dedupe key — the same logical write is never queued twice. */
  dedupeKey: string;
  status: 'pending' | 'inflight' | 'failed' | 'done';
  attempts: number;
  lastError?: string;
  createdAt: string;
  nextAttemptAt: string;
}

export interface RiskSnapshotRecord {
  id: string;
  journeyId: string;
  ownerId: string;
  score: number;
  band: string;
  stage: string;
  signals: unknown;
  rationale: string[];
  createdAt: string;
}

export interface SyncLogRecord extends SyncLogEntry {
  id: string;
}

export interface AppSettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class SurakshaDatabase extends Dexie {
  users!: EntityTable<UserProfile, 'id'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  contacts!: EntityTable<TrustedContact, 'id'>;
  journeys!: EntityTable<Journey, 'id'>;
  events!: EntityTable<JourneyEvent, 'id'>;
  checkIns!: EntityTable<CheckInRecord, 'id'>;
  locations!: EntityTable<JourneyLocationPoint & { id: string }, 'id'>;
  reports!: EntityTable<IncidentReport, 'id'>;
  notifications!: EntityTable<AppNotification, 'id'>;
  shares!: EntityTable<GuardianShare, 'id'>;
  mapPacks!: EntityTable<OfflineMapPack, 'id'>;
  outbox!: EntityTable<OutboxRecord, 'id'>;
  syncLog!: EntityTable<SyncLogRecord, 'id'>;
  riskSnapshots!: EntityTable<RiskSnapshotRecord, 'id'>;
  settings!: EntityTable<AppSettingRecord, 'key'>;

  constructor() {
    super('suraksha');

    this.version(1).stores({
      users: 'id, email, phone, role, createdAt',
      sessions: 'id, userId, mode, lastActiveAt',
      contacts: 'id, ownerId, name, priority, isPrimary, createdAt',
      journeys: 'id, ownerId, status, scheduledStartAt, startedAt, completedAt, mapPackId, createdAt',
      events: 'id, ownerId, journeyId, type, severity, createdAt, syncedAt, [journeyId+createdAt]',
      checkIns: 'id, journeyId, ownerId, status, createdAt, dueAt',
      locations: 'id, journeyId, recordedAt, [journeyId+recordedAt]',
      reports:
        'id, ownerId, clientReportId, journeyId, category, severity, status, verification, occurredAt, createdAt',
      notifications: 'id, ownerId, kind, readAt, createdAt',
      shares: 'id, journeyId, ownerId, token, status, expiresAt, createdAt',
      mapPacks: 'id, journeyId, ownerId, createdAt',
      outbox: 'id, ownerId, kind, status, priority, dedupeKey, createdAt, nextAttemptAt',
      syncLog: 'id, ownerId, kind, status, createdAt',
      riskSnapshots: 'id, journeyId, ownerId, band, createdAt',
      settings: 'key, updatedAt',
    });
  }
}

export const db = new SurakshaDatabase();

/* ----------------------------- Setting helpers ----------------------------- */

export const SETTING_KEYS = {
  theme: 'theme',
  connectivityEvents: 'connectivityEvents',
  lastSyncAt: 'lastSyncAt',
  setupState: 'setupState',
  permissions: 'permissions',
  monitoring: 'monitoring',
  session: 'activeSessionId',
  demoMode: 'demoMode',
  lastKnownLocation: 'lastKnownLocation',
  storageEstimate: 'storageEstimate',
} as const;

export async function getSetting<T>(key: string, fallback?: T): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return (row?.value as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value, updatedAt: new Date().toISOString() });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

export async function allSettings(): Promise<Record<string, unknown>> {
  const rows = await db.settings.toArray();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/* ------------------------------ Danger zone -------------------------------- */

export const DB_TABLES = [
  'users',
  'sessions',
  'contacts',
  'journeys',
  'events',
  'checkIns',
  'locations',
  'reports',
  'notifications',
  'shares',
  'mapPacks',
  'outbox',
  'syncLog',
  'riskSnapshots',
  'settings',
] as const;

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean;
  perTable: Record<string, number>;
}

export async function storageEstimate(): Promise<StorageEstimate> {
  let usageBytes = 0;
  let quotaBytes = 0;
  let persisted = false;

  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? 0;
      quotaBytes = estimate.quota ?? 0;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    /* Storage API is best-effort. */
  }

  const perTable: Record<string, number> = {};
  await Promise.all(
    DB_TABLES.map(async (table) => {
      try {
        perTable[table] = await (db as unknown as Record<string, { count(): Promise<number> }>)[
          table
        ].count();
      } catch {
        perTable[table] = 0;
      }
    }),
  );

  return { usageBytes, quotaBytes, persisted, perTable };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

/** Erases everything this device holds. Remote copies are unaffected. */
export async function eraseAllLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  localStorage.removeItem('suraksha.session');
}

/* ------------------------------ Housekeeping ------------------------------- */

export async function pruneLocalHistory(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const stale = await db.locations.where('recordedAt').below(cutoff).primaryKeys();
  if (stale.length) await db.locations.bulkDelete(stale);
  const staleEvents = await db.events.where('createdAt').below(cutoff).primaryKeys();
  if (staleEvents.length) await db.events.bulkDelete(staleEvents);
  return stale.length + staleEvents.length;
}

export async function databaseStats(): Promise<{
  journeys: number;
  reports: number;
  events: number;
  contacts: number;
  pending: number;
}> {
  const [journeys, reports, events, contacts, pending] = await Promise.all([
    db.journeys.count(),
    db.reports.count(),
    db.events.count(),
    db.contacts.count(),
    db.outbox.where('status').anyOf('pending', 'inflight', 'failed').count(),
  ]);
  return { journeys, reports, events, contacts, pending };
}
