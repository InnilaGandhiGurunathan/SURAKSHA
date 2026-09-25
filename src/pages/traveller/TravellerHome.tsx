/**
 * Traveller Home — calm by default.
 *
 * Level 1 (immediate safety) is the only thing with strong visual presence:
 * status, journey state, and SOS. Everything else lives one tap away as a
 * quiet list row that deep-links to its existing page — no feature removed,
 * only de-emphasised.
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  ChevronRight,
  Compass,
  Info,
  MapPin,
  PhoneCall,
  Plus,
  Siren,
  UserCircle2,
  Users,
} from 'lucide-react';
import { Avatar, Button, StatusDot, StatusPill } from '@/components/ui/primitives';
import { RiskWhyPanel } from '@/components/domain/RiskWhyPanel';
import { MissedCheckInBanner } from '@/components/domain/CheckInPrompt';
import { useAppState, useCircle, store } from '@/store/hooks';
import { formatClock, formatDurationMinutes, formatRelative } from '@/lib/format';
import { remainingMinutes } from '@/domain/journey';
import { EMPTY_RISK_INPUTS, scoreRisk } from '@/domain/riskEngine';
import { LESSONS_SEED } from '@/domain/seed';
import { TONES, toneForBand } from '@/lib/status';
import { cn } from '@/lib/cn';

export function TravellerHome() {
  const { journey, events, now, travellerProfile, places, learning } = useAppState();
  const { primary } = useCircle();
  const navigate = useNavigate();

  const assessment = journey?.risk ?? scoreRisk(EMPTY_RISK_INPUTS);
  const active = Boolean(journey && journey.status !== 'ENDED');
  const tone = toneForBand(assessment.band);
  const t = TONES[tone];

  const title =
    assessment.band === 'SAFE'
      ? active
        ? 'Journey active'
        : "You're safe"
      : assessment.band.charAt(0) + assessment.band.slice(1).toLowerCase();
  const subtitle = journey
    ? journey.risk.headline
    : 'Everything looks normal. Start a journey when you set off.';

  const lastEvent = events.length ? events[events.length - 1] : null;
  const openNow = places.filter((p) => p.openNow).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4" key={`home-${journey?.id ?? 'none'}`}>
      {/* Slim header: who + state. Details live under Profile. */}
      <header className="flex items-center gap-3 px-1 pt-1">
        <Link to="/traveller/profile" aria-label="Open profile and settings">
          <Avatar name={travellerProfile.name} size="md" />
        </Link>
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-tight tracking-tight text-ink-900">
            Good evening
          </p>
          <p className="truncate text-[12.5px] text-ink-500">
            {travellerProfile.name} · Traveller
          </p>
        </div>
        <Link
          to="/traveller/profile"
          className="ml-auto grid h-10 w-10 place-items-center rounded-xl text-ink-500 transition-state hover:bg-ink-100 hover:text-ink-800"
          aria-label="Profile and settings"
        >
          <UserCircle2 size={22} />
        </Link>
      </header>

      {/* Level 1 — the only loud thing on this screen. */}
      <section
        className={cn('rounded-xl2 border p-5 transition-state sm:p-6', t.surface, t.border)}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-500">
            <StatusDot tone={tone} pulse={assessment.band !== 'SAFE'} />
            {active ? 'Journey active' : 'No journey running'}
          </p>
          <StatusPill band={assessment.band} size="sm" showEmoji={false} />
        </div>

        <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[30px]">
          {title}
        </h1>
        <p className="mt-1 max-w-md text-[13.5px] leading-snug text-ink-600">{subtitle}</p>

        {journey ? (
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/60 pt-4">
            <div className="min-w-0">
              <dt className="sr-label">To</dt>
              <dd className="mt-0.5 truncate text-[14px] font-bold text-ink-900">
                {journey.destinationLabel}
              </dd>
            </div>
            <div>
              <dt className="sr-label">ETA</dt>
              <dd className="mt-0.5 text-[14px] font-bold text-ink-900 tabular">
                {formatDurationMinutes(remainingMinutes(journey, now))}
              </dd>
            </div>
            <div>
              <dt className="sr-label">Check-in</dt>
              <dd className="mt-0.5 text-[14px] font-bold text-ink-900 tabular">
                {journey.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'}
              </dd>
            </div>
          </dl>
        ) : null}

        {/* Level 2 — one primary action, one discreet exit, one distinct SOS. */}
        <div className="mt-5 space-y-2">
          {active ? (
            <Button
              block
              size="lg"
              icon={<Compass size={17} />}
              onClick={() => navigate('/traveller/journey')}
            >
              Open journey
            </Button>
          ) : (
            <Button
              block
              size="lg"
              icon={<Plus size={17} />}
              onClick={() => navigate('/traveller/start')}
            >
              Start journey
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              block
              icon={<PhoneCall size={16} />}
              onClick={() => navigate('/traveller/exit')}
            >
              Exit Mode
            </Button>
            <button
              type="button"
              aria-label="Quick SOS — opens the emergency workflow"
              onClick={() => store.toggleUi('sosPanelOpen', true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-critical-600 px-4 text-[14px] font-bold text-white transition-state hover:bg-critical-700 active:scale-[0.99]"
            >
              <Siren size={16} />
              SOS
            </button>
          </div>
        </div>
      </section>

      {journey?.checkIn.state === 'MISSED' ? <MissedCheckInBanner /> : null}

      {/* Level 3 — the explanation, collapsed until asked for. */}
      <RiskWhyPanel assessment={assessment} />

      {/* Level 3 + 4 — every other feature, one quiet row each. */}
      <nav className="sr-card divide-y divide-ink-100 overflow-hidden" aria-label="More">
        <HomeRow
          to="/traveller/circle"
          icon={<Users size={17} />}
          title="Trusted Circle"
          hint={primary ? `Primary · ${primary.name}` : 'Choose who SURAKSHA alerts first'}
        />
        <HomeRow
          to={active ? '/traveller/journey' : '/traveller/incidents'}
          icon={<Activity size={17} />}
          title="Activity & incidents"
          hint={
            lastEvent
              ? `${events.length} signal${events.length === 1 ? '' : 's'} · last ${formatRelative(lastEvent.timestamp, now)}`
              : 'Nothing recorded yet'
          }
        />
        <HomeRow
          to="/traveller/community"
          icon={<MapPin size={17} />}
          title="Safe places nearby"
          hint={`${openNow} of ${places.length} open now`}
        />
        <HomeRow
          to="/traveller/learn"
          icon={<BookOpen size={17} />}
          title="Safety learning"
          hint={`${learning.completed.length} / ${LESSONS_SEED.length} lessons completed`}
        />
        <HomeRow
          to="/traveller/profile"
          icon={<UserCircle2 size={17} />}
          title="Profile & settings"
          hint="Check-ins, privacy, demo mode"
        />
        <HomeRow
          to="/welcome"
          icon={<Info size={17} />}
          title="How SURAKSHA works"
          hint="What the app does — and does not do"
        />
      </nav>

      <p className="px-1 pb-2 text-center text-[11.5px] leading-relaxed text-ink-400">
        SURAKSHA watches the journey with you. It is a tool, not a promise.
      </p>
    </div>
  );
}

function HomeRow({
  to,
  icon,
  title,
  hint,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3.5 transition-state hover:bg-ink-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-900">{title}</span>
        <span className="block truncate text-[12px] text-ink-500">{hint}</span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-ink-300" />
    </Link>
  );
}
