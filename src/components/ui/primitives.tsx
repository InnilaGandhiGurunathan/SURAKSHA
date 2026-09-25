/** SURAKSHA UI kit — cards, buttons, status chips, dialogs, inputs. */

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { TONES, type Tone } from '@/lib/status';
import type { RiskBand } from '@/domain/types';
import { tones as tonesForBand } from '@/lib/status';

/* ----------------------------------------------------------------- */
/* Card                                                               */
/* ----------------------------------------------------------------- */

export function Card({
  className,
  children,
  as: Tag = 'div',
  tone,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
  tone?: Tone;
} & React.HTMLAttributes<HTMLDivElement>) {
  const t = tone ? TONES[tone] : null;
  const Element = Tag as React.ElementType;
  return (
    <Element
      className={cn(
        'sr-card transition-state',
        t && `${t.surface} ${t.border}`,
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] leading-snug text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 pb-5 pt-4', className)}>{children}</div>;
}

/* ----------------------------------------------------------------- */
/* Button                                                            */
/* ----------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'safe' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 shadow-sm',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  outline: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 active:bg-ink-100',
  danger: 'bg-critical-600 text-white hover:bg-critical-700 active:bg-critical-800 shadow-sm',
  safe: 'bg-safe-600 text-white hover:bg-safe-700 active:bg-safe-800 shadow-sm',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
  xl: 'h-14 px-6 text-base gap-2.5 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, icon, trailing, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold transition-state',
        'active:scale-[0.99]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
});

/* ----------------------------------------------------------------- */
/* Chips, pills, badges                                              */
/* ----------------------------------------------------------------- */

export function Chip({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold',
        t.chip,
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  const t = TONES[tone];
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      {pulse ? (
        <span className={cn('absolute inset-0 rounded-full opacity-60', t.dot, 'animate-pulse-ring')} aria-hidden />
      ) : null}
      <span className={cn('relative h-2.5 w-2.5 rounded-full', t.dot)} aria-hidden />
    </span>
  );
}

/** Green / yellow / orange / red status pill with the emoji used in the spec. */
export function StatusPill({
  band,
  size = 'md',
  showEmoji = true,
  className,
}: {
  band: RiskBand;
  size?: 'sm' | 'md' | 'lg';
  showEmoji?: boolean;
  className?: string;
}) {
  const t = tonesForBand(band);
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : size === 'lg' ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-[12px]';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border font-bold uppercase tracking-[0.06em] transition-state',
        t.chip,
        pad,
        className,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', t.dot)} aria-hidden />
      {band}
      {showEmoji ? <span aria-hidden className="text-[11px] opacity-70">{t.emoji}</span> : null}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        TONES[tone].chip,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- */
/* Progress + meters                                                 */
/* ----------------------------------------------------------------- */

export function Progress({
  value,
  tone = 'brand',
  className,
  height = 'h-2',
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  height?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-ink-200/80', height, className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-state', TONES[tone].bar)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Compact 0–100 risk meter with band thresholds marked. */
export function RiskMeter({
  score,
  band,
  className,
  showTicks = true,
}: {
  score: number;
  band: RiskBand;
  className?: string;
  showTicks?: boolean;
}) {
  const t = tonesForBand(band);
  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-ink-200/80">
        <div
          className={cn('h-full rounded-full transition-state', t.bar)}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
        {showTicks ? (
          <>
            <span className="absolute inset-y-0 left-[30%] w-px bg-white/70" aria-hidden />
            <span className="absolute inset-y-0 left-[50%] w-px bg-white/70" aria-hidden />
            <span className="absolute inset-y-0 left-[75%] w-px bg-white/70" aria-hidden />
          </>
        ) : null}
      </div>
      {showTicks ? (
        <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-ink-400">
          <span>0 safe</span>
          <span>30</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Stat                                                              */
/* ----------------------------------------------------------------- */

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('sr-card px-4 py-3.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="sr-label">{label}</span>
        {icon ? <span className={cn('opacity-80', TONES[tone].text)}>{icon}</span> : null}
      </div>
      <div className="mt-1.5 text-xl font-bold tracking-tight text-ink-900 tabular">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-ink-500">{hint}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Avatar                                                            */
/* ----------------------------------------------------------------- */

export function Avatar({
  name,
  size = 'md',
  tone = 'brand',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: Tone;
  className?: string;
}) {
  const initialsText = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const dims = size === 'sm' ? 'h-8 w-8 text-[11px]' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-[13px]';
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold ring-2 ring-white',
        TONES[tone].solid,
        dims,
        className,
      )}
      aria-hidden
    >
      {initialsText}
    </span>
  );
}

/* ----------------------------------------------------------------- */
/* Dialog / sheet                                                    */
/* ----------------------------------------------------------------- */

/**
 * Modal focus trap.
 *
 * Two details in here are load-bearing and were both bugs:
 *
 * 1. **`onClose` is held in a ref, not an effect dependency.** Callers pass a
 *    fresh closure every render, and the store re-renders subscribed components
 *    once a second. With `onClose` in the dependency list the effect tore down
 *    and re-armed every second, and each re-arm called `.focus()` on the first
 *    focusable element. `focus()` scrolls its target into view, so every open
 *    dialog jerked the page once per second — the "sliding" reported on Learn,
 *    Review Lessons, Exit Mode and the Quick SOS panel, four screens that share
 *    no other code. It was also why Add Contact appeared to reject typing: the
 *    caret was being pulled out of the input every second.
 * 2. **`preventScroll` on every focus call**, so opening a dialog never moves
 *    the page behind it.
 */
function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Keep the latest handler without re-arming the trap.
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'));

    focusable()[0]?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
    // Deliberately NOT depending on onClose — see note above.
  }, [active]);
  return ref;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone,
  labelledBy,
  layer = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: Tone;
  labelledBy?: string;
  layer?: 'default' | 'call';
}) {
  const trapRef = useFocusTrap(open, onClose);
  const generatedId = useId();
  const titleId = labelledBy ?? `dialog-${generatedId}`;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  } as const;

  const content = (
    <div className={cn("fixed inset-0 flex items-end justify-center sm:items-center", layer === 'call' ? 'z-[80]' : 'z-50')}>
      <div
        className="absolute inset-0 animate-fade-in bg-ink-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative z-10 w-full animate-sheet-up overflow-hidden rounded-t-3xl bg-white shadow-overlay sm:animate-scale-in sm:rounded-3xl',
          widths[size],
          'max-h-[92vh] overflow-y-auto sr-scroll',
        )}
      >
        <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', tone ? TONES[tone].surface : '')}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold tracking-tight text-ink-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-500 transition-state hover:bg-ink-100 hover:text-ink-700"
          >
            <X size={18} />
          </button>
        </div>
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {footer ? <div className="sr-divide flex flex-wrap gap-2 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
  return layer === 'call' ? createPortal(content, document.body) : content;
}

