/**
 * Traveller Home — "What can I do RIGHT NOW?"
 *
 * Status, Start Journey, SOS. Nothing else competes for attention.
 * Every secondary feature (Trusted Circle, Incidents, Community, Learn,
 * Profile/Settings, Exit Mode, risk details) stays exactly where it already
 * is — the existing sidebar / bottom-bar / More-sheet navigation — so this
 * screen removes information, not functionality.
 *
 * Like every other SOS surface (header, mobile centre tab), the SOS card is
 * the sign-in affordance: while signed out it reads "SIGN IN" and leads to
 * /login instead of opening the emergency workflow.
 */

import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronRight, LogIn, ShieldAlert, ShieldCheck, Siren } from 'lucide-react';
import { Avatar, StatusDot, StatusPill } from '@/components/ui/primitives';
import { MissedCheckInBanner } from '@/components/domain/CheckInPrompt';
import { useAppState, store } from '@/store/hooks';
import { useAuth } from '@/store/authStore';
import { formatDurationMinutes } from '@/lib/format';
import { remainingMinutes } from '@/domain/journey';
import { EMPTY_RISK_INPUTS, scoreRisk } from '@/domain/riskEngine';
import { toneForBand } from '@/lib/status';
import { cn } from '@/lib/cn';

/** Soft medallion tints — calm when safe, warmer as the band rises. */
const MEDALLION: Record<string, string> = {
  safe: 'bg-safe-100 text-safe-700',
  brand: 'bg-brand-100 text-brand-700',
  neutral: 'bg-ink-100 text-ink-600',
  watch: 'bg-watch-100 text-watch-700',
  alert: 'bg-alert-100 text-alert-700',
  critical: 'bg-critical-100 text-critical-700',
};

export function TravellerHome() {
  const { journey, now, travellerProfile } = useAppState();
  const { signedIn } = useAuth();
  const navigate = useNavigate();

  const assessment = journey?.risk ?? scoreRisk(EMPTY_RISK_INPUTS);
  const active = Boolean(journey && journey.status !== 'ENDED');
  const tone = toneForBand(assessment.band);
  const calm = assessment.band === 'SAFE';

  const statusTitle = calm
    ? active
      ? 'Journey active'
      : "You're safe"
    : assessment.band.charAt(0) + assessment.band.slice(1).toLowerCase();
  const statusSub =
    active && journey ? `${journey.originLabel} → ${journey.destinationLabel}` : 'No active journey';

  // Detailed risk info lives on the Journey page; this link only appears
  // when there is actually something to explain.
  const showWhy = active || !calm;

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
        {!calm ? (
          <span className="ml-auto">
            <StatusPill band={assessment.band} size="sm" showEmoji={false} />
          </span>
        ) : null}
      </header>

      {/* 1 — Current safety status. Reassuring, lightweight, no card. */}
      <section className="flex flex-col items-center pb-2 pt-8 text-center sm:pt-10" aria-live="polite">
        <span
          className={cn(
            'grid h-14 w-14 place-items-center rounded-2xl shadow-sm',
            MEDALLION[tone] ?? MEDALLION.neutral,
          )}
        >
          {calm ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
        </span>
        <p className="mt-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">
          <StatusDot tone={tone} pulse={!calm} />
          Current status
        </p>
        <h1 className="mt-1.5 text-[34px] font-bold leading-none tracking-tight text-ink-900 sm:text-[38px]">
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

      {/* 2 — Start Journey: the primary action. */}
      <div className="mt-6 space-y-3">
        {active && journey ? (
          <button
            type="button"
            onClick={() => navigate('/traveller/journey')}
            className="flex min-h-[80px] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-brand-600 px-6 py-4 text-white shadow-raised transition-state hover:bg-brand-700 active:scale-[0.99]"
          >
            <span className="text-[19px] font-bold uppercase tracking-[0.06em]">
              Journey active
            </span>
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium opacity-90">
              {formatDurationMinutes(remainingMinutes(journey, now))} remaining
              <ArrowRight size={14} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/traveller/start')}
            className="flex min-h-[80px] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-brand-600 px-6 py-4 text-white shadow-raised transition-state hover:bg-brand-700 active:scale-[0.99]"
          >
            <span className="text-[19px] font-bold uppercase tracking-[0.06em]">Start journey</span>
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium opacity-90">
              Set destination
              <ArrowRight size={14} />
            </span>
          </button>
        )}

        {/* 3 — SOS: a deliberate emergency control, unmistakable but
            visually distinct from the primary action so the page stays calm.
            While signed out this is the sign-in door, like every other SOS
            surface (the SOS button is the sign-in affordance). */}
        <button
          type="button"
          aria-label={signedIn ? 'Quick SOS — get emergency assistance now' : 'Sign in to SURAKSHA'}
          onClick={() => (signedIn ? store.toggleUi('sosPanelOpen', true) : navigate('/login'))}
          className="flex w-full items-center gap-4 rounded-2xl border-[1.5px] border-critical-200 bg-white px-5 py-4 text-left shadow-card transition-state hover:border-critical-300 hover:shadow-raised active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-critical-600 text-white shadow-sm">
            {signedIn ? <Siren size={22} /> : <LogIn size={22} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-bold leading-tight tracking-[0.08em] text-critical-700">
              {signedIn ? 'SOS' : 'SIGN IN'}
            </span>
            <span className="block text-[13px] font-medium text-ink-500">
              {signedIn ? 'Emergency assistance' : 'Sign in to use SOS and safety monitoring'}
            </span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-critical-300" />
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
