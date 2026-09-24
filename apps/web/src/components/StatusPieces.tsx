import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Info,
  Loader2,
  Satellite,
  ShieldAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { useConnectivity } from '@/store/connectivity';

/* --------------------------- Connectivity & GPS --------------------------- */

export function ConnectivityPill({ className }: { className?: string }) {
  const { state, reachable, quality, checking } = useConnectivity();

  const offline = state === 'offline';
  const degraded = !offline && !reachable;
  const slow = !offline && reachable && quality === 'slow';

  return (
    <Badge
      variant={offline ? 'muted' : degraded ? 'warning' : slow ? 'info' : 'success'}
      className={cn('gap-1.5 py-1', className)}
      title={
        offline
          ? 'No connection. Everything continues on this device and syncs later.'
          : degraded
            ? 'The device reports a connection but the server cannot be reached.'
            : slow
              ? 'Connection is usable but slow.'
              : 'Connected and the reporting server is reachable.'
      }
    >
      {checking ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : offline ? (
        <WifiOff aria-hidden />
      ) : (
        <Wifi aria-hidden />
      )}
      {offline ? 'Offline' : degraded ? 'Server unreachable' : slow ? 'Slow link' : 'Online'}
    </Badge>
  );
}

export function GpsPill({
  quality,
  accuracyMeters,
  ageMs,
  className,
}: {
  quality: string;
  accuracyMeters?: number;
  ageMs?: number;
  className?: string;
}) {
  const weak = quality === 'poor' || quality === 'stale' || quality === 'none';
  const minutes = ageMs ? Math.round(ageMs / 60_000) : undefined;

  return (
    <Badge
      variant={quality === 'none' ? 'muted' : weak ? 'warning' : 'success'}
      className={cn('gap-1.5 py-1', className)}
      title={
        quality === 'none'
          ? 'No GPS fix yet.'
          : weak
            ? `Fix is ${quality}${accuracyMeters ? ` (±${Math.round(accuracyMeters)} m)` : ''}.`
            : `Fix is ${quality}${accuracyMeters ? ` (±${Math.round(accuracyMeters)} m)` : ''}.`
      }
    >
      <Satellite aria-hidden />
      {quality === 'none'
        ? 'No GPS'
        : quality === 'stale'
          ? `GPS ${minutes ? `${minutes} min old` : 'stale'}`
          : `GPS ${quality}${accuracyMeters ? ` ±${Math.round(accuracyMeters)} m` : ''}`}
    </Badge>
  );
}

/* ------------------------------- Status tile ------------------------------ */

export function StatusTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'info';
  icon?: ReactNode;
  className?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    ok: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
    info: 'text-sky-600 dark:text-sky-400',
  }[tone];

  return (
    <div className={cn('rounded-2xl border border-border bg-card/70 p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground/70">{icon}</span> : null}
      </div>
      <p className={cn('mt-1 text-lg font-bold leading-tight', toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------- Notes ---------------------------------- */

export function InfoNote({
  tone = 'info',
  title,
  children,
  className,
  actions,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'muted';
  title?: string;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const meta = {
    info: { icon: Info, cls: 'border-sky-500/35 bg-sky-500/10 text-sky-900 dark:text-sky-100' },
    warning: {
      icon: AlertTriangle,
      cls: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    },
    danger: { icon: ShieldAlert, cls: 'border-red-500/45 bg-red-500/10 text-red-900 dark:text-red-100' },
    success: {
      icon: CheckCircle2,
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    },
    muted: { icon: CloudOff, cls: 'border-border bg-muted/40 text-muted-foreground' },
  }[tone];

  const Icon = meta.icon;

  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3 py-2.5', meta.cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
        {title ? <p className="mb-0.5 text-xs font-semibold">{title}</p> : null}
        {children}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Kept as an alias so screens read naturally. */
export const InlineNotice = InfoNote;
export const Callout = InfoNote;

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center gap-2.5 py-8 text-center">
        {icon ? (
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
            {icon}
          </span>
        ) : null}
        <p className="text-sm font-semibold">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="mt-1.5">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Loading -------------------------------- */

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </p>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-16 rounded-xl" />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn('skeleton h-24 rounded-2xl', className)} aria-hidden />;
}

/* ------------------------------ Section header ---------------------------- */

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --------------------------- Disclaimers & footers ------------------------ */

export function Disclaimer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground', className)}>
      <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
