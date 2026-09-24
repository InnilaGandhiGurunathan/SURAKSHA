import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config, supabaseEnabled, demoModeAllowed } from './config.js';
import { initStore, storeStats } from './store.js';
import { reportsRouter } from './routes/reports.js';
import { operationsRouter } from './routes/operations.js';
import { getSupabaseAdmin } from './supabase.js';

/**
 * SURAKSHA reporting server.
 *
 * One process serves three things:
 *  1. `/api/*` — the reporting + sync API used by the PWA and the public
 *     reporting website (they share this backend, which is what makes the
 *     30-second fallback dedupe correctly).
 *  2. `/report-site` and `/g/:token` — the public reporting website and the
 *     guardian dashboard routes of the built SPA.
 *  3. Everything else — the built PWA itself, so a single deployment serves the
 *     whole product.
 */

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: false,
  }),
);
app.use(express.json({ limit: '6mb' })); // allows small base64 photos in reports

// Basic request logging that never prints report bodies (privacy by default).
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[suraksha] ${req.method} ${req.path}`);
  }
  next();
});

/* --------------------------------- Health --------------------------------- */

app.get('/api/health', async (_req, res) => {
  let supabase: 'connected' | 'not-configured' | 'unreachable' = 'not-configured';
  const admin = getSupabaseAdmin();
  if (admin) {
    try {
      const { error } = await admin.from('profiles').select('id').limit(1);
      supabase = error ? 'unreachable' : 'connected';
    } catch {
      supabase = 'unreachable';
    }
  }

  res.json({
    ok: true,
    data: {
      ok: true,
      service: 'suraksha-reporting',
      version: config.version,
      time: new Date().toISOString(),
      supabase,
      store: storeStats(),
    },
  });
});

/* ---------------------------------- API ----------------------------------- */

app.use('/api', reportsRouter);
app.use('/api', operationsRouter);

app.get('/api/config/public', (_req, res) => {
  res.json({
    ok: true,
    data: {
      supabaseConfigured: supabaseEnabled,
      demoModeAllowed,
      localStorageOnly: !supabaseEnabled,
      fallbackReportUrl: config.fallbackReportUrl,
      reportAckTimeoutSeconds: config.reporting.ackTimeoutSeconds,
    },
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Unknown API endpoint.', code: 'not_found' });
});

/* ------------------------------ Static SPA -------------------------------- */

const webDist = config.webDistDir;
const indexFile = path.join(webDist, 'index.html');
const hasWebBuild = fs.existsSync(indexFile);

if (hasWebBuild) {
  app.use(
    express.static(webDist, {
      setHeaders(res, filePath) {
        // The service worker must never be served stale, or updates stall.
        if (filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
        if (filePath.endsWith('manifest.webmanifest')) {
          res.setHeader('Content-Type', 'application/manifest+json');
        }
      },
    }),
  );

  // SPA fallback for app routes and the public pages.
  app.get(['/', '/app/*', '/onboarding', '/auth', '/setup', '/g/*', '/report-site', '/offline.html'], (_req, res) => {
    res.sendFile(indexFile);
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send(
        [
          'SURAKSHA reporting server is running.',
          '',
          'The web application build was not found, so only the API is available.',
          'Build it first:  npm run build   (then restart this server)',
          'Or run the dev servers:  npm run dev',
          '',
          `Health: http://localhost:${config.port}/api/health`,
        ].join('\n'),
      );
  });
}

/* ------------------------------ Error handling ---------------------------- */

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[suraksha] unhandled error', error);
  res.status(500).json({
    ok: false,
    error: 'The reporting server hit an unexpected error.',
    detail: config.nodeEnv === 'production' ? undefined : error.message,
  });
});

/* ---------------------------------- Boot ---------------------------------- */

async function start() {
  await initStore();

  app.listen(config.port, config.host, () => {
    console.log('');
    console.log('  ███████╗██╗   ██╗██████╗  █████╗ ██╗  ██╗███████╗██╗  ██╗ █████╗ ');
    console.log('  ██╔════╝██║   ██║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝██║  ██║██╔══██╗');
    console.log('  ███████╗██║   ██║██████╔╝███████║█████╔╝ ███████╗███████║███████║');
    console.log('  ╚════██║██║   ██║██╔══██╗██╔══██║██╔═██╗ ╚════██║██╔══██║██╔══██║');
    console.log('  ███████║╚██████╔╝██║  ██║██║  ██║██║  ██╗███████║██║  ██║██║  ██║');
    console.log('  ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝');
    console.log('');
    console.log(`  Your Safety, Our Priority — reporting server v${config.version}`);
    console.log(`  Listening on      http://${config.host}:${config.port}`);
    console.log(`  Health endpoint   http://localhost:${config.port}/api/health`);
    console.log(`  Supabase          ${supabaseEnabled ? 'mirroring enabled' : 'not configured (local JSON store)'}`);
    console.log(`  Web build         ${hasWebBuild ? webDist : 'not found — API only'}`);
    console.log('');
    console.log('  Note: SURAKSHA is a safety aid. It cannot guarantee rescue, and it never');
    console.log('  dials emergency services automatically.');
    console.log('');
  });
}

start().catch((error) => {
  console.error('[suraksha] failed to start', error);
  process.exit(1);
});
