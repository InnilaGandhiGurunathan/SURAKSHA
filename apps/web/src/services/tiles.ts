import { appEnv } from '@/lib/env';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import type { GeoPoint, OfflineMapPack } from '@suraksha/shared';
import { MAX_OFFLINE_TILE_ZOOM, MIN_OFFLINE_TILE_ZOOM, boundingBox, expandBounds } from '@suraksha/shared';

/**
 * Offline map tiles.
 *
 * The map is a safety aid, so "no tiles" must never look like "no map data".
 * Tiles are fetched into the Cache API keyed by URL, and the pack record in
 * IndexedDB tracks how much of the corridor actually arrived, so the UI can say
 * "partially downloaded" instead of claiming offline maps are ready.
 *
 * Tiles come from whatever host is configured (`VITE_TILE_URL_TEMPLATE`). The
 * default is the public OpenStreetMap server, which is fine for development and
 * demonstrations but must not be used for bulk downloading in production — the
 * settings screen says so explicitly.
 */

export const TILE_CACHE_NAME = 'suraksha-tiles-v1';

export function tileUrl(z: number, x: number, y: number): string {
  return appEnv.tileUrlTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{s}', 'a');
}

export function lonToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

export function latToTileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

export interface TilePackPlan {
  bounds: [[number, number], [number, number]];
  zooms: number[];
  tiles: Array<{ z: number; x: number; y: number; url: string }>;
}

/**
 * Plans the tiles for a journey corridor. Radius is in kilometres, zooms are
 * limited to 11–16: enough to follow a route, not enough to hammer a public tile
 * server or fill the device.
 */
export function planTilePack(input: {
  origin: GeoPoint;
  destination: GeoPoint;
  radiusKm?: number;
  minZoom?: number;
  maxZoom?: number;
  paddingPoints?: GeoPoint[];
}): TilePackPlan {
  const radiusKm = input.radiusKm ?? 3.5;
  const minZoom = input.minZoom ?? MIN_OFFLINE_TILE_ZOOM;
  const maxZoom = Math.min(input.maxZoom ?? MAX_OFFLINE_TILE_ZOOM, MAX_OFFLINE_TILE_ZOOM);

  const base = boundingBox([input.origin, input.destination, ...(input.paddingPoints ?? [])], 0.005);
  const bounds = expandBounds(base, radiusKm);

  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const tiles: TilePackPlan['tiles'] = [];
  const zooms: number[] = [];

  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    zooms.push(zoom);
    const xMin = lonToTileX(minLng, zoom);
    const xMax = lonToTileX(maxLng, zoom);
    const yMin = latToTileY(maxLat, zoom);
    const yMax = latToTileY(minLat, zoom);

    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        tiles.push({ z: zoom, x, y, url: tileUrl(zoom, x, y) });
      }
    }
  }

  return { bounds, zooms, tiles };
}

export interface DownloadProgress {
  stored: number;
  requested: number;
  bytes: number;
  status: OfflineMapPack['status'];
  message: string;
}

