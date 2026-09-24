/** Shared event timeline used by both the traveller and guardian views. */

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  FileText,
  Flag,
  Info,
  MapPin,
  Pause,
  Phone,
  Play,
  Route,
  RouteOff,
  ShieldAlert,
  Siren,
  Hash,
} from 'lucide-react';
import type { SafetyEvent } from '@/domain/types';
import { presentEvent } from '@/services/eventBus';
import { formatClock, formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { TONES, type Tone } from '@/lib/status';

const ICONS = {
  play: Play,
  pin: MapPin,
  route: Route,
  'route-off': RouteOff,
  bell: Bell,
  check: CheckCircle2,
  alert: AlertTriangle,
  'shield-alert': ShieldAlert,
  phone: Phone,
  siren: Siren,
  file: FileText,
  pause: Pause,
  flag: Flag,
  info: Info,
  hash: Hash,
} as const;

export function EventTimeline({
  events,
  now,
  className,
  emptyLabel = 'No events recorded yet.',
  dense,
  limit,
  grouped,
}: {
  events: SafetyEvent[];
  now: number;
  className?: string;
  emptyLabel?: string;
  dense?: boolean;
  limit?: number;
  grouped?: boolean;
}) {
  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
  const visible = typeof limit === 'number' ? sorted.slice(0, limit) : sorted;

  if (!visible.length) {
    return (
      <p className={cn('rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-[13px] text-ink-500', className)}>
        {emptyLabel}
      </p>
    );
  }

  const groups = grouped ? groupByDay(visible) : null;

  return (
    <div className={cn('space-y-1', className)}>
      {groups
        ? groups.map((group) => (
            <div key={group.label} className="pb-2">
              <p className="sr-label px-1 pb-1.5 pt-2">{group.label}</p>
              <TimelineList events={group.events} now={now} dense={dense} />
            </div>
          ))
        : <TimelineList events={visible} now={now} dense={dense} />}
    </div>
  );
}

function TimelineList({ events, now, dense }: { events: SafetyEvent[]; now: number; dense?: boolean }) {
  return (
    <ol className="relative space-y-0">
      {events.map((event, index) => {
        const presentation = presentEvent(event);
        const tone = presentation.tone as Tone;
        const Icon = ICONS[presentation.icon];
        const tokens = TONES[tone];
        return (
          <li key={event.id} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'z-10 grid place-items-center rounded-full border bg-white',
                  tokens.border,
                  dense ? 'h-7 w-7' : 'h-8 w-8',
                )}
              >
                <Icon size={dense ? 13 : 14} className={tokens.text} />
              </span>
              {index < events.length - 1 ? <span className="w-px flex-1 bg-ink-200" aria-hidden /> : null}
            </div>
            <div className={cn('min-w-0 flex-1', dense ? 'pb-3' : 'pb-4')}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-[13.5px] font-semibold leading-snug text-ink-800">{presentation.label}</p>
                <time className="shrink-0 text-[11.5px] font-medium text-ink-400 tabular" dateTime={new Date(event.timestamp).toISOString()}>
                  {formatClock(event.timestamp)}
                  <span className="ml-1 text-ink-300">· {formatRelative(event.timestamp, now)}</span>
                </time>
              </div>
              {event.metadata && Object.keys(event.metadata).length && event.type === 'risk_changed' ? (
                <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
                  {String(event.metadata.previous)} → {String(event.metadata.band)} · score {String(event.metadata.score)}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function groupByDay(events: SafetyEvent[]) {
  const map = new Map<string, SafetyEvent[]>();
  events.forEach((event) => {
    const label = formatDate(event.timestamp, { weekday: 'long', month: 'short', day: 'numeric' });
    const list = map.get(label) ?? [];
    list.push(event);
    map.set(label, list);
  });
  return [...map.entries()].map(([label, list]) => ({ label, events: list }));
}