/* ----------------------------------------------------------------- */
/* Form fields                                                       */
/* ----------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-800">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] font-medium text-critical-700">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-400 transition-state focus:border-brand-400 focus:ring-4 focus:ring-brand-500/15 focus-visible:ring-0';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(controlBase, 'h-11', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(controlBase, 'h-11 appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(controlBase, 'py-2.5 leading-relaxed', className)} {...rest} />;
  },
);

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-4 py-3',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-ink-800">{label}</span>
        {description ? <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-state',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-state',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}

/** Radio group rendered as large, touch-friendly choice cards. */
export function ChoiceGroup<T extends string | number>({
  value,
  options,
  onChange,
  columns = 2,
  name,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
  columns?: 1 | 2 | 3 | 4;
  name: string;
  size?: 'sm' | 'md';
}) {
  const gridCols = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[columns];
  return (
    <div role="radiogroup" className={cn('grid gap-2', gridCols)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-xl border text-left transition-state',
              size === 'sm' ? 'px-3 py-2' : 'px-3.5 py-2.5',
              selected
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
            )}
          >
            <span className={cn('block font-semibold', selected ? 'text-brand-800' : 'text-ink-800', size === 'sm' ? 'text-[13px]' : 'text-sm')}>
              {option.label}
            </span>
            {option.hint ? (
              <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{option.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Segmented control                                                 */
/* ----------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-xl bg-ink-100 p-1', className)} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg font-semibold transition-state',
              size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[13px]',
              selected ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Empty / loading states                                            */
/* ----------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-ink-300 bg-white/60 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-ink-800">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-soft-pulse rounded-lg bg-ink-200/70', className)} />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-ink-200 bg-white px-4 py-6">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
      <span className="text-sm font-medium text-ink-600">{label}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Inline disclosure (used for "Why this score?")                     */
/* ----------------------------------------------------------------- */

export function Disclosure({
  summary,
  children,
  tone = 'neutral',
  open,
  onToggle,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  tone?: Tone;
  open?: boolean;
  onToggle?: (next: boolean) => void;
  className?: string;
}) {
  const [internal, setInternal] = useState(false);
  const isOpen = open ?? internal;
  const toggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setInternal(next);
  };
  const t = TONES[tone];
  const id = useId();
  return (
    <div className={cn('overflow-hidden rounded-xl border', t.border, t.surface, className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={`disclosure-${id}`}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="text-[13px] font-semibold text-ink-800">{summary}</span>
        <span className={cn('text-ink-500 transition-transform duration-200', isOpen && 'rotate-180')} aria-hidden>
          ▾
        </span>
      </button>
      {isOpen ? (
        <div id={`disclosure-${id}`} className="animate-fade-in border-t border-white/60 px-3.5 py-3 text-[13px] leading-relaxed text-ink-700">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Tabs                                                              */
/* ----------------------------------------------------------------- */

const TabsContext = createContext<{ value: string; setValue: (v: string) => void } | null>(null);

export function Tabs({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useMemo(() => ({ value, setValue: onChange }), [value, onChange]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto sr-scroll', className)}>
      {children}
    </div>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsContext);
  const selected = ctx?.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => ctx?.setValue(value)}
      className={cn(
        'shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-state',
        selected ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
      )}
    >
      {children}
    </button>
  );
}
