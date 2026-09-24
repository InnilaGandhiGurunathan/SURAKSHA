import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  BellRing,
  CheckCheck,
  FileWarning,
  Siren,
  Trash2,
  Users,
} from 'lucide-react';
import type { AppNotification, UserProfile } from '@suraksha/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, InfoNote, SectionHeader } from '@/components/StatusPieces';
import { ConfirmDialog } from '@/components/ui/overlay';
import { formatRelative } from '@/lib/format';
import {
  NOTIFICATION_KIND_META,
  clearNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationSupport,
  requestNotificationPermission,
} from '@/services/notifications';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Notification inbox.
 *
 * The in-app inbox is the source of truth and works entirely offline; system
 * notifications are an extra when the browser allows them. This screen says
 * which of those two is currently in effect instead of assuming the user is
 * getting alerts.
 */
const KIND_ICON = {
  checkin: BellRing,
  risk: Activity,
  journey: Activity,
  report: FileWarning,
  guardian: Users,
  system: BellRing,
  sos: Siren,
} as const;

export function NotificationsScreen({ user }: { user: UserProfile }) {
  const notifications = useLiveQuery(async () => listNotifications(user.id, 120), [user.id], undefined);
  const [busy, setBusy] = useState(false);
  const support = notificationSupport();

  const unread = (notifications ?? []).filter((item) => !item.readAt);

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="Notifications"
        description="Kept on this device, so nothing is lost when system notifications are blocked."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              disabled={unread.length === 0}
              onClick={async () => {
                setBusy(true);
                const count = await markAllNotificationsRead(user.id);
                setBusy(false);
                toast.success(`${count} notification(s) marked as read.`);
              }}
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-destructive" disabled={(notifications ?? []).length === 0}>
                  <Trash2 className="size-3.5" />
                  Clear
                </Button>
              }
              title="Clear all notifications on this device?"
              description="The inbox is emptied locally. Journey timelines and reports are not affected."
              confirmLabel="Clear inbox"
              onConfirm={async () => {
                await clearNotifications(user.id);
                toast.success('Inbox cleared on this device.');
              }}
            />
          </div>
        }
      />

      {support.permission !== 'granted' ? (
        <InfoNote
          tone={support.permission === 'denied' ? 'warning' : 'info'}
          title="System notifications"
          actions={
            support.permission === 'default' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const result = await requestNotificationPermission();
                  toast.message(result.message);
                }}
              >
                Enable system notifications
              </Button>
            ) : undefined
          }
        >
          <p>
            {support.message} {support.remedy}
          </p>
        </InfoNote>
      ) : null}

      {!notifications ? (
        <p className="text-xs text-muted-foreground">Reading your inbox from this device…</p>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<BellRing className="size-5" />}
          title="Nothing in your inbox"
          description="Check-ins, escalations, SOS outcomes, report delivery results and guardian activity all land here."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </ul>
      )}

      <InfoNote tone="muted" title="What you will and will not get told">
        <ul className="list-inside list-disc space-y-0.5">
          <li>Delivery results are reported only from real server acknowledgements.</li>
          <li>A missed checkpoint alone never produces an “alert sent” notification, because nothing is sent.</li>
          <li>
            If the phone is off or has no GPS, monitoring stops — and SURAKSHA cannot notify you about that from the
            device that is switched off.
          </li>
        </ul>
      </InfoNote>
    </div>
  );
}

function NotificationRow({ notification }: { notification: AppNotification }) {
  const meta = NOTIFICATION_KIND_META[notification.kind];
  const Icon = KIND_ICON[notification.kind] ?? BellRing;
  const unread = !notification.readAt;

  const toneClass =
    notification.severity === 'critical'
      ? 'border-red-500/45 bg-red-500/5'
      : notification.severity === 'warning'
        ? 'border-amber-500/40'
        : 'border-border';

  return (
    <li>
      <Card className={cn(toneClass, unread && 'bg-card/95')}>
        <CardContent className="flex items-start gap-3 pt-5">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl',
              notification.severity === 'critical'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : notification.severity === 'warning'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn('text-xs', unread ? 'font-semibold' : 'font-medium text-muted-foreground')}>
                {notification.title}
              </p>
              <Badge variant="muted">{meta.label}</Badge>
              {unread ? <span className="size-2 rounded-full bg-accent" aria-label="unread" /> : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{notification.body}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>{formatRelative(notification.createdAt)}</span>
              {notification.actionUrl ? (
                <Link to={notification.actionUrl} className="text-accent underline">
                  Open
                </Link>
              ) : null}
              {unread ? (
                <button
                  type="button"
                  className="underline"
                  onClick={() => void markNotificationRead(notification.id)}
                >
                  Mark read
                </button>
              ) : null}
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  await db.notifications.delete(notification.id);
                  toast.success('Notification removed.');
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

export default NotificationsScreen;
