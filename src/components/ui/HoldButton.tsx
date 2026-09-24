/**
 * Press-and-hold action button.
 *
 * Quick SOS must be reachable in one gesture but hard to fire by accident, so
 * it requires a deliberate 2-second hold with visible progress, keyboard
 * support (hold Enter/Space) and an optional confirmation step.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function HoldButton({
  onComplete,
  holdMs = 2000,
  label,
  sublabel,
  icon,
  className,
  disabled,
  tone = 'critical',
  confirmLabel,
}: {
  onComplete: () => void;
  holdMs?: number;
  label: ReactNode;
  sublabel?: ReactNode;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  tone?: 'critical' | 'alert' | 'brand';
  /** When set, the user gets an explicit confirm step after the hold. */
  confirmLabel?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const completed = useRef(false);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  const loop = useCallback(() => {
    const elapsed = performance.now() - startedAt.current;
    const next = Math.min(1, elapsed / holdMs);
    setProgress(next);
    if (next >= 1) {
      if (!completed.current) {
        completed.current = true;
        stop();
        if (confirmLabel) setArmed(true);
        else onComplete();
      }
      return;
    }
    frame.current = requestAnimationFrame(loop);
  }, [confirmLabel, holdMs, onComplete, stop]);

  const start = useCallback(() => {
    if (disabled) return;
    completed.current = false;
    startedAt.current = performance.now();
    setHolding(true);
    frame.current = requestAnimationFrame(loop);
  }, [disabled, loop]);

  useEffect(() => () => stop(), [stop]);

  const tones = {
    critical: { base: 'bg-critical-600 hover:bg-critical-700', ring: 'text-critical-100', track: 'bg-critical-800/40' },
    alert: { base: 'bg-alert-500 hover:bg-alert-600', ring: 'text-alert-100', track: 'bg-alert-800/40' },
    brand: { base: 'bg-brand-600 hover:bg-brand-700', ring: 'text-brand-100', track: 'bg-brand-900/40' },
  }[tone];

  const size = 132;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={typeof label === 'string' ? `${label} — hold to activate` : 'Hold to activate'}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
            event.preventDefault();
            start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === 'Enter' || event.key === ' ') stop();
        }}
        onBlur={stop}
        className={cn(
          'relative grid place-items-center rounded-full text-white transition-state select-none',
          tones.base,
          disabled && 'cursor-not-allowed opacity-50',
        )}
        style={{ width: size, height: size }}
      >
        <svg className="absolute inset-0 -rotate-90" width={size} height={size} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={radius} className={cn('fill-none', tones.track)} strokeWidth={stroke} stroke="currentColor" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={cn('fill-none transition-[stroke-dashoffset] duration-75', tones.ring)}
            strokeWidth={stroke}
            stroke="currentColor"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </svg>
        <span className="relative flex flex-col items-center gap-1 px-4 text-center">
          {icon}
          <span className="text-[13px] font-bold uppercase tracking-[0.08em]">{label}</span>
          {sublabel ? <span className="text-[10.5px] font-medium opacity-85">{sublabel}</span> : null}
        </span>
      </button>

      <p className="h-4 text-center text-[11.5px] font-medium text-ink-500">
        {holding ? `Keep holding… ${Math.round(progress * 100)}%` : 'Hold for 2 seconds to activate'}
      </p>

      {armed ? (
        <div className="w-full max-w-sm animate-fade-in-up rounded-2xl border border-critical-200 bg-critical-50 p-4">
          <p className="text-[13px] font-semibold text-critical-800">Activate the emergency workflow?</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-critical-700">
            Your trusted circle will be alerted with your last known location. SURAKSHA does not contact emergency
            services.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setArmed(false);
                onComplete();
              }}
              className="h-11 flex-1 rounded-xl bg-critical-600 text-sm font-semibold text-white transition-state hover:bg-critical-700"
            >
              {confirmLabel ?? 'Yes, activate'}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              className="h-11 flex-1 rounded-xl border border-ink-200 bg-white text-sm font-semibold text-ink-700 transition-state hover:bg-ink-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
