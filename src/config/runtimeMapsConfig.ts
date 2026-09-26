/**
 * Pull the host's current Maps key into the page.
 *
 * `index.html` starts the request before the bundle downloads (so a cold
 * Vercel function overlaps with JS download). Boot awaits it, with a timeout,
 * and a late response still updates the map — a missing build-time key must
 * not stick as "no key" once Vercel has answered.
 */

import { MAPS_CONFIG_PATH, normalizeMapsCredential, type MapsHostConfig } from './mapsHostEnv';
import { setRuntimeMapsConfig } from './googleMaps';
import { notifyGoogleMapsConfigChanged } from '@/services/googleMapsApi';

export const RUNTIME_MAPS_CONFIG_PROMISE = '__SURAKSHA_MAPS_CONFIG_PROMISE__';

/** How long boot will wait before painting. The request keeps running after this. */
export const RUNTIME_MAPS_CONFIG_WAIT_MS = 4000;

function isConfig(value: unknown): value is Partial<MapsHostConfig> {
  return Boolean(value) && typeof value === 'object';
}

async function readResponse(response: Response): Promise<unknown> {
  const type = (response.headers.get('content-type') || '').toLowerCase();
  // The SPA rewrite returns index.html for unknown paths. That is not a key.
  if (!response.ok || type.includes('text/html') || !type.includes('json')) return null;
  return response.json();
}

function startFetch(): Promise<unknown> {
  return fetch(MAPS_CONFIG_PATH, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
    .then(readResponse)
    .catch(() => null);
}

/** The in-flight request, reusing the one `index.html` already started. */
export function runtimeMapsConfigPromise(): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const host = window as unknown as Record<string, unknown>;
  const existing = host[RUNTIME_MAPS_CONFIG_PROMISE];
  if (existing && typeof (existing as Promise<unknown>).then === 'function') {
    return existing as Promise<unknown>;
  }
  const promise = startFetch();
  host[RUNTIME_MAPS_CONFIG_PROMISE] = promise;
  return promise;
}

export function applyRuntimeMapsConfig(raw: unknown): boolean {
  if (!isConfig(raw)) return false;
  const key = normalizeMapsCredential(raw.key);
  const mapId = normalizeMapsCredential(raw.mapId);
  const envName = typeof raw.envName === 'string' && raw.envName.trim() ? raw.envName.trim() : null;
  const mapIdEnvName = typeof raw.mapIdEnvName === 'string' && raw.mapIdEnvName.trim() ? raw.mapIdEnvName.trim() : null;
  // A null key must not erase a key already applied from an earlier response.
  if (!key && !mapId) return false;
  setRuntimeMapsConfig({
    key,
    mapId,
    envName,
    mapIdEnvName,
  });
  notifyGoogleMapsConfigChanged();
  return true;
}

/** Resolve the host config and publish it. Never throws. */
export async function hydrateRuntimeMapsConfig(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  try {
    const body = await runtimeMapsConfigPromise();
    return applyRuntimeMapsConfig(body);
  } catch {
    return false;
  }
}
