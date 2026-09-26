import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { MAPS_CONFIG_PATH, readMapsConfigFromEnv, type EnvLike } from './api/mapsHostEnv';

/**
 * Serve `/api/maps-config` in `vite dev` and `vite preview` the same way the
 * Vercel function does in production. Preview is the interesting case: the
 * bundle was already built, so a key that exists only in the process
 * environment has to come from this response or the map stays simulated.
 */
function mapsConfigEndpoint(mode: string): Plugin {
  const respond = (
    req: { url?: string; method?: string },
    res: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void },
    next: () => void,
  ) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== MAPS_CONFIG_PATH) return next();
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Cache-Control', 'no-store');
      res.end('');
      return;
    }
    // Files first, then the live process env, so a variable exported in the
    // shell (what Vercel injects) beats a stale empty line in `.env`.
    const fromFiles = loadEnv(mode, process.cwd(), '') as EnvLike;
    const body = JSON.stringify(readMapsConfigFromEnv({ ...fromFiles, ...process.env }));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? '' : body);
  };

  return {
    name: 'suraksha-maps-config',
    configureServer(server) {
      server.middlewares.use(respond);
    },
    configurePreviewServer(server) {
      server.middlewares.use(respond);
    },
  };
}

// SURAKSHA dev server config.
// host: true            -> binds 0.0.0.0 so the sandbox live-preview proxy can reach it
// allowedHosts: true     -> the preview is served from a proxied *.e2b.app host
export default defineConfig(({ mode }) => {
  const fromFiles = loadEnv(mode, process.cwd(), '') as EnvLike;
  const host = readMapsConfigFromEnv({ ...fromFiles, ...process.env });
  // Explicit define so a key that Vercel exposed under a non-VITE_ name (or
  // only via process.env) is still inlined when the build *can* see it.
  // Absent values are left to Vite — defining "" would hide a later runtime key
  // behind a declared-but-blank slot only if we preferred env over runtime,
  // and we don't, but an empty define is still noise.
  const define: Record<string, string> = {};
  if (host.key) define['import.meta.env.VITE_GOOGLE_MAPS_API_KEY'] = JSON.stringify(host.key);
  if (host.mapId) define['import.meta.env.VITE_GOOGLE_MAPS_MAP_ID'] = JSON.stringify(host.mapId);

  return {
    plugins: [react(), mapsConfigEndpoint(mode)],
    define,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: true,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      allowedHosts: true,
    },
  };
});
