import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        accent: 'border-transparent bg-accent text-accent-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        warning: 'border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-300',
        danger: 'border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300',
        info: 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300',
        safe: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        low: 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300',
        medium: 'border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-300',
        high: 'border-orange-500/45 bg-orange-500/15 text-orange-700 dark:text-orange-300',
        critical: 'border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function RiskBadge({
  band,
  score,
  className,
  showScore = true,
}: {
  band: string;
  score?: number;
  className?: string;
  showScore?: boolean;
}) {
  const variant =
    band === 'critical'
      ? 'critical'
      : band === 'high'
        ? 'high'
        : band === 'medium'
          ? 'medium'
          : band === 'low'
            ? 'low'
            : 'safe';

  return (
    <Badge variant={variant} className={className}>
      <span aria-hidden>●</span>
      {band.charAt(0).toUpperCase() + band.slice(1)}
      {showScore && score !== undefined ? ` · ${score}/100` : ''}
    </Badge>
  );
}

export { badgeVariants };
