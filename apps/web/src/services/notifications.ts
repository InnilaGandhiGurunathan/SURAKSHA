import type { AppNotification, EventSeverity, NotificationKind } from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { requestNotificationPermission as requestPermission } from '@/lib/permissions';

/**
 * Local notifications.
 *
 * SURAKSHA keeps its own inbox in IndexedDB, so the user never loses a safety
 * message because a browser notification was blocked. Web Notifications are an
 * *addition*: when permission is missing the inbox still records the event and
 * the UI says that the system notification did not appear.
 */

export async function pushNotification(input: {
  ownerId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  severity?: EventSeverity;
  journeyId?: string;
  reportId?: string;
  actionUrl?: string;
  isDemo?: boolean;
  /** Also try a system notification when permission allows it. */
  system?: boolean;
}): Promise<AppNotification> {
  const notification: AppNotification = {
    id: uuid(),
    ownerId: input.ownerId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    severity: input.severity ?? 'notice',
    journeyId: input.journeyId,
    reportId: input.reportId,
    actionUrl: input.actionUrl,
    createdAt: new Date().toISOString(),
    isDemo: input.isDemo,
  };

  await db.notifications.put(notification);

  if (input.system !== false) {
    await showSystemNotification(notification);
  }

  return notification;
}

async function showSystemNotification(notification: AppNotification): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const options: NotificationOptions = {
      body: notification.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: notification.id,
      data: { url: notification.actionUrl ?? '/app/notifications', id: notification.id },
      requireInteraction: notification.severity === 'critical',
    };

    if (registration?.showNotification) {
      await registration.showNotification(notification.title, options);
      return true;
    }
    new Notification(notification.title, options);
    return true;
  } catch {
    // Blocked, or the page is not allowed to show notifications right now. The
    // inbox copy is the source of truth either way.
    return false;
  }
}

export async function listNotifications(ownerId: string, limit = 100): Promise<AppNotification[]> {
  const rows = await db.notifications.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}

export async function unreadCount(ownerId: string): Promise<number> {
  const rows = await db.notifications.where('ownerId').equals(ownerId).toArray();
  return rows.filter((notification) => !notification.readAt).length;
}

export async function markNotificationRead(id: string): Promise<void> {
  await db.notifications.update(id, { readAt: new Date().toISOString() });
}

export async function markAllNotificationsRead(ownerId: string): Promise<number> {
  const rows = await db.notifications.where('ownerId').equals(ownerId).toArray();
  const unread = rows.filter((notification) => !notification.readAt);
  await Promise.all(
    unread.map((notification) =>
      db.notifications.update(notification.id, { readAt: new Date().toISOString() }),
    ),
  );
  return unread.length;
}

export async function clearNotifications(ownerId: string): Promise<void> {
  const keys = await db.notifications.where('ownerId').equals(ownerId).primaryKeys();
  await db.notifications.bulkDelete(keys);
}

export interface NotificationSupport {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  serviceWorker: boolean;
  message: string;
  remedy: string;
}

export function notificationSupport(): NotificationSupport {
  if (!('Notification' in window)) {
    return {
      supported: false,
      permission: 'unsupported',
      serviceWorker: 'serviceWorker' in navigator,
      message: 'This browser does not support system notifications.',
      remedy: 'SURAKSHA still keeps every safety message in the in-app inbox.',
    };
  }

  const permission = Notification.permission;
  return {
    supported: true,
    permission,
    serviceWorker: 'serviceWorker' in navigator,
    message:
      permission === 'granted'
        ? 'System notifications are enabled.'
        : permission === 'denied'
          ? 'System notifications are blocked for this app.'
          : 'System notifications have not been allowed yet.',
    remedy:
      permission === 'granted'
        ? 'Alerts also stay in the in-app inbox.'
        : permission === 'denied'
          ? 'Enable notifications for SURAKSHA in your browser or phone settings. Until then, alerts appear in the app inbox only.'
          : 'Allow notifications so check-ins and alerts can reach you when the app is in the background.',
  };
}

export async function requestNotificationPermission(): Promise<{
  permission: NotificationPermission | 'unsupported';
  message: string;
}> {
  const state = await requestPermission();
  if (state === 'granted') return { permission: 'granted', message: 'Notifications enabled on this device.' };
  if (state === 'denied') {
    return {
      permission: 'denied',
      message: 'Notifications were blocked. You can re-enable them in your browser settings.',
    };
  }
  if (state === 'unsupported') {
    return { permission: 'unsupported', message: 'This browser has no notification support.' };
  }
  return { permission: 'default', message: 'Notification permission was not granted.' };
}

/** Vibration is used for SOS and critical escalations only — never for chatter. */
export function vibrate(pattern: number | number[] = [120, 60, 120]): boolean {
  try {
    if (typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  { label: string; tone: 'info' | 'warn' | 'bad' | 'ok' }
> = {
  checkin: { label: 'Safety check-in', tone: 'warn' },
  risk: { label: 'Risk indicator', tone: 'warn' },
  journey: { label: 'Journey', tone: 'info' },
  report: { label: 'Incident report', tone: 'info' },
  guardian: { label: 'Guardian', tone: 'info' },
  system: { label: 'System', tone: 'info' },
  sos: { label: 'Emergency', tone: 'bad' },
};
