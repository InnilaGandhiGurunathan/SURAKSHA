import type { OfflineReadiness, SetupState, SetupStepId } from '@suraksha/shared';
import { db, requestPersistentStorage, storageEstimate, type StorageEstimate } from '@/lib/db';
import { recordEvent } from './events';
import { listContacts } from './contacts';
import { listJourneys } from './journeys';
import { planTilePack, tileCacheStats, downloadTilePack } from './tiles';

/**
 * Offline readiness.
 *
 * The product promise is: the internet is needed for first-time setup, after
 * which the app opens, shows cached data and keeps monitoring with no signal.
 * This module is what makes that checkable rather than aspirational. Each piece
 * of the offline bundle is verified independently, and the screen reports which
 * parts are genuinely present.
 */

const SETUP_KEY = 'setupState';

export const SETUP_STEPS: Array<{ id: SetupStepId; label: string; description: string }> = [
  { id: 'account', label: 'Account & consent', description: 'Your profile, safety rules and what you agreed to share.' },
  { id: 'permissions', label: 'Permissions', description: 'Location, notifications and storage.' },
  { id: 'contacts', label: 'Trusted contacts', description: 'Who to tell, and what they are allowed to see.' },
  { id: 'emergency', label: 'Emergency details', description: 'Local emergency number and any medical notes.' },
  { id: 'rules', label: 'Safety rules', description: 'Checkpoint windows, corridors and escalation behaviour.' },
  { id: 'offline_bundle', label: 'Offline data', description: 'App shell, rules, contacts and map corridor cached on this device.' },
  { id: 'complete', label: 'Ready to travel', description: 'SURAKSHA works without a connection from here.' },
];

export async function getSetupState(): Promise<SetupState> {
  const row = await db.settings.get(SETUP_KEY);
  const stored = row?.value as SetupState | undefined;
  return stored ?? { steps: {}, version: 1 };
}

export async function markSetupStep(
  id: SetupStepId,
  detail?: string,
  done = true,
): Promise<SetupState> {
  const state = await getSetupState();
  const steps = {
    ...state.steps,
    [id]: { done, at: new Date().toISOString(), detail },
  };
  const completeNow = SETUP_STEPS.filter((step) => step.id !== 'complete').every(
    (step) => steps[step.id]?.done,
  );

  const next: SetupState = {
    steps,
    version: 1,
    completedAt: completeNow ? state.completedAt ?? new Date().toISOString() : undefined,
  };

  await db.settings.put({ key: SETUP_KEY, value: next, updatedAt: new Date().toISOString() });
  return next;
}

export async function isSetupComplete(): Promise<boolean> {
  const state = await getSetupState();
  if (state.completedAt) return true;
  return SETUP_STEPS.filter((step) => step.id !== 'complete').every((step) => state.steps[step.id]?.done);
}

/**
 * Asks the active service worker to precache the app shell. Resolves when the
 * worker replies or the timeout elapses, and never throws: a shell that is not
 * fully precached is reported, not hidden.
 */
export async function precacheShell(timeoutMs = 8000): Promise<{ ok: boolean; message: string }> {
  if (!('serviceWorker' in navigator)) {
    return {
      ok: false,
      message: 'This browser has no service worker, so the app shell cannot be cached. Keep SURAKSHA open while travelling.',
    };
  }

  const registration = await navigator.serviceWorker.ready.catch(() => undefined);
  const worker = registration?.active;
  if (!worker) {
    return { ok: false, message: 'The service worker is not active yet. Reload once and try again.' };
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      resolve({
        ok: false,
        message: 'Precaching did not finish in time. The app still works offline once the pages you visited are cached.',
      });
    }, timeoutMs);

    channel.port1.onmessage = (event: MessageEvent<{ type: string; cached?: number }>) => {
      if (event.data?.type !== 'SURAKSHA_PRECACHED') return;
      clearTimeout(timer);
      resolve({
        ok: true,
        message: `App shell cached for offline use (${event.data.cached ?? 0} file(s)).`,
      });
    };

    worker.postMessage({ type: 'SURAKSHA_PRECACHE' }, [channel.port2]);
  });
}

export interface OfflineBundleResult {
  readiness: OfflineReadiness;
  storage: StorageEstimate;
  messages: string[];
}

export async function offlineReadiness(ownerId: string): Promise<OfflineBundleResult> {
  const [journeys, contacts, tiles, storage] = await Promise.all([
    listJourneys(ownerId),
    listContacts(ownerId),
    tileCacheStats(),
    storageEstimate(),
  ]);

  const shellCached = 'serviceWorker' in navigator && Boolean(await navigator.serviceWorker.getRegistration());
  const rules = await db.users.get(ownerId);
  const hasJourney = journeys.some((journey) => journey.status === 'planned' || journey.status === 'active');

  const readiness: OfflineReadiness = {
    shell: shellCached,
    rules: Boolean(rules?.rules),
    contacts: contacts.length > 0,
    journeys: hasJourney,
    tiles: tiles.tiles > 0,
    storage: storage.persisted,
    ready: shellCached && contacts.length > 0 && hasJourney,
    checkedAt: new Date().toISOString(),
    note: '',
  };

  const messages: string[] = [];
  if (!readiness.shell) messages.push('The app shell is not cached yet — open the app once while online.');
  if (!readiness.rules) messages.push('Safety rules are missing; defaults will be used until you save them.');
  if (!readiness.contacts) messages.push('No trusted contacts yet — nobody can be alerted until you add one.');
  if (!readiness.journeys) messages.push('No upcoming journey yet — monitoring needs a journey to watch.');
  if (!readiness.tiles) messages.push('No map tiles cached. The map will be blank offline, but tracking still works.');
  if (!readiness.storage) {
    messages.push('Storage is not marked as persistent, so the browser may evict cached data under pressure.');
  }

  readiness.note =
    messages.length === 0
      ? 'This device is ready to travel without a signal: app shell, rules, contacts and map corridor are all stored locally.'
      : messages.join(' ');

  return { readiness, storage, messages };
}

