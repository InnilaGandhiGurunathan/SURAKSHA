/** Date & time helpers used across the monitoring loop and the UI. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function toDate(value: string | number | Date | undefined | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function minutesBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return (b.getTime() - a.getTime()) / MINUTE;
}

export function addMinutes(date: string | Date, minutes: number): Date {
  const base = toDate(date) ?? new Date();
  return new Date(base.getTime() + minutes * MINUTE);
}

export function isPast(value: string | undefined | null, now: number = Date.now()): boolean {
  const date = toDate(value);
  return date ? date.getTime() < now : false;
}

export function isNightTime(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 5;
}

/** Formats a Date for `<input type="datetime-local">` without timezone drift. */
export function toDateTimeInputValue(value: string | Date): string {
  const date = toDate(value) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeInputValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Human "time until" text used for check-ins and ETAs; never claims precision. */
export function relativeToNow(value: string | undefined | null): string {
  const date = toDate(value);
  if (!date) return 'unknown';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / MINUTE);
  const unit = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