export async function downloadTilePack(input: {
  journeyId: string;
  ownerId: string;
  label: string;
  origin: GeoPoint;
  destination: GeoPoint;
  paddingPoints?: GeoPoint[];
  radiusKm?: number;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<OfflineMapPack> {
  const plan = planTilePack(input);
  const now = new Date().toISOString();

  const pack: OfflineMapPack = {
    id: uuid(),
    journeyId: input.journeyId,
    ownerId: input.ownerId,
    label: input.label,
    bounds: plan.bounds,
    minZoom: Math.min(...plan.zooms),
    maxZoom: Math.max(...plan.zooms),
    tilesRequested: plan.tiles.length,
    tilesStored: 0,
    bytes: 0,
    status: 'downloading',
    progress: 0,
    attribution: appEnv.tileAttribution,
    tileUrlTemplate: appEnv.tileUrlTemplate,
    createdAt: now,
  };

  await db.mapPacks.put(pack);

  if (!('caches' in window)) {
    const failed: OfflineMapPack = {
      ...pack,
      status: 'failed',
      error: 'This browser has no Cache Storage, so tiles cannot be stored for offline use.',
    };
    await db.mapPacks.put(failed);
    return failed;
  }

  const cache = await caches.open(TILE_CACHE_NAME);
  let stored = 0;
  let bytes = 0;

  // Sequential with small concurrency: gentle on the tile host and easy to abort.
  const concurrency = 4;
  let index = 0;

  const worker = async () => {
    while (index < plan.tiles.length) {
      if (input.signal?.aborted) return;
      const tile = plan.tiles[index];
      index += 1;
      try {
        const existing = await cache.match(tile.url);
        if (existing) {
          stored += 1;
          const length = Number(existing.headers.get('content-length') ?? 0);
          bytes += Number.isFinite(length) ? length : 12_000;
        } else {
          const response = await fetch(tile.url, { mode: 'cors', credentials: 'omit' });
          if (!response.ok) continue;
          const clone = response.clone();
          await cache.put(tile.url, clone);
          stored += 1;
          const length = Number(response.headers.get('content-length') ?? 0);
          bytes += Number.isFinite(length) && length > 0 ? length : 12_000;
        }
      } catch {
        // A single missing tile is not a failure: coverage is reported honestly.
      }

      if (stored % 12 === 0) {
        input.onProgress?.({
          stored,
          requested: plan.tiles.length,
          bytes,
          status: 'downloading',
          message: `Stored ${stored} of ${plan.tiles.length} tiles…`,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const aborted = input.signal?.aborted ?? false;
  const ratio = plan.tiles.length === 0 ? 0 : stored / plan.tiles.length;

  const finished: OfflineMapPack = {
    ...pack,
    tilesStored: stored,
    bytes,
    progress: Math.round(ratio * 100) / 100,
    status: aborted ? 'partial' : ratio >= 0.95 ? 'ready' : ratio > 0 ? 'partial' : 'failed',
    completedAt: new Date().toISOString(),
    error: aborted
      ? 'Download stopped early — the tiles stored so far are still available offline.'
      : ratio < 0.95
        ? `${plan.tiles.length - stored} tile(s) could not be downloaded. The corridor is partly covered.`
        : undefined,
  };

  await db.mapPacks.put(finished);
  input.onProgress?.({
    stored,
    requested: plan.tiles.length,
    bytes,
    status: finished.status,
    message:
      finished.status === 'ready'
        ? 'Offline map pack ready for this journey.'
        : `Offline map pack is ${finished.status} (${stored}/${plan.tiles.length} tiles).`,
  });

  return finished;
}

export async function listMapPacks(ownerId: string): Promise<OfflineMapPack[]> {
  const rows = await db.mapPacks.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function mapPackFor(journeyId: string): Promise<OfflineMapPack | undefined> {
  return db.mapPacks.where('journeyId').equals(journeyId).first();
}

export async function tileCacheStats(): Promise<{ tiles: number; bytes: number; caches: string[] }> {
  if (!('caches' in window)) return { tiles: 0, bytes: 0, caches: [] };
  try {
    const names = await caches.keys();
    let tiles = 0;
    let bytes = 0;
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      tiles += requests.length;
      for (const request of requests.slice(0, 400)) {
        const response = await cache.match(request);
        const length = Number(response?.headers.get('content-length') ?? 0);
        bytes += Number.isFinite(length) && length > 0 ? length : 12_000;
      }
    }
    return { tiles, bytes, caches: names };
  } catch {
    return { tiles: 0, bytes: 0, caches: [] };
  }
}

export async function clearTileCache(): Promise<number> {
  if (!('caches' in window)) return 0;
  const names = await caches.keys();
  let removed = 0;
  for (const name of names) {
    if (name.startsWith('suraksha-tiles')) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      removed += keys.length;
      await caches.delete(name);
    }
  }
  await db.mapPacks.clear();
  return removed;
}

/** Message the service worker to drop only the tile cache. */
export async function requestServiceWorkerTileClear(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    registration?.active?.postMessage({ type: 'SURAKSHA_CLEAR_TILES' });
    return Boolean(registration?.active);
  } catch {
    return false;
  }
}

export function offlineTileNote(): string {
  return appEnv.tileUrlTemplate.includes('openstreetmap')
    ? 'Tiles are downloaded from the public OpenStreetMap server for this corridor. For a production deployment, point VITE_TILE_URL_TEMPLATE at your own tile host before bulk downloading.'
    : 'Tiles are downloaded from the tile host configured for this deployment.';
}
