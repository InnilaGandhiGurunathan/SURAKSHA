import { cn } from '@/lib/utils';

/**
 * The SURAKSHA mark. Inline SVG (no network request) so it renders on the very
 * first paint, offline, and in the installed app.
 */
export function Shield({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={cn('shrink-0', animated && 'animate-shield-in', className)}
      role="img"
      aria-label="SURAKSHA shield"
    >
      <defs>
        <linearGradient id="surakshaGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0A1F44" />
          <stop offset="55%" stopColor="#0D9488" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
      </defs>
      <path d="M48 6 14 19v30c0 20.4 14.2 37.7 34 43 19.8-5.3 34-22.6 34-43V19L48 6Z" fill="url(#surakshaGrad)" />
      <path
        d="M48 14 21 24.4v24.6c0 16.4 11.2 30.4 27 35.1 15.8-4.7 27-18.7 27-35.1V24.4L48 14Z"
        fill="rgba(255,255,255,0.12)"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="2.5"
      />
      <path
        d="M31 48.5 43 60.5 65 38"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="72" cy="26" r="7" fill="#EF4444" stroke="#ffffff" strokeWidth="2.5" />
    </svg>
  );
}

export function BrandLockup({
  compact = false,
  className,
  tagline = 'Your Safety, Our Priority',
}: {
  compact?: boolean;
  className?: string;
  tagline?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Shield className={compact ? 'size-8' : 'size-10'} />
      <div className="leading-tight">
        <p className={cn('font-bold tracking-[0.2em]', compact ? 'text-sm' : 'text-base')}>SURAKSHA</p>
        {compact ? null : <p className="text-[10px] uppercase tracking-[0.14em] text-teal-500 dark:text-teal-300">{tagline}</p>}
      </div>
    </div>
  );
}
