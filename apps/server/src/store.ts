import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, supabaseEnabled } from './config.js';
import { getSupabaseAdmin } from './supabase.js';

/**
 * Persistence for the reporting server.
 *
 * A single JSON document per collection lives in `SURAKSHA_DATA_DIR`. It is
 * deliberately simple, atomic on write, and dependency-free, so the whole
 * product can be demoed on a laptop with no database. When Supabase credentials
 * are present, writes are mirrored into Postgres and reads prefer Postgres.
 */

export interface StoredReport {
  id: string;
  clientReportId: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  occurredAt: string;
  anonymity: string;
  reporterName?: string;
  reporterContact?: string;
  location?: { lat: number; lng: number; accuracy?: number };
  locationLabel?: string;
  journeyId?: string;
  attachments?: unknown[];
  riskScore?: number;
  source: 'pwa' | 'website' | 'sms' | 'server';
  status: string;
  verification: 'unverified' | 'verified' | 'rejected' | 'needs_info';
  verificationNote?: string;
  isCommunityVisible: boolean;
  ownerId?: string;
  receivedAt: string;
  updatedAt: string;
  ackId: string;
  /** Sample data created by `npm run seed`. Always shown as demo in the console. */
  isDemo?: boolean;
}

export interface StoredJourney {
  id: string;
  ownerId: string;
  payload: unknown;
  updatedAt: string;
}

export interface StoredEvent {
  id: string;
  ownerId: string;
  journeyId?: string;
  payload: unknown;
  createdAt: string;
}

export interface StoredAlert {
  id: string;
  kind: 'sos' | 'escalation' | 'guardian';
  ownerId: string;
  ownerName?: string;
  journeyId?: string;
  journeyTitle?: string;
  location?: { lat: number; lng: number };
  message: string;
  payload: unknown;
  status: string;
  createdAt: string;
  acknowledgedAt?: string;
  isDemo?: boolean;
}

export interface StoredShare {
  id: string;
  tokenHash: string;
  token: string;
  journeyId: string;
  ownerId: string;
  contactName: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string;
  ciphertext?: unknown;
  lastViewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredContact {
  id: string;
  ownerId: string;
  payload: unknown;
  updatedAt: string;
}

export interface Database {
  reports: StoredReport[];
  journeys: StoredJourney[];
  events: StoredEvent[];
  alerts: StoredAlert[];
  shares: StoredShare[];
  contacts: StoredContact[];
  meta: Record<string, unknown>;
}

const EMPTY: Database = {
  reports: [],
  journeys: [],
  events: [],
  alerts: [],
  shares: [],
  contacts: [],
  meta: {},
};

let database: Database = { ...EMPTY };
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

function fileFor(collection: keyof Omit<Database, 'meta'>): string {
  return path.join(config.dataDir, `${collection}.json`);
}

export async function initStore(): Promise<void> {
  if (loaded) return;
  await fsp.mkdir(config.dataDir, { recursive: true });
  const next: Database = { ...EMPTY };

  for (const collection of ['reports', 'journeys', 'events', 'alerts', 'shares', 'contacts'] as const) {
    const file = fileFor(collection);
    try {
      const raw = await fsp.readFile(file, 'utf8');
      (next[collection] as unknown[]) = JSON.parse(raw) as unknown[];
    } catch {
      (next[collection] as unknown[]) = [];
    }
  }

  try {
    const metaRaw = await fsp.readFile(path.join(config.dataDir, 'meta.json'), 'utf8');
    next.meta = JSON.parse(metaRaw) as Record<string, unknown>;
  } catch {
    next.meta = {};
  }

  database = next;
  loaded = true;
  console.log(
    `[suraksha] store ready at ${config.dataDir} (reports: ${database.reports.length}, alerts: ${database.alerts.length})${
      supabaseEnabled ? ' · Supabase mirroring enabled' : ' · local-only mode'
    }`,
  );
}

export function db(): Database {
  if (!loaded) throw new Error('Store not initialised. Call initStore() first.');
  return database;
}

/** Serialises writes so two concurrent requests cannot clobber a collection. */
export async function persist(collection: keyof Omit<Database, 'meta'>): Promise<void> {
  const snapshot = JSON.stringify(database[collection], null, 2);
  const file = fileFor(collection);
  writeQueue = writeQueue.then(async () => {
    const temp = `${file}.tmp`;
    await fsp.writeFile(temp, snapshot, 'utf8');
    await fsp.rename(temp, file);
  });
  return writeQueue;
}

export async function persistMeta(): Promise<void> {
  const snapshot = JSON.stringify(database.meta, null, 2);
  writeQueue = writeQueue.then(async () => {
    const temp = path.join(config.dataDir, 'meta.json.tmp');
    await fsp.writeFile(temp, snapshot, 'utf8');
    await fsp.rename(temp, path.join(config.dataDir, 'meta.json'));
  });
  return writeQueue;
}

/** Mirror helper — never throws: a Supabase outage must not fail a client ack. */
export async function mirror<T>(
  table: string,
  row: Record<string, unknown>,
  options: { onConflict?: string; update?: boolean } = {},
): Promise<T | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  try {
    if (options.update) {
      await supabase.from(table).upsert(row, { onConflict: options.onConflict ?? 'id' });
    } else {
      await supabase.from(table).upsert(row, { onConflict: options.onConflict ?? 'id' });
    }
    return row as T;
  } catch (error) {
    console.warn(`[suraksha] Supabase mirror to ${table} failed`, error);
    return null;
  }
}

export function storeStats(): Record<string, number> {
  return {
    reports: database.reports.length,
    journeys: database.journeys.length,
    events: database.events.length,
    alerts: database.alerts.length,
    shares: database.shares.length,
    contacts: database.contacts.length,
  };
}

/** Used by tests: resets the in-memory store and removes the JSON files. */
export async function resetStore(): Promise<void> {
  database = { ...EMPTY };
  for (const collection of ['reports', 'journeys', 'events', 'alerts', 'shares', 'contacts'] as const) {
    try {
      if (fs.existsSync(fileFor(collection))) await fsp.unlink(fileFor(collection));
    } catch {
      /* ignore */
    }
  }
}
