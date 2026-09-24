import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------- Separator -------------------------------- */

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------- Skeleton -------------------------------- */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton rounded-xl', className)} aria-hidden {...props} />;
}

/* -------------------------------- Progress -------------------------------- */

export function Progress({
  value = 0,
  className,
  tone = 'accent',
  label,
}: {
  value?: number;
  className?: string;
  tone?: 'accent' | 'danger' | 'warning' | 'success';
  label?: string;
}) {
  const toneClass = {
    accent: 'bg-accent',
    danger: 'bg-red-500',
    warning: 'bg-amber-500',
    success: 'bg-emerald-500',
  }[tone];

  return (
    <ProgressPrimitive.Root
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      value={Math.max(0, Math.min(100, value))}
      aria-label={label}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', toneClass)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* --------------------------------- Switch --------------------------------- */

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted-foreground/35',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

/* -------------------------------- Checkbox -------------------------------- */

export function Checkbox({ className, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-5 shrink-0 rounded-md border border-border bg-transparent transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-accent-foreground">
        {props.checked === 'indeterminate' ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* ------------------------------- Radio group ------------------------------ */

export const RadioGroup = RadioGroupPrimitive.Root;

export function RadioOption({
  value,
  label,
  description,
  disabled,
  className,
}: {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card/50 p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent/10',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <RadioGroupPrimitive.Item
        value={value}
        disabled={disabled}
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border data-[state=checked]:border-accent"
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-accent" />
      </RadioGroupPrimitive.Item>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

/* ------------------------------- Scroll area ------------------------------- */

export function ScrollArea({
  className,
  children,
  viewportClassName,
}: {
  className?: string;
  children: React.ReactNode;
  viewportClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className={cn('size-full rounded-[inherit]', viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

/* --------------------------------- Avatar --------------------------------- */

export function Avatar({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <AvatarPrimitive.Root
      className={cn(
        'grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-teal-600 to-navy-700 text-xs font-bold text-white',
        className,
      )}
    >
      <AvatarPrimitive.Fallback>{initials || '?'}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* -------------------------------- Tooltip --------------------------------- */

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-[260px] rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-[var(--shadow-float)]"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
