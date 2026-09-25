/**
 * RouteOptionsPanel — a Google-Maps-style route descriptor.
 *
 * One component, two contexts:
 *   • `plan` (Start Journey) — build the route before committing to a journey.
 *   • `live` (Active Journey) — re-plan the running journey's ETA.
 *
 * Everything here is an *estimate* on SURAKSHA's fictional demo map: it is
 * deliberately labelled "simulated" so a judge never mistakes it for real
 * routing. The shapes (mode tabs, depart/arrive, traffic, speed, avoid) mirror
 * a maps app so the interaction feels familiar.
 */

import { useMemo, useState } from 'react';
import {
  Bike,
  Car,
  Check,
  Footprints,
  RefreshCw,
  Route,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import type { RouteMode, RouteOption, RoutePreferences } from '@/domain/types';
import { AVOID_META, selectedPlatformLabel } from '@/domain/routing';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/cn';

const MODE_TAB_ICON: Record<RouteMode, typeof Car> = {
  fastest: Car,
  walking: Footprints,
  cycling: Bike,
  car: Car,
  premium: ShieldCheck,
};

const TRAFFIC_LEVELS: Array<{ id: 'light' | 'moderate' | 'heavy'; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'heavy', label: 'Heavy' },
];

interface RouteOptionsPanelProps {
  variant: 'plan' | 'live';
  origin: string;
  destination: string;
  options: RouteOption[];
  mode: RouteMode;
  onMode: (m: RouteMode) => void;
  preferences: RoutePreferences;
  onPreferences: (p: RoutePreferences) => void;
  onRefresh: () => void;
  now: number;
  /** Absolute arrival timestamp for the currently chosen option (for display). */
  arrivalAt: number;
}

