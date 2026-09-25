/**
 * Traveller Home — "What can I do RIGHT NOW?"
 *
 * Status, Start Journey, SOS. Nothing else competes for attention.
 * Every secondary feature (Trusted Circle, Incidents, Community, Learn,
 * Profile/Settings, Exit Mode, risk details) stays exactly where it already
 * is — the existing sidebar / bottom-bar / More-sheet navigation — so this
 * screen removes information, not functionality.
 */

import { Link, useNavigate } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { Avatar, StatusDot, StatusPill } from '@/components/ui/primitives';
import { MissedCheckInBanner } from '@/components/domain/CheckInPrompt';
import { useAppState, store } from '@/store/hooks';
import { formatDurationMinutes } from '@/lib/format';
import { remainingMinutes } from '@/domain/journey';
import { EMPTY_RISK_INPUTS, scoreRisk } from '@/domain/riskEngine';
import { toneForBand } from '@/lib/status';

export function TravellerHome() {
  const { journey, now, travellerProfile } = useAppState();
  const navigate = useNavigate();

  const assessment = journey?.risk ?? scoreRisk(EMPTY_RISK_INPUTS);
  const active = Boolean(journey && journey.status !== 'ENDED');
  const tone = toneForBand(assessment.band);

  const statusTitle =
    assessment.band === 'SAFE'
      ? active
        ? 'Journey active'
        : "You're safe"
      : assessment.band.charAt(0) + assessment.band.slice(1).toLowerCase();
  const statusSub = active && journey
    ? `${journey.originLabel} → ${journey.destinationLabel}`
    : 'No active journey';

  // Detailed risk info lives on the Journey page; this link only appears
  // when there is actually something to explain.
  const showWhy = active || assessment.band !== 'SAFE';

  return (
    <div
      className="mx-auto flex min-h-[72vh] max-w-md flex-col px-1"
      key={`home-${journey?.id ?? 'none'}`}
    >
      {/* Compact identity row — details live under Profile. */}
      <header className="flex items-center gap-3 pt-1">
        <Link to="/traveller/profile" aria-label="Open profile and settings">
          <Avatar name={travellerProfile.name} size="md" />
        </Link>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight text-ink-900">Good evening</p>
          <p className="truncate text-[12.5px] text-ink-500">{travellerProfile.name}</p>
        </div>
        {assessment.band !== 'SAFE' ? (
          <span className="ml-auto">
            <StatusPill band={assessment.band} size="sm" showEmoji={false} />
          </span>
        ) : null}
      </header>

      {/* 1 — Current safety status. Calm, lightweight, no card. */}
      <section className="pb-2 pt-8 text-center sm:pt-10" aria-live="polite">
        <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">
          <StatusDot tone={tone} pulse={assessment.band !== 'SAFE'} />
          Current status
        </p>
        <h1 className="mt-2 text-[34px] font-bold leading-none tracking-tight text-ink-900 sm:text-[38px]">
          {statusTitle}
        </h1>
        <p className="mt-2 text-[14px] text-ink-500">{statusSub}</p>
        {showWhy ? (
          <Link
            to="/traveller/journey"
            className="mt-1.5 inline-block text-[12.5px] font-semibold text-brand-700 hover:underline"
          >
            Why this status?
          </Link>
        ) : null}
      </section>

      {journey?.checkIn.state === 'MISSED' ? (
        <div className="mt-3">
          <MissedCheckInBanner />
        </div>
      ) : null}

      {/* 2 + 3 — the only two actions on this screen. */}
      <div className="mt-6 space-y-3">
        {active && journey ? (
          <button
            type="button"
            onClick={() => navigate('/traveller/journey')}
            className="flex min-h-[76px] w-full flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-600 px-6 py-4 text-white shadow-raised transition-state hover:bg-brand-700 active:scale-[0.99]"
          >
            <span className="text-[19px] font-bold uppercase tracking-[0.06em]">
              Journey active
            </span>
            <span className="text-[13px] font-medium opacity-90">
              {formatDurationMinutes(remainingMinutes(journey, now))} remaining →
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/traveller/start')}
            className="flex min-h-[76px] w-full flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-600 px-6 py-4 text-white shadow-raised transition-state hover:bg-brand-700 active:scale-[0.99]"
          >
            <span className="text-[19px] font-bold uppercase tracking-[0.06em]">
              Start journey
            </span>
            <span className="text-[13px] font-medium opacity-90">Set destination →</span>
          </button>
        )}

        <button
          type="button"
          aria-label="Quick SOS — get help now"
          onClick={() => store.toggleUi('sosPanelOpen', true)}
          className="flex min-h-[76px] w-full flex-col items-center justify-center gap-0.5 rounded-2xl bg-critical-600 px-6 py-4 text-white shadow-raised transition-state hover:bg-critical-700 active:scale-[0.99]"
        >
          <span className="flex items-center gap-2 text-[19px] font-bold uppercase tracking-[0.06em]">
            <Siren size={19} />
            SOS
          </span>
          <span className="text-[13px] font-medium opacity-90">Get help now</span>
        </button>
      </div>

      {/* Everything else lives in the existing navigation. */}
      <p className="mt-auto pt-8 text-center text-[12.5px] text-ink-400">
        <Link to="/welcome" className="font-semibold text-ink-500 hover:text-ink-700 hover:underline">
          How SURAKSHA works
        </Link>
      </p>
    </div>
  );
}
