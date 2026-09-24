import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/** Card surfaces with the subtle navy/teal treatment used across the app. */
export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { tone?: 'default' | 'danger' | 'warning' | 'success' | 'info' }>(
  ({ className, tone = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border bg-card text-card-foreground shadow-[var(--shadow-card)] transition-colors',
        tone === 'default' && 'border-border',
        tone === 'danger' && 'border-red-500/45',
        tone === 'warning' && 'border-amber-500/45',
        tone === 'success' && 'border-emerald-500/40',
        tone === 'info' && 'border-sky-500/35',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 px-4 pt-4 sm:px-5 sm:pt-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold leading-tight tracking-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-4 py-4 sm:px-5', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2 px-4 pb-4 sm:px-5', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
