/** Formatting helpers — clock, relative time, durations, text. */

export function formatClock(ts: number | null | undefined): string {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatClockWithSeconds(ts: number | null | undefined): string {
  if (!ts) return '--:--:--';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(ts: number | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], opts ?? { month: 'short', day: 'numeric' });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return `${formatDate(ts)} · ${formatClock(ts)}`;
}

/** "42 seconds ago", "3 min ago", "2 h ago". */
export function formatRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const diff = Math.max(0, now - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const rest = min % 60;
    return rest ? `${hr} h ${rest} min ago` : `${hr} h ago`;
  }
  const days = Math.floor(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function formatDurationMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** mm:ss for countdowns. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatPhone(phone: string): string {
  return phone;
}

export function shortHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

/** Adds minutes to a timestamp. */
export function minutesFrom(ts: number, minutes: number): number {
  return ts + minutes * 60_000;
}

/*
 * There is deliberately no `nowLabel()` here any more.
 *
 * It read `Date.now()` and had no callers — a trap waiting for the next person
 * who wanted "the current time" in a UI that actually runs on the store's
 * virtual clock. Format a timestamp from state (`formatClock(now)`) instead.
 */
