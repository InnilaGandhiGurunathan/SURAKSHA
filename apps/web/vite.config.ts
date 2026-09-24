import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * SURAKSHA web build.
 *
 * Offline-first is the architectural priority, so this config does three
 * important things:
 *  1. `injectManifest` lets `src/sw.ts` own the workbox strategy (precache the
 *     whole app shell, cache map tiles and geocode responses, keep the sync
 *     queue alive across reloads);
 *  2. the manifest declares the installable PWA with an offline-ready start URL;
 *  3. `devOptions` keeps the service worker testable during development.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      devOptions: { enabled: false, type: 'module' },
      includeAssets: ['offline.html', 'icons/*.png', 'icons/*.svg', 'screenshots/*.png'],
      manifest: {
        id: '/?source=pwa',
        name: 'SURAKSHA — Your Safety, Our Priority',
        short_name: 'SURAKSHA',
        description:
          'Proactive personal safety for solo travellers. Works fully offline: journey monitoring, checkpoints, on-device risk heuristics, SOS and incident reporting.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        background_color: '#0A1F44',
        theme_color: '#0A1F44',
        categories: ['safety', 'travel', 'utilities', 'navigation'],
        prefer_related_applications: false,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/logo.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'Emergency SOS', short_name: 'SOS', url: '/app/sos', description: 'Open the SOS screen immediately' },
          { name: 'Report an incident', short_name: 'Report', url: '/app/report/new', description: 'File an incident report' },
          { name: 'Start a journey', short_name: 'Journey', url: '/app/journeys/new', description: 'Plan and monitor a journey' },
        ],
        screenshots: [
          {
            src: '/screenshots/home-mobile.png',
            sizes: '720x1560',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Safety dashboard with GPS, connectivity and SOS',
          },
          {
            src: '/screenshots/home-desktop.png',
            sizes: '1440x900',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Journey monitoring on a larger screen',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Navigation fallback and the /api deny-list live in `src/sw.ts`: this is
        // an injectManifest build, so the worker decides what to do when a
        // navigation request fails (it serves the cached shell, then offline.html).
      },
    }),
  ],
  resolve: {
    // `@` is matched exactly (ordered array form), so nothing else is hijacked.
    // Leaflet itself is intentionally *not* aliased: its published entry is the
    // UMD bundle, which Vite and Rollup already interop for both dev and build.
    alias: [{ find: /^@\//, replacement: `${path.resolve(here, './src')}/` }],
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      // The dev server never talks to itself: relative /api calls are proxied to
      // the reporting server, so the same code path works in dev and production.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/g': { target: 'http://127.0.0.1:8787', changeOrigin: true, bypass: (req) => (req.url && req.url.includes('.') ? req.url : undefined) },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          maps: ['leaflet', 'react-leaflet'],
          db: ['dexie', 'dexie-react-hooks'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  css: {
    devSourcemap: true,
  },
});
