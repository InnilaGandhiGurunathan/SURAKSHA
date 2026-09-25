/**
 * RiskPanel — the explainable "Why this score?" surface.
 *
 * The Safety Risk Engine always shows its arithmetic: every point in the score
 * is listed with its weight, and the panel states plainly what the score is not.
 */

import { useState } from 'react';
import { ChevronDown, Info, Sigma, Sparkles } from 'lucide-react';
import type { RiskAssessment } from '@/domain/types';
import { explainScore } from '@/domain/riskEngine';
import { cn } from '@/lib/cn';
import { TONES, toneForBand } from '@/lib/status';
import { RiskMeter } from '@/components/ui/primitives';

export function RiskScoreDial({
  assessment,
  size = 'md',
  showBand = true,
}: {
  assessment: RiskAssessment;
  size?: 'sm' | 'md' | 'lg';
  showBand?: boolean;
}) {
  const tone = toneForBand(assessment.band);
  const t = TONES[tone];
  const dims = size === 'sm' ? 'h-16 w-16' : size === 'lg' ? 'h-28 w-28' : 'h-20 w-20';
  const text = size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-3xl' : 'text-2xl';
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex items-center gap-3">
      <div className={cn('relative grid place-items-center', dims)}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#DFE4EC" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            className={cn(t.text, 'transition-[stroke-dashoffset] duration-700')}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.min(100, assessment.score) / 100)}
          />
        </svg>
        <div className="text-center">
          <span className={cn('block font-bold tabular text-ink-900', text)}>{assessment.score}</span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-400">risk</span>
        </div>
      </div>
      {showBand ? (
        <div className="min-w-0">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.06em]',
              t.chip,
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', t.dot)} />
            {assessment.band}
          </span>
          <p className="mt-1.5 max-w-[15rem] text-[12.5px] leading-snug text-ink-600">{assessment.headline}</p>
        </div>
      ) : null}
    </div>
  );
}

export function RiskWhyPanel({
  assessment,
  className,
  defaultOpen,
  compact,
}: {
  assessment: RiskAssessment;
  className?: string;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const tone = toneForBand(assessment.band);
  const t = TONES[tone];
  const positives = assessment.reasons.filter((r) => r.delta > 0);
  const negatives = assessment.reasons.filter((r) => r.delta < 0);
  /*
   * Show the engine's own number rather than re-summing the lines here.
   *
   * The engine guarantees the deltas sum to the score (clamps are emitted as
   * their own reason lines), so this is the same number — but computing it a
   * second time meant the panel could contradict the headline if the two ever
   * drifted. One source of truth for the arithmetic.
   */
  const total = assessment.score;

  return (
    <div className={cn('overflow-hidden rounded-xl border', t.border, t.surface, className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Sigma size={15} className={t.text} />
          <span className="text-[13px] font-semibold text-ink-800">Why this score?</span>
          <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-bold text-ink-600 tabular">
            {assessment.score}
          </span>
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-ink-500 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="animate-fade-in space-y-3 border-t border-white/70 px-3.5 pb-3.5 pt-3">
          {assessment.reasons.length ? (
            <ul className="space-y-1.5">
              {[...positives, ...negatives].map((reason, index) => (
                <li key={`${reason.code}-${index}`} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink-800">{reason.label}</span>
                    {reason.detail && !compact ? (
                      <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{reason.detail}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-lg px-2 py-0.5 text-[12.5px] font-bold tabular',
                      reason.delta > 0 ? 'bg-white/80 text-ink-800' : 'bg-safe-100 text-safe-800',
                    )}
                  >
                    {reason.delta > 0 ? `+${reason.delta}` : `−${Math.abs(reason.delta)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-600">
              No safety signals are open. The score reflects journey timing, route status and completed check-ins.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2">
            <span className="text-[12.5px] font-semibold text-ink-600">Total</span>
            <span className="text-[13px] font-bold text-ink-900 tabular">
              {total}
              <span className="ml-1 text-[11.5px] font-medium text-ink-400">/ 100</span>
            </span>
          </div>

          <p className="flex gap-2 text-[12.5px] leading-relaxed text-ink-600">
            <Info size={14} className="mt-0.5 shrink-0 text-ink-400" />
            <span>{explainScore(assessment)}</span>
          </p>

          <p className="flex gap-2 rounded-lg bg-white/70 px-3 py-2 text-[11.5px] leading-relaxed text-ink-500">
            <Sparkles size={13} className="mt-0.5 shrink-0" />
            <span>
              Deterministic rules only — no machine learning, no prediction about people, and no claim that anyone is in
              danger.
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact band ladder used on the journey + guardian screens so the state
 * machine is legible at a glance.
 */
export function RiskBandLadder({ band, className }: { band: RiskAssessment['band']; className?: string }) {
  const steps: Array<{ band: RiskAssessment['band']; label: string; range: string }> = [
    { band: 'SAFE', label: 'SAFE', range: '0–29' },
    { band: 'WATCH', label: 'WATCH', range: '30–49' },
    { band: 'ALERT', label: 'ALERT', range: '50–74' },
    { band: 'CRITICAL', label: 'CRITICAL', range: '75+' },
  ];
  const activeIndex = steps.findIndex((s) => s.band === band);
  return (
    <div className={cn('flex items-stretch gap-1', className)}>
      {steps.map((step, index) => {
        const t = TONES[toneForBand(step.band)];
        const active = index === activeIndex;
        const passed = index < activeIndex;
        return (
          <div
            key={step.band}
            className={cn(
              'flex-1 rounded-lg border px-2 py-1.5 text-center transition-state',
              active ? cn(t.chip, 'shadow-sm ring-1', t.ring) : passed ? 'border-ink-200 bg-ink-50' : 'border-ink-200 bg-white',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span className={cn('block text-[10.5px] font-bold tracking-wide', active ? '' : 'text-ink-500')}>
              {step.label}
            </span>
            <span className={cn('block text-[10px]', active ? 'opacity-80' : 'text-ink-400')}>{step.range}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RiskMeterWithBand({ assessment }: { assessment: RiskAssessment }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="sr-label">Safety Risk Engine</span>
        <span className="text-[12px] font-semibold text-ink-600 tabular">
          {assessment.score}
          <span className="text-ink-400"> / 100 · {assessment.band}</span>
        </span>
      </div>
      <RiskMeter score={assessment.score} band={assessment.band} />
    </div>
  );
}
