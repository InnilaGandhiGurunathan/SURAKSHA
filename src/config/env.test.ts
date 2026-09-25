/**
 * The env layer itself.
 *
 * The interesting property here is not parsing, it is the dev/prod asymmetry:
 * Vite injects a runtime `import.meta.env` object in dev but only rewrites
 * *literal* `import.meta.env.VITE_X` expressions in a production build. A
 * tidy-looking refactor of those literals into a loop over names compiles,
 * passes `npm run dev`, and then loses the key on Vercel — so the shape of the
 * source is part of the contract and is asserted as such.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STATIC_ENV_NAMES, appMode, envSnapshot, envVarNames, isDevBuild, readEnvVar } from './env';

const env = import.meta.env as unknown as Record<string, string | undefined>;
const pristine = { ...env };

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, pristine);
});

describe('envSnapshot', () => {
  it('includes values Vite injected, and never the whole object blindly', () => {
    env.VITE_PROBE = 'probe-value';
    const snapshot = envSnapshot();
    expect(snapshot.VITE_PROBE).toBe('probe-value');
    expect(typeof snapshot.MODE).toBe('string');
    expect(typeof snapshot.DEV).toBe('boolean');
  });

  it('hands the rest of the app only strings and booleans', () => {
    // Values that cannot be represented are dropped rather than coerced, so a
    // variable can never arrive as "[object Object]" and be sent to Google.
    for (const [name, value] of Object.entries(envSnapshot())) {
      expect(['string', 'boolean'], name).toContain(typeof value);
    }
  });

  it('lists only names, so the debug panel can never echo a secret', () => {
    env.VITE_PROBE = 'AIzaSuperSecretValue';
    const names = envVarNames();
    expect(names).toContain('VITE_PROBE');
    expect(names.join(' ')).not.toContain('AIzaSuperSecretValue');
  });

  it('distinguishes "declared but empty" from "never set"', () => {
    env.VITE_GOOGLE_MAPS_API_KEY = '';
    expect(readEnvVar('VITE_GOOGLE_MAPS_API_KEY')).toMatchObject({ declared: true, value: '' });
    expect(readEnvVar('VITE_NOT_A_REAL_VAR').declared).toBe(false);
  });

  it('knows which build it is in', () => {
    expect(appMode()).toBe('test');
    expect(isDevBuild()).toBe(true);
  });
});

describe('the build-time trap this module exists to avoid', () => {
  // Vitest's jsdom environment gives `import.meta.url` an http: origin, so the
  // source is resolved from the project root instead.
  const source = readFileSync(join(process.cwd(), 'src/config/env.ts'), 'utf8');

  it('reads every documented variable as a literal member access', () => {
    for (const name of STATIC_ENV_NAMES) {
      expect(source, `${name} must appear as import.meta.env.${name} or Vite cannot rewrite it`).toContain(
        `import.meta.env.${name}`,
      );
    }
  });

  it('keeps the reads inside a guard, because import.meta.env is absent outside Vite', () => {
    expect(source).toMatch(/function staticEnv\(\)[\s\S]*try \{[\s\S]*catch/);
  });
});
