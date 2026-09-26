/**
 * Runtime Google Maps config for the deployed site.
 *
 * Vite bakes `import.meta.env.VITE_*` into the bundle at build time, so a key
 * that is present in Vercel but was not visible to that build never reaches
 * the browser. This function reads the host environment on each request —
 * including Sensitive variables, which Vercel injects at runtime — and returns
 * only the public Maps key. The page applies it before drawing the map.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readMapsConfigFromEnv } from './mapsHostEnv';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Cache-Control', 'no-store');
    res.end('');
    return;
  }

  const body = JSON.stringify(readMapsConfigFromEnv(process.env));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end('');
    return;
  }
  res.end(body);
}
