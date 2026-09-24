import type {
  EventSeverity,
  GeoPoint,
  JourneyEvent,
  JourneyEventType,
  TimelineSummary,
} from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { enqueue } from './outbox';

/**
 * The secure event timeline.
 *
 * Every meaningful thing that happens — journey start, checkpoint, deviation,
 * check-in, SOS, report submission, sync result, notification outcome — is
 * written here first, on the device. The timeline is the audit trail the user
 * owns, and it is what the guardian snapshot and admin view are built from, so
 * events are append-only and carry their severity explicitly.
 */

const SEVERITY_BY_TYPE: Partial<Record<JourneyEventType, EventSeverity>> = {
  journey_started: 'notice',
  journey_completed: 'info',
  journey_cancelled: 'notice',
  checkpoint_reached: 'info',
  checkpoint_missed: 'warning',
  route_deviation: 'warning',
  deviation_cleared: 'info',
  checkin_prompted: 'notice',
  checkin_confirmed_safe: 'info',
  checkin_declined: 'critical',
  checkin_timed_out: 'warning',
  sos_triggered: 'critical',
  sos_cancelled: 'notice',
  sos_delivered: 'notice',
  sos_delivery_failed: 'critical',
  alert_queued: 'warning',
  guardian_notified: 'notice',
  guardian_share_created: 'info',
  guardian_share_revoked: 'info',
  report_created: 'notice',
  report_submitted: 'notice',
  report_acknowledged: 'info',
  report_timeout: 'warning',
  report_fallback_opened: 'warning',
  report_synced: 'info',
  report_failed: 'warning',
  gps_lost: 'warning',
  sync_failed: 'warning',
  risk_updated: 'notice',
  permission_changed: 'notice',
  monitoring_stopped: 'notice',
  data_erased: 'warning',
};

export const EVENT_PRESENTATION: Record<JourneyEventType, { label: string; icon: string }> = {
  journey_created: { label: 'Journey created', icon: 'route' },
  journey_started: { label: 'Journey started', icon: 'play' },
  journey_paused: { label: 'Monitoring paused', icon: 'pause' },
  journey_resumed: { label: 'Monitoring resumed', icon: 'play' },
  journey_completed: { label: 'Journey completed', icon: 'flag' },
  journey_cancelled: { label: 'Journey cancelled', icon: 'x' },
  checkpoint_reached: { label: 'Checkpoint reached', icon: 'check' },
  checkpoint_missed: { label: 'Checkpoint missed', icon: 'alert' },
  checkpoint_skipped: { label: 'Checkpoint skipped', icon: 'skip' },
  route_deviation: { label: 'Off the planned route', icon: 'map' },
  deviation_cleared: { label: 'Back on route', icon: 'map' },
  checkin_prompted: { label: 'Safety check-in asked', icon: 'message' },
  checkin_confirmed_safe: { label: 'Confirmed safe', icon: 'shield' },
  checkin_declined: { label: 'Answered: not safe', icon: 'siren' },
  checkin_timed_out: { label: 'Check-in unanswered', icon: 'clock' },
  risk_updated: { label: 'Risk indicator updated', icon: 'activity' },
  sos_triggered: { label: 'SOS triggered', icon: 'siren' },
  sos_cancelled: { label: 'SOS cancelled', icon: 'shield' },
  sos_delivered: { label: 'Alert reached the server', icon: 'cloud' },
  sos_delivery_failed: { label: 'Alert delivery failed', icon: 'cloud-off' },
  alert_queued: { label: 'Alert queued on this device', icon: 'clock' },
  guardian_notified: { label: 'Trusted contacts notified', icon: 'users' },
  guardian_share_created: { label: 'Guardian link created', icon: 'link' },
  guardian_share_revoked: { label: 'Guardian link revoked', icon: 'unlink' },
  report_created: { label: 'Report written', icon: 'file' },
  report_submitted: { label: 'Report sent', icon: 'send' },
  report_acknowledged: { label: 'Report acknowledged', icon: 'check-circle' },
  report_timeout: { label: 'No acknowledgement in 30 s', icon: 'clock' },
  report_fallback_opened: { label: 'Reporting website opened', icon: 'external' },
  report_synced: { label: 'Report synced', icon: 'refresh' },
  report_failed: { label: 'Report delivery failed', icon: 'alert' },
  location_updated: { label: 'Location recorded', icon: 'pin' },
  gps_lost: { label: 'GPS signal lost', icon: 'satellite' },
  connectivity_changed: { label: 'Connectivity changed', icon: 'wifi' },
  sync_completed: { label: 'Sync completed', icon: 'refresh' },
  sync_failed: { label: 'Sync failed', icon: 'alert' },
  notification_shown: { label: 'Notification', icon: 'bell' },
  session_started: { label: 'Signed in', icon: 'user' },
  offline_ready: { label: 'Offline data ready', icon: 'download' },
  permission_changed: { label: 'Permission changed', icon: 'lock' },
  emergency_contact_dialled: { label: 'Emergency number dialled', icon: 'phone' },
  sms_handoff_opened: { label: 'SMS handoff opened', icon: 'message' },
  monitoring_stopped: { label: 'Monitoring stopped', icon: 'pause' },
  data_exported: { label: 'Data exported', icon: 'download' },
  data_erased: { label: 'Local data erased', icon: 'trash' },
};

