#!/usr/bin/env node
/**
 * npm run maps:check — "did my Google Maps key actually get added?"
 *
 * Checks the exact things that go wrong in the browser: the file Vite will read
 * (.env, .env.local, .env.development… in Vite's own precedence order), the
 * VITE_ prefix, quoting, a placeholder that was never replaced, a truncated
 * paste, and whether the file is git-ignored so the key does not get committed.
 *
 * Exit code: 0 when a usable key is found, 1 when it is missing or malformed,
 * 2 for `--help`. Nothing prints a full key; only the mask.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VAR = 'VITE_GOOGLE_MAPS_API_KEY';
const ALIASES = ['VITE_GOOGLE_MAPS_KEY', 'VITE_GOOGLE_MAPS_KEY_ID'];
const MAP_ID_VARS = ['VITE_GOOGLE_MAPS_MAP_ID', 'VITE_GOOGLE_MAPS_ID'];
const NEAR_MISSES = ['GOOGLE_MAPS_API_KEY', 'REACT_APP_GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'GOOGLE_API_KEY'];

const MODE = process.env.NODE_ENV === 'production' ? 'production' : 'development';

/** Vite precedence, weakest first; the last file that has the var wins. */
const FILES = [`.env`, `.env.${MODE}`, `.env.local`, `.env.${MODE}.local`];

const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

const colour = (code, text) => (process.stdout.isTTY ? `${code}${text}${RESET}` : text);
const ok = (text) => colour(GREEN, `✅ ${text}`);
const warn = (text) => colour(YELLOW, `⚠️  ${text}`);
const bad = (text) => colour(RED, `❌ ${text}`);
const note = (text) => colour(DIM, `   ${text}`);

function mask(value) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…`;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function stripInlineComment(raw) {
  const trimmed = raw.trim();
  if (/^(['"]).*\1$/s.test(trimmed)) return trimmed.slice(1, -1);
  const hash = raw.search(/\s#/);
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/** Minimal dotenv reader: `NAME=value`, optional `export`, `#` comments. */
function parseEnv(file) {
  const result = new Map();
  if (!existsSync(file)) return result;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1].startsWith('#')) return;
    if (line.trim().startsWith('#')) return;
    result.set(match[1], { value: stripInlineComment(match[2]), line: index + 1, raw: match[2] });
  });
  return result;
}

function inspect(key) {
  const problems = [];
  if (!key) return { usable: false, problems: ['not set'] };
  if (/^\s*$/.test(key)) return { usable: false, problems: ['empty — the file has the name but no value'] };
  if (/^(your|paste|put|insert|replace|todo|xxx)/i.test(key) || /placeholder|example\.com|changeme/i.test(key)) {
    problems.push('looks like an unreplaced placeholder');
  }
  if (/\s/.test(key.trim())) problems.push('contains whitespace — keys never do');
  if (key.trim().length !== 39) problems.push(`${key.trim().length} chars, expected 39`);
  if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(key.trim())) problems.push("does not start with 'AIza'");
  const unquotedWithSpace = /^[^\s]+ .*$/.test(key.trim());
  if (unquotedWithSpace) problems.push('wrap the value in quotes in the .env file');
  return { usable: problems.length === 0 && /^AIza[0-9A-Za-z_-]{35}$/.test(key.trim()), problems };
}

