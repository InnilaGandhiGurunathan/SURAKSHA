/**
 * BrandLogo — SURAKSHA brand mark.
 *
 * Renders the custom S-road compass-shield logo. Works in two shapes:
 *  - "mark"  — just the emblem (use inside buttons, nav, avatars).
 *  - "full"  — emblem + "SURAKSHA" wordmark + tagline (hero/headers/loading).
 */
import { cn } from '@/lib/cn';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<Size, { box: string; mark: number; text: string; tag: string }> = {
  xs: { box: 'h-7 w-7', mark: 28, text: 'text-[12px]', tag: 'text-[8.5px]' },
  sm: { box: 'h-8 w-8', mark: 32, text: 'text-[13.5px]', tag: 'text-[9.5px]' },
  md: { box: 'h-9 w-9', mark: 36, text: 'text-[15px]', tag: 'text-[10.5px]' },
  lg: { box: 'h-11 w-11', mark: 44, text: 'text-[17px]', tag: 'text-[11px]' },
  xl: { box: 'h-12 w-12', mark: 48, text: 'text-[20px]', tag: 'text-[11px]' },
};

export function BrandLogo({
  size = 'md',
  variant = 'mark',
  className,
  markClassName,
  showTagline = true,
  invert = false,
}: {
  size?: Size;
  variant?: 'mark' | 'full';
  className?: string;
  markClassName?: string;
  showTagline?: boolean;
  /** Invert word colour for dark backgrounds (the SVG mark stays true colour). */
  invert?: boolean;
}) {
  const s = SIZE_MAP[size];

  const mark = (
    <img
      src="/logo.svg"
      alt=""
      width={s.mark}
      height={s.mark}
      className={cn('block shrink-0 rounded-md', markClassName)}
      style={{ width: s.mark, height: s.mark }}
      aria-hidden
    />
  );

  if (variant === 'mark') {
    return <span className={cn('inline-flex items-center justify-center', className)}>{mark}</span>;
  }

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {mark}
      <span className="min-w-0 leading-none">
        <span
          className={cn(
            'block font-extrabold tracking-tight',
            s.text,
            invert ? 'text-white' : 'text-ink-900',
          )}
        >
          SURAKSHA
        </span>
        {showTagline ? (
          <span
            className={cn(
              'mt-0.5 block font-semibold uppercase tracking-[0.14em]',
              s.tag,
              invert ? 'text-ink-300' : 'text-ink-400',
            )}
          >
            Safety Before SOS
          </span>
        ) : null}
      </span>
    </span>
  );
}
