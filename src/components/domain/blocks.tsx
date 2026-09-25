/** Reusable product blocks shared across traveller and guardian screens. */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  CircleCheckBig,
  Clock,
  MapPin,
  Route,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react';
import type { Journey, RiskAssessment, TrustedContact } from '@/domain/types';
import { cn } from '@/lib/cn';
import { TONES, toneForBand } from '@/lib/status';
import { Avatar, StatusDot, StatusPill } from '@/components/ui/primitives';
import { formatClock, formatDurationMinutes, formatRelative } from '@/lib/format';
import { effectiveNow, estimatedArrivalAt, linkQuality, remainingMinutes } from '@/domain/journey';
import { guardianActionFor } from '@/domain/riskEngine';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="sr-label mb-1">{eyebrow}</p> : null}
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[26px]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The hero state card: 🟢 SAFE / 🟡 WATCH / 🟠 ALERT / 🔴 CRITICAL + one line. */
export function StateHero({
  assessment,
  title,
  subtitle,
  journey,
  now,
  children,
  action,
}: {
  assessment: RiskAssessment;
  title?: string;
  subtitle?: string;
  journey?: Journey | null;
  now: number;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tone = toneForBand(assessment.band);
  const t = TONES[tone];
  const action_ = guardianActionFor(assessment.band);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl2 border p-5 transition-state sm:p-6',
        t.surface,
        t.border,
      )}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('grid h-11 w-11 place-items-center rounded-2xl', t.solid)}>
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot tone={tone} pulse={assessment.band !== 'SAFE'} />
                <h1 className="text-[20px] font-bold uppercase tracking-[0.04em] text-ink-900 sm:text-[23px]">
                  {title ?? assessment.band}
                </h1>
              </div>
              <p className="mt-1 max-w-xl text-[13.5px] font-medium leading-snug text-ink-700">
                {subtitle ?? action_.title}
              </p>
            </div>
          </div>

          {journey ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <MiniFact
                icon={<MapPin size={13} />}
                label="Next check-in"
                value={
                  journey.checkIn.state === 'REQUESTED' && journey.checkIn.expiresAt
                    ? `due ${formatClock(journey.checkIn.expiresAt)}`
                    : journey.checkIn.dueAt
                      ? formatClock(journey.checkIn.dueAt)
                      : '—'
                }
              />
              <MiniFact
                icon={<Clock size={13} />}
                label="ETA"
                value={
                  // Measured against the frozen clock, so a paused journey reads
                  // as on hold rather than drifting into "late" behind the UI.
                  effectiveNow(journey, now) > estimatedArrivalAt(journey, now)
                    ? `late ${formatDurationMinutes(
                        Math.max(
                          1,
                          Math.round(
                            (effectiveNow(journey, now) - estimatedArrivalAt(journey, now)) / 60000,
                          ),
                        ),
                      )}`
                    : formatDurationMinutes(remainingMinutes(journey, now))
                }
              />
              <MiniFact
                icon={<Route size={13} />}
                label="Route"
                value={journey.deviationActive ? 'Off route' : 'On route'}
              />
              <MiniFact icon={<Timer size={13} />} label="Guardian" value={journey.guardianAcknowledgedAt ? 'Acknowledged' : 'Watching'} />
            </dl>
          ) : null}

          {children}
        </div>

        {action ? <div className="w-full sm:w-auto">{action}</div> : null}
      </div>
    </section>
  );
}

function MiniFact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px] font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

/** Compact "active journey" summary used on home + guardian lists. */
export function JourneySummaryCard({
  journey,
  now,
  to,
  as = 'traveller',
  className,
}: {
  journey: Journey;
  now: number;
  to?: string;
  as?: 'traveller' | 'guardian';
  className?: string;
}) {
  const quality = linkQuality(journey, now);
  const tone = toneForBand(journey.risk.band);
  const t = TONES[tone];

  const body = (
    <div className={cn('sr-card p-4 transition-state hover:border-ink-300 hover:shadow-raised', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="sr-label">{as === 'guardian' ? 'Monitored journey' : 'Active journey'}</p>
          <p className="mt-1 truncate text-[15px] font-bold text-ink-900">
            {journey.originLabel} <ArrowRight className="inline" size={14} /> {journey.destinationLabel}
          </p>
        </div>
        <StatusPill band={journey.risk.band} size="sm" showEmoji={false} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniFact icon={<Clock size={13} />} label="ETA" value={formatDurationMinutes(remainingMinutes(journey, now))} />
        <MiniFact icon={<MapPin size={13} />} label="Last update" value={formatRelative(journey.lastPositionAt, now)} />
        <MiniFact
          icon={<BellRing size={13} />}
          label="Next check-in"
          value={journey.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'}
        />
        <MiniFact
          icon={<Users size={13} />}
          label="Risk score"
          value={<span className={t.text}>{journey.risk.score}</span>}
        />
      </dl>

      <div className="mt-3 flex items-center gap-2 text-[12px] font-medium text-ink-500">
        <StatusDot tone={quality === 'connected' ? 'safe' : quality === 'delayed' ? 'watch' : 'alert'} />
        {quality === 'connected'
          ? 'Live link — updating'
          : quality === 'delayed'
            ? `Last updated ${formatRelative(journey.lastPositionAt, now)}`
            : quality === 'lost'
              ? 'Guardian link lost — showing last known position'
              : 'Location unavailable — using last known position'}
      </div>
    </div>
  );

  if (!to) return body;
  return (
    <Link to={to} className="block focus-visible:rounded-card">
      {body}
    </Link>
  );
}

/** Trusted circle summary: primary + backup with status. */
export function TrustedCircleCard({
  primary,
  backup,
  to,
  compact,
}: {
  primary: TrustedContact | null;
  backup: TrustedContact | null;
  to?: string;
  compact?: boolean;
}) {
  return (
    <div className="sr-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-ink-400" />
          <h2 className="text-[14px] font-bold text-ink-900">Trusted Circle</h2>
        </div>
        {to ? (
          <Link to={to} className="text-[12.5px] font-semibold text-brand-700 hover:underline">
            Manage
          </Link>
        ) : null}
      </div>

      <ul className="mt-3 space-y-2">
        {[
          { label: 'Primary', contact: primary },
          { label: 'Backup', contact: backup },
        ].map(({ label, contact }) => (
          <li
            key={label}
            className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-3 py-2.5"
          >
            {contact ? <Avatar name={contact.name} size="sm" tone={label === 'Primary' ? 'brand' : 'neutral'} /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-400">{label}</p>
              <p className="truncate text-[13.5px] font-semibold text-ink-800">{contact?.name ?? 'Not set'}</p>
              {!compact ? (
                <p className="truncate text-[11.5px] text-ink-500">
                  {contact ? `${contact.relationship} · ${contact.phone}` : 'Add a contact to enable escalation'}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                contact?.available ? TONES.safe.chip : TONES.watch.chip,
              )}
            >
              <CircleCheckBig size={11} />
              {contact ? (contact.available ? 'Available' : 'Unavailable') : 'Missing'}
            </span>
          </li>
        ))}
      </ul>

      {to ? (
        <Link
          to={to}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white text-[13px] font-semibold text-ink-800 transition-state hover:bg-ink-50"
        >
          Escalation order &amp; contacts
          <ArrowRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-2', className)}>
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[12.5px] text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