export function RouteOptionsPanel({
  variant,
  origin,
  destination,
  options,
  mode,
  onMode,
  preferences,
  onPreferences,
  onRefresh,
  now,
  arrivalAt,
}: RouteOptionsPanelProps) {
  const [legsOpen, setLegsOpen] = useState(false);
  const chosen = options.find((o) => o.mode === mode) ?? options[0];
  const traffic = preferences.presetTraffic ?? 'light';
  const speed = preferences.speedFactor || 1;

  // The depart / arrive-by *choice* lives in the parent (Start Journey owns the
  // canonical "Clock time" toggle). This panel reads the resolved departure for
  // its ETA maths, and surfaces the custom-time picker inline like a maps app.
  const resolveDeparture = useMemo(() => {
    if (preferences.arriveBy && preferences.customArrivalAt) return preferences.customArrivalAt - (chosen?.durationMin ?? 30) * 60_000;
    if (preferences.departAt === 'custom' && preferences.customDepartureAt) return preferences.customDepartureAt;
    return now;
  }, [preferences, chosen, now]);

  const [hh, mm] = [new Date(resolveDeparture).getHours(), new Date(resolveDeparture).getMinutes()];

  return (
    <div className="rounded-2xl border border-ink-200 bg-white">
      {/* Destination header — reads like a maps search bar */}
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
        <Waypoints size={17} className="shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-ink-900">{origin}</p>
          <p className="truncate text-[12.5px] text-ink-500">→ {destination}</p>
        </div>
        <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
          {variant === 'plan' ? 'Planning' : 'Live'}
        </span>
      </div>

      {/* Mode tabs */}
      <div className="scrollbar-none flex gap-1 overflow-x-auto px-2 pt-2">
        {options.map((o) => {
          const Icon = MODE_TAB_ICON[o.mode];
          const active = o.mode === mode;
          return (
            <button
              key={o.mode}
              type="button"
              onClick={() => onMode(o.mode)}
              className={cn(
                'flex min-w-[92px] flex-col items-center gap-1 rounded-t-xl border-b-2 px-3 py-2.5 text-[11.5px] font-semibold transition-state',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:bg-ink-50',
              )}
            >
              <Icon size={17} />
              <span className="whitespace-nowrap">{o.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-4">
        {/* ETA summary */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
              {preferences.departAt === 'custom' ? 'Departure' : 'Leaving'}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{formatClock(resolveDeparture)}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">Estimated time</p>
            <p className="mt-1 text-lg font-bold text-brand-700">
              {chosen?.durationMin ?? '—'} min
            </p>
            {chosen ? (
              <p className="text-[11.5px] text-ink-500">
                {chosen.distanceKm} km · arrive ~{formatClock(arrivalAt)}
              </p>
            ) : null}
          </div>
        </div>

        {/* Departure time */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {preferences.departAt !== 'custom' ? (
            <button
              type="button"
              onClick={() =>
                onPreferences({
                  ...preferences,
                  departAt: 'custom',
                  customDepartureAt: now + 30 * 60_000,
                })
              }
              className="rounded-xl border border-ink-200 px-3 py-1.5 text-[12.5px] font-semibold text-ink-600 transition-state hover:bg-ink-50"
            >
              Choose a departure time…
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  const d = new Date(preferences.arriveBy ? (preferences.customArrivalAt ?? now) : (preferences.customDepartureAt ?? now));
                  d.setHours(h || 0, m || 0, 0, 0);
                  onPreferences({ ...preferences, departAt: 'custom', customDepartureAt: d.getTime() });
                }}
                className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-brand-400 focus:outline-none"
              />
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                Store clock
              </span>
            </div>
          )}
        </div>

        {/* Traffic + speed */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-ink-600">Consistent traffic model</p>
            <div className="inline-flex rounded-xl bg-ink-100 p-0.5">
              {TRAFFIC_LEVELS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPreferences({ ...preferences, presetTraffic: t.id })}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-state',
                    traffic === t.id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[12px] font-semibold text-ink-600">Custom speed</p>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">{speed.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={speed}
              onChange={(e) => onPreferences({ ...preferences, speedFactor: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-brand-600"
            />
          </div>
        </div>

        {/* Avoid chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {AVOID_META.map((a) => {
            const active = preferences.avoid.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                title={a.detail}
                onClick={() => {
                  const avoid = active
                    ? preferences.avoid.filter((x) => x !== a.id)
                    : [...preferences.avoid, a.id];
                  onPreferences({ ...preferences, avoid });
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-state',
                  active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:bg-ink-50',
                )}
              >
                {active ? <Check size={13} /> : null}
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Route options (per-mode legs) */}
        <div className="mt-4 rounded-xl border border-ink-200">
          <button
            type="button"
            onClick={() => setLegsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-[13px] font-semibold text-ink-800">
              {chosen ? `${selectedPlatformLabel(chosen.label)} · ${chosen.durationMin} min · ${chosen.distanceKm} km` : 'Choose a route'}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{legsOpen ? 'Hide' : 'Show'} steps</span>
          </button>

          <div className="grid gap-2 sm:grid-cols-3">
            {options.slice(0, 3).map((o) => (
              <button
                key={o.mode}
                type="button"
                onClick={() => onMode(o.mode)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-left transition-state',
                  o.mode === mode ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:bg-ink-50',
                )}
              >
                <span className="block text-[12.5px] font-semibold text-ink-800">{o.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-ink-500">{o.durationMin} min · {o.distanceKm} km</span>
              </button>
            ))}
          </div>

          {legsOpen && chosen ? (
            <ol className="mt-3 space-y-0 border-t border-ink-100 pt-3">
              {chosen.waypoints.map((w, i) => (
                <li key={i} className="flex items-start gap-2 px-4 py-1.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-ink-800">{w.label}</p>
                    <p className="text-[11px] text-ink-400">{w.real ? 'maps backend' : 'simulated · demo map'}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        {/* Source / refresh row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3 text-[11.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <Route size={13} className="text-brand-600" />
            Simulated route · fictional demo map
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 font-semibold text-ink-600 transition-state hover:bg-ink-50"
          >
            <RefreshCw size={13} />
            Recalculate
          </button>
        </div>
      </div>
    </div>
  );
}
