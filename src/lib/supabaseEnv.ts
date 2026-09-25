/**
 * How Vite-exposed env vars are read, behind accessor functions the rest of
 * the app can mock or replace. Kept tiny so the services stay testable.
 */

export function pickRawString(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const line = raw.trim().split('\n')[0] ?? '';
  return line.replace(/[?#].*$/, '').trim();
}

export function formatEmptyUrl(u: unknown): string {
  const s = pickRawString(u);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function pickAnonOrEmptyString(raw: unknown): string {
  return pickRawString(raw);
}
