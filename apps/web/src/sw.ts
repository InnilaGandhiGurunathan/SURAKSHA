/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

/**
 * SURAKSHA service worker.
 *
 * Offline-first means the worker owns more than a cache: it keeps the app shell
 * available, stores map tiles for the journey corridor, serves the geocoder
 * opportunistically, and relays sync requests from the OS back into the app.
 *
 * Deliberate choices:
 *  - **`/api/` is NetworkOnly.** Delivery state is never faked from a cache. The
 *    app's own IndexedDB outbox is the retry mechanism, because it knows the
 *    semantics of each request (an SOS is not a telemetry ping).
 *  - **Tiles are CacheFirst**, so a downloaded corridor is served instantly and
 *    works with no signal. The cache name matches `services/tiles.ts`.
 *  - **Navigations fall back to the cached shell**, then to `offline.html`, which
 *    is a branded page that explains what still works.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const PRECACHE = self.__WB_MANIFEST ?? [];
const APP_SHELL_URL = '/index.html';
const OFFLINE_URL = '/offline.html';
const TILE_CACHE = 'suraksha-tiles-v1';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute([...PRECACHE, { url: OFFLINE_URL, revision: null }]);

/* ------------------------------- Navigations ------------------------------- */

const navigationHandler = createHandlerBoundToURL(APP_SHELL_URL);
registerRoute(
  new NavigationRoute(async (params) => {
    try {
      return await navigationHandler(params);
    } catch {
      const cache = await caches.open('workbox-precache-v2');
      const fallback = await cache.match(OFFLINE_URL);
      return fallback ?? Response.error();
    }
  }, {
    // Let the public reporting website and the API go straight to the network
    // first: a stale report form is worse than a slow one.
    denylist: [/^\/api\//, /^\/report-site/, /^\/g\//],
  }),
);

/* ------------------------------- API traffic ------------------------------ */

registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

/* -------------------------------- Map tiles ------------------------------- */

registerRoute(
  ({ url }) =>
    /\.(png|jpg|jpeg|webp)$/.test(url.pathname) &&
    (url.pathname.includes('/tile') || /\/(\d+)\/(\d+)\/(\d+)\.(png|jpg|webp)$/.test(url.pathname) || url.hostname.includes('tile')),
  new CacheFirst({
    cacheName: TILE_CACHE,
    plugins: [
      new ExpirationPlugin({ maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 45, purgeOnQuotaError: true }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

/* ------------------------------ Geocoding -------------------------------- */

registerRoute(
  ({ url }) => url.hostname === 'nominatim.openstreetmap.org',
  new StaleWhileRevalidate({
    cacheName: 'suraksha-geocode-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

/* ------------------------------ Static assets ---------------------------- */

registerRoute(
  ({ request, url }) =>
    ['style', 'script', 'worker', 'font'].includes(request.destination) &&
    url.origin === self.location.origin,
  new NetworkFirst({ cacheName: 'suraksha-assets-v1', networkTimeoutSeconds: 5 }),
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'suraksha-images-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 })],
  }),
);

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const cache = await caches.open('workbox-precache-v2');
    const fallback = await cache.match(OFFLINE_URL);
    if (fallback) return fallback;
  }
  return Response.error();
});

/* --------------------------------- Messages ------------------------------- */

interface PrecacheRequest {
  type: 'SURAKSHA_PRECACHE' | 'SURAKSHA_CLEAR_TILES' | 'SURAKSHA_RUN_SYNC' | 'SKIP_WAITING';
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as PrecacheRequest | undefined;
  if (!data?.type) return;

  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  if (data.type === 'SURAKSHA_CLEAR_TILES') {
    event.waitUntil(caches.delete(TILE_CACHE));
    return;
  }

  if (data.type === 'SURAKSHA_PRECACHE') {
    event.waitUntil(
      (async () => {
        // The injected manifest is already precached at install time; this
        // verifies it and reports a real count back to the app so the offline
        // screen can say exactly how much is stored.
        const cache = await caches.open('workbox-precache-v2');
        const keys = await cache.keys();
        const port = event.ports?.[0];
        port?.postMessage({ type: 'SURAKSHA_PRECACHED', cached: keys.length });
      })(),
    );
    return;
  }

  if (data.type === 'SURAKSHA_RUN_SYNC') {
    event.waitUntil(
      (async () => {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
          client.postMessage({ type: 'SURAKSHA_RUN_SYNC', reason: 'worker' });
        }
      })(),
    );
  }
});

/* ------------------------------ Background sync --------------------------- */

self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag !== 'suraksha-outbox' && syncEvent.tag !== 'suraksha-periodic-sync') return;

  syncEvent.waitUntil(
    (async () => {
      // Wake every open client: the outbox lives in IndexedDB and is drained by
      // the app, which knows the priority and semantics of each queued item.
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windowClients.length === 0) {
        await self.registration.showNotification('SURAKSHA has queued items', {
          body: 'Something is waiting to sync (a report or journey update). Open SURAKSHA to send it.',
          icon: '/icons/icon-192.png',
          tag: 'suraksha-outbox-waiting',
          data: { url: '/app/report' },
        });
        return;
      }
      for (const client of windowClients) {
        client.postMessage({ type: 'SURAKSHA_RUN_SYNC', reason: 'background' });
      }
    })(),
  );
});

self.addEventListener('periodicsync', (event) => {
  const periodic = event as ExtendableEvent & { tag: string };
  if (periodic.tag !== 'suraksha-periodic-sync') return;
  periodic.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage({ type: 'SURAKSHA_RUN_SYNC', reason: 'periodic' });
      }
    })(),
  );
});

/* ------------------------------- Notifications ---------------------------- */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/app/notifications';

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'SURAKSHA_NAVIGATE', url: target });
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string; critical?: boolean };
    } catch {
      return { body: event.data?.text() };
    }
  })();

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'SURAKSHA', {
      body:
        payload.body ??
        'You have a SURAKSHA notification. Open the app to see what needs your attention.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'suraksha-push',
      requireInteraction: Boolean(payload.critical),
      data: { url: payload.url ?? '/app/notifications' },
    }),
  );
});
