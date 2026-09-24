import { useState } from 'react';
import type { JourneyEvent, TimelineSummary } from '@suraksha/shared';
import { ChevronDown, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { EVENT_PRESENTATION, severityMeta } from '@/services/events';

/**
 * The secure event timeline.
 *
 * Rendered from device-local records, so it is complete and readable offline.
 * Each row shows whether the event has been mirrored to a server, because "was
 * anyone else told about this?" is exactly the question a traveller asks.
 */
export function TimelineList({
  events,
  emptyLabel = 'No events recorded yet.',
  className,
  limit,
  collapsibleBeyond = 8,
}: {
  events: JourneyEvent[];
  emptyLabel?: string;
  className?: string;
  limit?: number;
  collapsibleBeyond?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const sorted = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const capped = limit ? sorted.slice(0, limit) : sorted;
  const visible = expanded ? capped : capped.slice(0, collapsibleBeyond);

  if (capped.length === 0) {
    return <p className={cn('text-xs text-muted-foreground', className)}>{emptyLabel}</p>;
  }

  return (
    <div className={className}>
      <ol className="relative space-y-3 border-l border-border pl-4">
        {visible.map((event) => {
          const severity = severityMeta(event.severity);
          const presentation = EVENT_PRESENTATION[event.type];

          return (
            <li key={event.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-background',
                  severity.dotClass,
                )}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs font-semibold">{presentation?.label ?? event.type.replace(/_/g, ' ')}</p>
                <span className="text-[10px] text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                {event.syncedAt ? (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
                    mirrored
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
                    on this device
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{event.message}</p>
              {event.location ? (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MapPin className="size-2.5" aria-hidden />
                  {event.location.lat.toFixed(4)}, {event.location.lng.toFixed(4)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {capped.length > collapsibleBeyond ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} aria-hidden />
          {expanded ? 'Show fewer events' : `Show all ${capped.length} events`}
        </button>
      ) : null}
    </div>
  );
}

export function TimelineSummaryRow({ summary }: { summary: TimelineSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]">
      <span className="rounded-full bg-muted px-2 py-0.5">{summary.total} event(s)</span>
      {summary.critical > 0 ? (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-700 dark:text-red-300">
          {summary.critical} critical
        </span>
      ) : null}
      {summary.warnings > 0 ? (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
          {summary.warnings} warning(s)
        </span>
      ) : null}
      {summary.notices > 0 ? (
        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-300">
          {summary.notices} notice(s)
        </span>
      ) : null}
      {summary.total === 0 ? <span className="rounded-full bg-muted px-2 py-0.5">nothing recorded</span> : null}
    </div>
  );
}