export interface RecordEventInput {
  ownerId: string;
  journeyId?: string;
  type: JourneyEventType;
  message: string;
  severity?: EventSeverity;
  location?: GeoPoint;
  riskScore?: number;
  data?: Record<string, unknown>;
  createdAt?: string;
  /** Skip the sync queue (used by the sync engine itself to avoid recursion). */
  localOnly?: boolean;
  isDemo?: boolean;
}

export async function recordEvent(input: RecordEventInput): Promise<JourneyEvent> {
  const event: JourneyEvent = {
    id: uuid(),
    ownerId: input.ownerId,
    journeyId: input.journeyId,
    type: input.type,
    severity: input.severity ?? SEVERITY_BY_TYPE[input.type] ?? 'info',
    message: input.message,
    location: input.location,
    riskScore: input.riskScore,
    data: input.data,
    createdAt: input.createdAt ?? new Date().toISOString(),
    isDemo: input.isDemo,
  };

  await db.events.put(event);

  if (!input.localOnly) {
    await enqueue({
      ownerId: input.ownerId,
      kind: 'event',
      priority: event.severity === 'critical' ? 90 : 30,
      endpoint: '/events',
      method: 'POST',
      body: { events: [serialiseEvent(event)] },
      dedupeKey: `event:${event.id}`,
    });
  }

  return event;
}

export function serialiseEvent(event: JourneyEvent): Record<string, unknown> {
  return {
    id: event.id,
    ownerId: event.ownerId,
    journeyId: event.journeyId,
    type: event.type,
    severity: event.severity,
    message: event.message,
    location: event.location,
    riskScore: event.riskScore,
    data: event.data,
    createdAt: event.createdAt,
  };
}

export async function listEvents(options: {
  ownerId: string;
  journeyId?: string;
  limit?: number;
}): Promise<JourneyEvent[]> {
  const rows = options.journeyId
    ? await db.events.where('journeyId').equals(options.journeyId).toArray()
    : await db.events.where('ownerId').equals(options.ownerId).toArray();

  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, options.limit ?? 200);
}

export function buildTimelineSummary(events: JourneyEvent[]): TimelineSummary {
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const byType: TimelineSummary['byType'] = {};
  for (const event of sorted) byType[event.type] = (byType[event.type] ?? 0) + 1;

  return {
    total: sorted.length,
    critical: sorted.filter((event) => event.severity === 'critical').length,
    warnings: sorted.filter((event) => event.severity === 'warning').length,
    notices: sorted.filter((event) => event.severity === 'notice').length,
    firstAt: sorted[0]?.createdAt,
    lastAt: sorted[sorted.length - 1]?.createdAt,
    byType,
  };
}

export function timelineHeadline(events: JourneyEvent[]): string {
  const summary = buildTimelineSummary(events);
  if (summary.total === 0) return 'No events recorded yet';
  if (summary.critical) return `${summary.critical} critical event(s) recorded`;
  if (summary.warnings) return `${summary.warnings} warning(s), nothing critical`;
  return `${summary.total} event(s), all routine`;
}

export async function deleteEventsForJourney(journeyId: string): Promise<number> {
  const keys = await db.events.where('journeyId').equals(journeyId).primaryKeys();
  await db.events.bulkDelete(keys);
  return keys.length;
}

export function severityMeta(severity: EventSeverity): {
  label: string;
  dotClass: string;
  badgeVariant: 'muted' | 'info' | 'warning' | 'danger';
} {
  switch (severity) {
    case 'critical':
      return { label: 'Critical', dotClass: 'bg-red-500', badgeVariant: 'danger' };
    case 'warning':
      return { label: 'Warning', dotClass: 'bg-amber-500', badgeVariant: 'warning' };
    case 'notice':
      return { label: 'Notice', dotClass: 'bg-sky-500', badgeVariant: 'info' };
    default:
      return { label: 'Info', dotClass: 'bg-slate-400', badgeVariant: 'muted' };
  }
}
