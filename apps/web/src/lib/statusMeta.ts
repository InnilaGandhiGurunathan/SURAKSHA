import type { JourneyStatus, ReportStatus } from '@suraksha/shared';

/** Presentation metadata for journey statuses (single source of truth). */
export const JOURNEY_STATUS_META: Record<
  JourneyStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'accent' | 'success' | 'warning' | 'danger' | 'muted';
    iconClass: string;
  }
> = {
  planned: { label: 'Planned', variant: 'outline', iconClass: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  active: { label: 'Monitoring', variant: 'success', iconClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  paused: { label: 'Paused', variant: 'warning', iconClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  completed: { label: 'Completed', variant: 'accent', iconClass: 'bg-teal-500/12 text-teal-600 dark:text-teal-400' },
  cancelled: { label: 'Cancelled', variant: 'muted', iconClass: 'bg-muted text-muted-foreground' },
  escalated: { label: 'Escalated', variant: 'danger', iconClass: 'bg-red-500/15 text-red-600 dark:text-red-400' },
};

export const REPORT_STATUS_META: Record<
  ReportStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'accent' | 'success' | 'warning' | 'danger' | 'muted' }
> = {
  draft: { label: 'Draft', variant: 'muted' },
  queued: { label: 'Queued offline', variant: 'outline' },
  submitting: { label: 'Sending…', variant: 'accent' },
  submitted: { label: 'Received', variant: 'success' },
  acknowledged: { label: 'Acknowledged', variant: 'success' },
  timeout: { label: 'No acknowledgement', variant: 'warning' },
  fallback_opened: { label: 'Fallback opened', variant: 'warning' },
  synced: { label: 'Synced', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  verified: { label: 'Verified', variant: 'success' },
  rejected: { label: 'Not accepted', variant: 'danger' },
};

export const SEVERITY_META: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'outline' }
> = {
  low: { label: 'Low', variant: 'muted' },
  medium: { label: 'Medium', variant: 'warning' },
  high: { label: 'High', variant: 'danger' },
  critical: { label: 'Critical', variant: 'danger' },
};
