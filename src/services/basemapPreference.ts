/**
 * Which basemap the journey map draws: the built-in simulated canvas or real
 * Google tiles.
 *
 * `auto` is the default and means "live as soon as a usable key exists,
 * simulated otherwise" — so dropping `VITE_GOOGLE_MAPS_API_KEY` into `.env`
 * turns the map real with no code change, and a judge's machine with no key and
 * no network still gets the exact demo it expects.
 *
 * The choice is remembered per device, and `?maps=live|sim` forces it for one
 * page load (used by the e2e runs and by anyone proving to themselves that a
 * key arrived).
 */

import { storage } from './storage';
import { appMode } from '@/config/env';

export type BasemapChoice = 'auto' | 'sim' | 'live';
export type ResolvedBasemap = 'sim' | 'live';

const STORAGE_KEY = 'mapBasemap';
const QUERY_KEYS = ['maps', 'basemap', 'map'];
const CHOICES: BasemapChoice[] = ['auto', 'sim', 'live'];

type Listener = () => void;
const listeners = new Set<Listener>();

function normalise(value: unknown): BasemapChoice | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'simulated' || trimmed === 'svg') return 'sim';
  if (trimmed === 'google' || trimmed === 'real') return 'live';
  return CHOICES.includes(trimmed as BasemapChoice) ? (trimmed as BasemapChoice) : null;
}

/** `?maps=live` wins over the saved device preference, for one page load. */
function readQueryPreference(): BasemapChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of QUERY_KEYS) {
      const found = normalise(params.get(key));
      if (found) return found;
    }
  } catch {
    /* a malformed query string must never break the app */
  }
  return null;
}

let forced: BasemapChoice | null = readQueryPreference();
let current: BasemapChoice = forced ?? normalise(storage.read<BasemapChoice>(STORAGE_KEY)) ?? 'auto';

export function subscribeBasemapPreference(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function readBasemapPreference(): BasemapChoice {
  return current;
}

/** The device preference, ignoring `?maps=` — shown in the debug panel. */
export function readSavedBasemapPreference(): BasemapChoice {
  return normalise(storage.read<BasemapChoice>(STORAGE_KEY)) ?? 'auto';
}

export function setBasemapPreference(next: BasemapChoice): void {
  if (forced) forced = null; // an explicit user action releases the URL override
  if (next === current) return;
  current = next;
  try {
    storage.write(STORAGE_KEY, next);
  } catch {
    /* a preference is not worth a toast; the in-memory value still applies */
  }
  emit();
}

export interface ResolvedBasemapState {
  basemap: ResolvedBasemap;
  /** Why this basemap, in one line — surfaced in the debug panel. */
  reason: string;
  /** True when a key exists but the user/pref chose the simulated map. */
  keyUnused: boolean;
}

export function resolveBasemap(choice: BasemapChoice, configured: boolean): ResolvedBasemapState {
  if (choice === 'sim') {
    return {
      basemap: 'sim',
      reason: configured ? 'Forced to the simulated map — a key is available but unused.' : 'Simulated map (no key).',
      keyUnused: configured,
    };
  }
  if (choice === 'live') {
    return configured
      ? { basemap: 'live', reason: 'Live Google tiles requested.', keyUnused: false }
      : {
          basemap: 'sim',
          reason: 'Live map requested but no usable key was found — falling back to the simulated map.',
          keyUnused: false,
        };
  }
  return configured
    ? { basemap: 'live', reason: 'Auto: a key was detected, so the live map is on.', keyUnused: false }
    : { basemap: 'sim', reason: 'Auto: no key detected, so the simulated map is on.', keyUnused: false };
}

/** `?maps=debug` (or `?mapsDebug=1`) opens the key panel on load. */
export function basemapDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mapsDebug')) return params.get('mapsDebug') !== '0';
    return params.get('maps') === 'debug';
  } catch {
    return false;
  }
}

export function basemapEnvironmentLabel(): string {
  return appMode();
}
