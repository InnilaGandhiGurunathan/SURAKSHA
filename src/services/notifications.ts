/**
 * Notification service.
 *
 * SURAKSHA never claims to have contacted emergency services. This service
 * models *trusted-circle* notifications (push / SMS / call to the primary and
 * backup guardian) and keeps a delivery log so the product can be honest about
 * who knows what, and when.
 *
 * A Firebase Cloud Messaging implementation would replace `deliver()`; the rest
 * of the app only depends on the returned `DeliveryReceipt`.
 */

import type { TrustedContact } from '@/domain/types';

export type Channel = 'push' | 'sms' | 'call';
export type DeliveryStatus = 'delivered' | 'queued' | 'skipped';

export interface DeliveryReceipt {
  id: string;
  contactId: string;
  contactName: string;
  channel: Channel;
  status: DeliveryStatus;
  at: number;
  title: string;
  body: string;
  /** Why a channel was skipped, so the UI can explain itself. */
  reason?: string;
}

export interface NotifyInput {
  contacts: TrustedContact[];
  title: string;
  body: string;
  urgent?: boolean;
  /** Deliver only to these contact ids (used by the escalation ladder). */
  only?: string[];
  /**
   * The moment the notification was sent, on the *simulator's* clock.
   *
   * This is required rather than defaulted on purpose. It used to be read from
   * `Date.now()` inside this service, which stamped every delivery log entry
   * with the wall clock while the rest of the app ran on the virtual clock —
   * so the receipt log showed a notification delivered "14 h ago" the instant
   * it appeared. The store owns the clock; pass it in.
   */
  at: number;
}

/**
 * Simulates delivery. Everything is local and synchronous-ish: the "network" is
 * a 120 ms delay so the UI can show a realistic queued → delivered transition.
 */
export function deliver(input: NotifyInput): DeliveryReceipt[] {
  const targets = input.only
    ? input.contacts.filter((c) => input.only!.includes(c.id))
    : input.contacts;

  return targets.flatMap((contact) => {
    if (contact.notifyBy.length === 0) {
      return [
        {
          id: `ntf-${contact.id}-${Date.now().toString(36)}`,
          contactId: contact.id,
          contactName: contact.name,
          channel: 'push' as Channel,
          status: 'skipped' as DeliveryStatus,
          at: input.at,
          title: input.title,
          body: input.body,
          reason: 'No notification channel enabled for this contact',
        },
      ];
    }

    return contact.notifyBy.map((channel, index) => ({
      id: `ntf-${contact.id}-${channel}-${Date.now().toString(36)}-${index}`,
      contactId: contact.id,
      contactName: contact.name,
      channel,
      status: (!contact.available && channel !== 'sms' ? 'queued' : 'delivered') as DeliveryStatus,
      // Slight stagger so the log reads like a fan-out, not one instant.
      at: input.at + index * 400,
      title: input.title,
      body: input.body,
      reason: contact.available ? undefined : `${contact.name} is marked unavailable — delivery queued`,
    }));
  });
}

export function summariseReceipts(receipts: DeliveryReceipt[]): string {
  const delivered = receipts.filter((r) => r.status === 'delivered');
  const queued = receipts.filter((r) => r.status === 'queued');
  const parts: string[] = [];
  if (delivered.length) {
    const names = [...new Set(delivered.map((r) => r.contactName))];
    parts.push(`Delivered to ${names.join(', ')}`);
  }
  if (queued.length) {
    const names = [...new Set(queued.map((r) => r.contactName))];
    parts.push(`Queued for ${names.join(', ')} (unavailable)`);
  }
  if (!parts.length) parts.push('No channel enabled — check Trusted Circle settings');
  return parts.join(' · ');
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  push: 'Push notification',
  sms: 'SMS',
  call: 'Automated call',
};
