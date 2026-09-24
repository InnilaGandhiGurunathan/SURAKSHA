import { toDate } from './time';

/** Presentation helpers. All locale-dependent formatting goes through here. */

export function formatDateTime(value: string | Date | undefined | null): string {
  const date = toDate(value ?? undefined);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | undefined | null): string {
  const date = toDate(value ?? undefined);
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(value: string | Date | undefined | null): string {
  const date = toDate(value ?? undefined);
  if (!date) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(value: string | Date | undefined | null): string {
  const date = toDate(value ?? undefined);
  if (!date) return '—';
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);
  if (Math.abs(seconds) < 45) return seconds >= 0 ? 'just now' : 'in a moment';
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return minutes >= 0 ? `${minutes} min ago` : `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return hours >= 0 ? `${hours} h ago` : `in ${hours} h`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return days >= 0 ? `${days} d ago` : `in ${days} d`;
  return formatDate(date);
}

export function formatDuration(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null || Number.isNaN(minutes)) return '—';
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs} min`;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function formatSeconds(seconds: number): string {
  const abs = Math.max(0, Math.round(seconds));
  return `${abs}s`;
}

export function formatDistance(meters: number | undefined | null): string {
  if (meters === undefined || meters === null || Number.isNaN(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function initials(name: string | undefined | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const RISK_BAND_META: Record<
  string,
  { label: string; description: string; token: string; className: string }
> = {
  safe: {
    label: 'Calm',
    description: 'No unusual signals detected on this device.',
    token: 'band-safe',
    className: 'bg-band-safe/15 text-emerald-700 dark:text-emerald-300 border-band-safe/40',
  },
  low: {
    label: 'Low',
    description: 'Minor signals only. Monitoring continues quietly.',
    token: 'band-low',
    className: 'bg-band-low/15 text-sky-700 dark:text-sky-300 border-band-low/40',
  },
  medium: {
    label: 'Medium',
    description: 'Several signals accumulated. A discreet check-in may be offered.',
    token: 'band-medium',
    className: 'bg-band-medium/15 text-amber-700 dark:text-amber-300 border-band-medium/40',
  },
  high: {
    label: 'High',
    description: 'Escalation criteria met. Trusted contacts may be notified.',
    token: 'band-high',
    className: 'bg-band-high/15 text-orange-700 dark:text-orange-300 border-band-high/40',
  },
  critical: {
    label: 'Critical',
    description: 'Manual SOS or explicit “not safe”. Emergency workflow opened.',
    token: 'band-critical',
    className: 'bg-band-critical/15 text-red-700 dark:text-red-300 border-band-critical/40',
  },
};

export const RISK_HEURISTIC_NOTE =
  'Heuristic indicator from on-device rules — not a validated probability of danger.';

export function riskBandClass(band: string): string {
  return RISK_BAND_META[band]?.className ?? RISK_BAND_META.low.className;
}
