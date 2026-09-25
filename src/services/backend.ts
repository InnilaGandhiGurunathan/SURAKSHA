/**
 * Backend façade.
 *
 * SURAKSHA ships as a local-first prototype: the "backend" is a clean service
 * boundary over the storage adapter plus the event bus. To move to Firebase,
 * implement `SurakshaBackend` with Firestore collections
 * (journeys, events, incidents, trustedContacts, alerts) and swap the instance
 * exported at the bottom of this file — the store and every screen keep working
 * because they only talk to this interface.
 */

import type {
  GuardianAlert,
  Incident,
  Journey,
  SafetyEvent,
  SafetyReport,
  SafePlace,
  TrustedContact,
  UserProfile,
} from '@/domain/types';
import { storage, STORAGE_KEYS, type StorageAdapter } from './storage';

export interface SurakshaBackend {
  readonly kind: string;
  /** True when writes are durable across reloads. */
  readonly durable: boolean;

  loadJourney(): Journey | null;
  saveJourney(journey: Journey | null): void;

  loadEvents(): SafetyEvent[];
  saveEvents(events: SafetyEvent[]): void;

  loadIncidents(): Incident[];
  saveIncidents(incidents: Incident[]): void;

  loadContacts(): TrustedContact[] | null;
  saveContacts(contacts: TrustedContact[]): void;

  loadAlerts(): GuardianAlert[];
  saveAlerts(alerts: GuardianAlert[]): void;

  loadProfiles(): { traveller: UserProfile; guardian: UserProfile } | null;
  saveProfiles(profiles: { traveller: UserProfile; guardian: UserProfile }): void;

  loadCommunity(): { places: SafePlace[]; reports: SafetyReport[] } | null;
  saveCommunity(payload: { places: SafePlace[]; reports: SafetyReport[] }): void;

  loadLearning<T>(): T | null;
  saveLearning<T>(value: T): void;

  loadRole(): string | null;
  saveRole(role: string): void;

  loadMeta(): { version: number } | null;
  saveMeta(meta: { version: number }): void;

  reset(): void;
}

class LocalBackend implements SurakshaBackend {
  readonly kind = 'local';
  readonly durable: boolean;

  constructor(private adapter: StorageAdapter) {
    this.durable = adapter.kind === 'local';
  }

  loadJourney() {
    return this.adapter.read<Journey>(STORAGE_KEYS.journey);
  }
  saveJourney(journey: Journey | null) {
    if (journey) this.adapter.write(STORAGE_KEYS.journey, journey);
    else this.adapter.remove(STORAGE_KEYS.journey);
  }

  loadEvents() {
    return this.adapter.read<SafetyEvent[]>(STORAGE_KEYS.events) ?? [];
  }
  saveEvents(events: SafetyEvent[]) {
    this.adapter.write(STORAGE_KEYS.events, events.slice(-500));
  }

  loadIncidents() {
    return this.adapter.read<Incident[]>(STORAGE_KEYS.incidents) ?? [];
  }
  saveIncidents(incidents: Incident[]) {
    this.adapter.write(STORAGE_KEYS.incidents, incidents);
  }

  loadContacts() {
    return this.adapter.read<TrustedContact[]>(STORAGE_KEYS.contacts);
  }
  saveContacts(contacts: TrustedContact[]) {
    this.adapter.write(STORAGE_KEYS.contacts, contacts);
  }

  loadAlerts() {
    return this.adapter.read<GuardianAlert[]>(STORAGE_KEYS.alerts) ?? [];
  }
  saveAlerts(alerts: GuardianAlert[]) {
    this.adapter.write(STORAGE_KEYS.alerts, alerts);
  }

  loadProfiles() {
    return this.adapter.read<{ traveller: UserProfile; guardian: UserProfile }>(STORAGE_KEYS.profiles);
  }
  saveProfiles(profiles: { traveller: UserProfile; guardian: UserProfile }) {
    this.adapter.write(STORAGE_KEYS.profiles, profiles);
  }

  loadCommunity() {
    return this.adapter.read<{ places: SafePlace[]; reports: SafetyReport[] }>(STORAGE_KEYS.community);
  }
  saveCommunity(payload: { places: SafePlace[]; reports: SafetyReport[] }) {
    this.adapter.write(STORAGE_KEYS.community, payload);
  }

  loadLearning<T>() {
    return this.adapter.read<T>(STORAGE_KEYS.learning);
  }
  saveLearning<T>(value: T) {
    this.adapter.write(STORAGE_KEYS.learning, value);
  }

  loadRole() {
    return this.adapter.read<string>(STORAGE_KEYS.role);
  }
  saveRole(role: string) {
    this.adapter.write(STORAGE_KEYS.role, role);
  }

  loadMeta() {
    return this.adapter.read<{ version: number }>(STORAGE_KEYS.meta);
  }
  saveMeta(meta: { version: number }) {
    this.adapter.write(STORAGE_KEYS.meta, meta);
  }

  reset() {
    this.adapter.clearNamespace();
  }
}

export const backend: SurakshaBackend = new LocalBackend(storage);

/**
 * Bumped whenever the persisted shape changes. Stored state from an older
 * version is discarded on load rather than rendered half-migrated.
 *
 * v4: Journey gained `helpRequestedAt` / `helpDeadlineAt` and Incident gained
 *     `origin` + the optional handoff fields. Without a bump, state written by
 *     v3 would load with those fields missing — precisely the half-migrated
 *     render this constant exists to prevent.
 */
export const SCHEMA_VERSION = 4;