function isIgnored(file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const root = process.cwd();
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      `npm run maps:check — is ${VAR} reaching the app?`,
      '',
      `Looks at ${FILES.join(', ')} (Vite precedence, strongest last), plus the shell`,
      'environment, then reports the source, the mask and the shape of the key.',
      '',
      '  --json      machine-readable output',
      '  --quiet     only the verdict line',
      '  --env <f>   read one specific file instead of the defaults',
      '',
      'Exit codes: 0 usable key · 1 missing/malformed · 2 help',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

const json = args.includes('--json');
const quiet = args.includes('--quiet');
const onlyIndex = args.indexOf('--env');
const candidates = onlyIndex !== -1 && args[onlyIndex + 1] ? [path.resolve(root, args[onlyIndex + 1])] : FILES;

/** Weakest → strongest, so later entries override earlier ones like Vite does. */
const layers = candidates
  .map((file) => ({ file: path.resolve(root, file), entries: parseEnv(path.resolve(root, file)) }))
  .filter((layer) => layer.entries.size > 0);
layers.push({ file: 'process.env', entries: readProcessEnv() });

function readProcessEnv() {
  const entries = new Map();
  for (const name of [VAR, ...ALIASES, ...MAP_ID_VARS, ...NEAR_MISSES]) {
    const value = process.env[name];
    if (typeof value === 'string') entries.set(name, { value, line: 0, raw: value });
  }
  return entries;
}

function lookup(name) {
  let found = null;
  for (const layer of layers) {
    const entry = layer.entries.get(name);
    if (entry && entry.value !== '') found = { ...entry, file: layer.file };
  }
  return found;
}

const allEntries = new Map();
for (const layer of layers) for (const [name, entry] of layer.entries) allEntries.set(name, { ...entry, file: layer.file });

const primary = lookup(VAR) ?? ALIASES.map(lookup).find(Boolean) ?? null;
const mapId = MAP_ID_VARS.map(lookup).find(Boolean) ?? null;
const verdict = inspect(primary?.value);

const report = {
  variable: VAR,
  mode: MODE,
  filesSeen: candidates.map((file) => ({
    file,
    exists: existsSync(path.resolve(root, file)),
    ignored: isIgnored(path.resolve(root, file)),
  })),
  found: Boolean(primary),
  source: primary ? `${primary.file}${primary.line ? `:${primary.line}` : ''}` : null,
  maskedKey: primary ? mask(primary.value) : null,
  length: primary ? primary.value.trim().length : 0,
  usable: verdict.usable,
  problems: verdict.problems,
  mapId: mapId ? { source: `${mapId.file}${mapId.line ? `:${mapId.line}` : ''}`, value: mapId.value } : null,
  otherVars: [...allEntries.keys()].filter((name) => name.startsWith('VITE_')),
  nearMisses: NEAR_MISSES.filter((name) => allEntries.has(name)),
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.usable ? 0 : 1);
}

const say = (...lines) => {
  if (!quiet) process.stdout.write(`${lines.join('\n')}\n`);
};

process.stdout.write(`${colour(BOLD, `SURAKSHA · ${VAR}`)}\n`);
say(
  note(`mode ${MODE} · looking in ${candidates.join(', ')} then the shell environment`),
  '',
);

for (const file of report.filesSeen) {
  say(
    file.exists
      ? file.ignored
        ? `   ✅ ${file.file}  ${colour(DIM, '(exists, git-ignored — good)')}`
        : `   ⚠️  ${file.file}  ${colour(DIM, '(exists but is NOT git-ignored)')}`
      : `   ·  ${file.file}  ${colour(DIM, '(absent)')}`,
  );
}
say('');

if (!primary) {
  process.stdout.write(
    `${bad(`${VAR} is not set anywhere — the map is using the simulated basemap.`)}\n`,
  );
  if (!quiet) {
    if (report.nearMisses.length) {
      process.stdout.write(
        `${warn(`Found ${report.nearMisses.join(', ')} instead. Vite only exposes VITE_* names to browser code.`)}\n`,
      );
      process.stdout.write(`${warn(`Rename it to ${VAR} (keep the same value).`)}\n`);
    }
    process.stdout.write(
      [
        '',
        '   Fix:',
        `     1. cp .env.example .env  ${colour(DIM, '(or create .env in the repo root)')}`,
        `     2. write ${VAR}="AIza…"`,
        '     3. restart the dev server — Vite bakes env values in at build time',
        '     4. npm run maps:check   (again)',
        '',
        `   Or skip .env while testing: open the app, click the map's "Maps key?"`,
        `   badge, and paste the key there. That stores it in sessionStorage for`,
        `   this tab only and the map reloads immediately.`,
        '',
      ].join('\n'),
    );
  }
  process.exit(1);
}

say(
  report.usable
    ? ok(`${VAR} = ${mask(primary.value)}  ${colour(DIM, `(${report.length} chars)`)}`)
    : warn(`${VAR} = ${mask(primary.value)} — found, but suspicious`),
);
say(note(`source: ${report.source}`));
if (!verdict.usable && verdict.problems.length) {
  for (const problem of verdict.problems) process.stdout.write(`   ${colour(YELLOW, '•')} ${problem}\n`);
}
if (mapId) say(note(`map id: ${mapId.value} ${colour(DIM, `(from ${mapId.file})`)}`));
if (report.otherVars.length) say(note(`VITE_ vars present: ${report.otherVars.join(', ')}`));
if (!report.filesSeen.some((file) => file.file.endsWith('.env') && file.ignored) && existsSync(path.resolve(root, '.env'))) {
  process.stdout.write(`${warn('.env exists but is not git-ignored — add it to .gitignore before committing a real key.')}\n`);
}
say('');
if (!quiet) {
  say(
    report.usable
      ? note('Restart the dev server after editing .env. In the browser the map badge should read "Live map ready".')
      : note('The key is present but the shape is wrong; fix it before blaming Google for a grey map.'),
  );
}
process.exit(report.usable ? 0 : 1);