/**
 * Prepares the offline bundle for a journey: shell, then the map corridor.
 * Progress is reported step by step so the user can stop at any point.
 */
export async function downloadOfflineBundle(input: {
  ownerId: string;
  journeyId: string;
  label: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  paddingPoints?: Array<{ lat: number; lng: number }>;
  radiusKm?: number;
  onStep?: (step: { id: string; label: string; status: 'running' | 'done' | 'failed'; detail: string }) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; packId?: string; messages: string[] }> {
  const messages: string[] = [];

  input.onStep?.({ id: 'storage', label: 'Persistent storage', status: 'running', detail: 'Asking the browser to keep safety data.' });
  const persisted = await requestPersistentStorage();
  messages.push(
    persisted
      ? 'Storage marked as persistent.'
      : 'The browser did not grant persistent storage. Keep some free space so safety data is not evicted.',
  );
  input.onStep?.({
    id: 'storage',
    label: 'Persistent storage',
    status: persisted ? 'done' : 'failed',
    detail: persisted ? 'Safety data protected from eviction.' : 'Not granted — data may be evicted under storage pressure.',
  });

  input.onStep?.({ id: 'shell', label: 'App shell', status: 'running', detail: 'Caching the interface for offline use.' });
  const shell = await precacheShell();
  messages.push(shell.message);
  input.onStep?.({ id: 'shell', label: 'App shell', status: shell.ok ? 'done' : 'failed', detail: shell.message });

  input.onStep?.({ id: 'rules', label: 'Safety rules & contacts', status: 'running', detail: 'Reading from the device.' });
  const [contactsResult, rules] = await Promise.all([listContacts(input.ownerId), db.users.get(input.ownerId)]);
  const rulesOk = Boolean(rules?.rules);
  input.onStep?.({
    id: 'rules',
    label: 'Safety rules & contacts',
    status: rulesOk && contactsResult.length > 0 ? 'done' : 'failed',
    detail: `${rulesOk ? 'Safety rules stored locally.' : 'Using default rules.'} ${contactsResult.length} trusted contact(s).`,
  });

  const plan = planTilePack({
    origin: input.origin,
    destination: input.destination,
    paddingPoints: input.paddingPoints,
    radiusKm: input.radiusKm,
  });

  input.onStep?.({
    id: 'tiles',
    label: 'Map corridor',
    status: 'running',
    detail: `Downloading ${plan.tiles.length} tile(s) around the route.`,
  });

  const pack = await downloadTilePack({
    journeyId: input.journeyId,
    ownerId: input.ownerId,
    label: input.label,
    origin: input.origin,
    destination: input.destination,
    paddingPoints: input.paddingPoints,
    radiusKm: input.radiusKm,
    signal: input.signal,
    onProgress: (progress) => {
      input.onStep?.({
        id: 'tiles',
        label: 'Map corridor',
        status: 'running',
        detail: `${progress.stored}/${progress.requested} tiles stored (${(progress.bytes / 1_048_576).toFixed(1)} MB).`,
      });
    },
  });

  messages.push(
    pack.status === 'ready'
      ? 'Map corridor stored on this device.'
      : `Map corridor is ${pack.status}${pack.error ? `: ${pack.error}` : '.'}`,
  );
  input.onStep?.({
    id: 'tiles',
    label: 'Map corridor',
    status: pack.status === 'ready' ? 'done' : 'failed',
    detail: `${pack.tilesStored}/${pack.tilesRequested} tile(s) stored.`,
  });

  if (pack.status !== 'failed') {
    await db.journeys.update(input.journeyId, { mapPackId: pack.id, updatedAt: new Date().toISOString() });
  }

  await markSetupStep('offline_bundle', `Map pack ${pack.status} (${pack.tilesStored} tiles).`, pack.status === 'ready');
  await recordEvent({
    ownerId: input.ownerId,
    journeyId: input.journeyId,
    type: 'offline_ready',
    message: `Offline bundle prepared: ${pack.tilesStored}/${pack.tilesRequested} tiles stored, ${contactsResult.length} contact(s) available.`,
    data: { packId: pack.id, status: pack.status },
  });

  return { ok: pack.status === 'ready', packId: pack.id, messages };
}

export const OFFLINE_NOTE =
  'SURAKSHA is offline-first: the app shell, your safety rules, your contacts, your journeys and the map corridor for each planned journey live on this device. The internet is only needed for first-time setup, syncing and delivering reports.';
