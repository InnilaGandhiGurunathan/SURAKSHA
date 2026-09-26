/**
 * The host lookup behind /api/maps-config.
 *
 * This is the bug: the variable is saved in Vercel, but Vite never inlined it,
 * so the website has to read whatever the host process can see *now* — including
 * a name without the VITE_ prefix, and a value pasted with quotes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAPS_CONFIG_PATH, normalizeMapsCredential, readMapsConfigFromEnv } from './mapsHostEnv';
import handler from '../../api/maps-config';

const KEY = `AIza${'k'.repeat(35)}`;

describe('readMapsConfigFromEnv', () => {
  it('prefers the documented VITE_ name', () => {
    const config = readMapsConfigFromEnv({
      VITE_GOOGLE_MAPS_API_KEY: KEY,
      GOOGLE_MAPS_API_KEY: `AIza${'z'.repeat(35)}`,
    });
    expect(config).toMatchObject({ key: KEY, envName: 'VITE_GOOGLE_MAPS_API_KEY' });
  });

  it('falls through an empty VITE_ slot to the unprefixed name Vercel often stores', () => {
    const config = readMapsConfigFromEnv({
      VITE_GOOGLE_MAPS_API_KEY: '   ',
      GOOGLE_MAPS_API_KEY: `"${KEY}"`,
    });
    expect(config.key).toBe(KEY);
    expect(config.envName).toBe('GOOGLE_MAPS_API_KEY');
  });

  it('does not echo any other environment variable', () => {
    const config = readMapsConfigFromEnv({
      VITE_GOOGLE_MAPS_API_KEY: KEY,
      VITE_SUPABASE_ANON_KEY: 'service-role-must-not-leak',
      DATABASE_URL: 'postgres://secret',
    });
    expect(JSON.stringify(config)).not.toContain('service-role-must-not-leak');
    expect(JSON.stringify(config)).not.toContain('postgres');
    expect(Object.keys(config).sort()).toEqual(['envName', 'key', 'mapId', 'mapIdEnvName']);
  });

  it('returns nulls rather than empty strings when nothing is set', () => {
    expect(readMapsConfigFromEnv({})).toEqual({
      key: null,
      mapId: null,
      envName: null,
      mapIdEnvName: null,
    });
  });
});

describe('normalizeMapsCredential', () => {
  it('strips wrapping quotes and surrounding whitespace, and nothing else', () => {
    expect(normalizeMapsCredential(`  "${KEY}"\n`)).toBe(KEY);
    expect(normalizeMapsCredential(`'${KEY}'`)).toBe(KEY);
    expect(normalizeMapsCredential('')).toBeNull();
    expect(normalizeMapsCredential(undefined)).toBeNull();
  });
});

describe('GET /api/maps-config', () => {
  it('writes the live process env as JSON and does not cache it', () => {
    const previous = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = KEY;
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;

    const headers = new Map<string, string>();
    let body = '';
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end(chunk = '') {
        body = chunk;
      },
    };

    handler({ method: 'GET' } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.get('Content-Type')).toContain('application/json');
    expect(JSON.parse(body)).toMatchObject({ key: KEY, envName: 'GOOGLE_MAPS_API_KEY' });

    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  });
});

describe('the wiring that makes the dashboard value show up', () => {
  it('starts the runtime fetch in index.html and does not rewrite /api to the SPA', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const vercel = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
    expect(html).toContain(MAPS_CONFIG_PATH);
    expect(html).toContain('__SURAKSHA_MAPS_CONFIG_PROMISE__');
    expect(vercel).not.toContain('"source": "/(.*)"');
    expect(vercel).toContain('(?!api/)');
  });
});
