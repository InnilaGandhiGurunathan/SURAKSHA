import type { TrustedContact } from '@suraksha/shared';
import { db } from '@/lib/db';
import { uuid } from '@/lib/id';
import { enqueue, PRIORITY } from './outbox';

/**
 * Trusted contacts.
 *
 * Contacts are the user's data, stored on the device and used by the escalation
 * paths only with explicit, per-contact permissions:
 * `canReceiveAlerts`, `canViewJourney`, `canSeeLiveLocation`. Nothing is shared
 * purely because someone is in the list.
 */

export interface ContactInput {
  ownerId: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  notes?: string;
  isPrimary?: boolean;
  priority?: number;
  canReceiveAlerts?: boolean;
  canViewJourney?: boolean;
  canSeeLiveLocation?: boolean;
  isDemo?: boolean;
}

export function normalisePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function isValidPhone(phone: string): boolean {
  const digits = normalisePhone(phone).replace(/\+/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

export async function createContact(input: ContactInput): Promise<TrustedContact> {
  const now = new Date().toISOString();
  const existing = await db.contacts.where('ownerId').equals(input.ownerId).toArray();

  const contact: TrustedContact = {
    id: uuid(),
    ownerId: input.ownerId,
    name: input.name.trim(),
    relationship: input.relationship.trim() || 'Trusted contact',
    phone: normalisePhone(input.phone),
    email: input.email?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    canReceiveAlerts: input.canReceiveAlerts ?? true,
    canViewJourney: input.canViewJourney ?? true,
    canSeeLiveLocation: input.canSeeLiveLocation ?? false,
    isPrimary: input.isPrimary ?? existing.length === 0,
    priority: input.priority ?? existing.length + 1,
    createdAt: now,
    updatedAt: now,
    isDemo: input.isDemo,
  };

  // Exactly one primary contact at a time.
  if (contact.isPrimary) {
    await Promise.all(
      existing
        .filter((item) => item.isPrimary)
        .map((item) => db.contacts.update(item.id, { isPrimary: false, updatedAt: now })),
    );
  }

  await db.contacts.put(contact);
  await queueContact(contact);
  return contact;
}

export async function updateContact(id: string, patch: Partial<TrustedContact>): Promise<TrustedContact | undefined> {
  const now = new Date().toISOString();
  const current = await db.contacts.get(id);
  if (!current) return undefined;

  const next: TrustedContact = {
    ...current,
    ...patch,
    phone: patch.phone ? normalisePhone(patch.phone) : current.phone,
    updatedAt: now,
  };

  if (patch.isPrimary) {
    const others = await db.contacts.where('ownerId').equals(current.ownerId).toArray();
    await Promise.all(
      others
        .filter((item) => item.id !== id && item.isPrimary)
        .map((item) => db.contacts.update(item.id, { isPrimary: false, updatedAt: now })),
    );
  }

  await db.contacts.put(next);
  await queueContact(next);
  return next;
}

export async function deleteContact(id: string): Promise<void> {
  const contact = await db.contacts.get(id);
  await db.contacts.delete(id);
  if (!contact) return;

  // Revoke any guardian share that belonged to the removed contact.
  const shares = await db.shares.where('ownerId').equals(contact.ownerId).toArray();
  const affected = shares.filter((share) => share.contactId === id && share.status === 'active');
  for (const share of affected) {
    await db.shares.update(share.id, { status: 'revoked', updatedAt: new Date().toISOString() });
    await enqueue({
      ownerId: contact.ownerId,
      kind: 'share',
      priority: PRIORITY.share,
      endpoint: `/shares/${share.token}/revoke`,
      method: 'POST',
      body: { reason: 'contact_removed' },
      dedupeKey: `share-revoke:${share.id}`,
    });
  }
}

export async function listContacts(ownerId: string): Promise<TrustedContact[]> {
  const rows = await db.contacts.where('ownerId').equals(ownerId).toArray();
  return rows.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.priority - b.priority;
  });
}

export function primaryContact(contacts: TrustedContact[]): TrustedContact | undefined {
  return contacts.find((contact) => contact.isPrimary) ?? contacts[0];
}

export async function contactsForJourney(ownerId: string, journeyId: string): Promise<TrustedContact[]> {
  const journey = await db.journeys.get(journeyId);
  const all = await listContacts(ownerId);
  if (!journey || journey.guardianContactIds.length === 0) return all.filter((contact) => contact.canReceiveAlerts);
  return all.filter((contact) => journey.guardianContactIds.includes(contact.id));
}

export async function setJourneyContacts(journeyId: string, contactIds: string[]): Promise<void> {
  await db.journeys.update(journeyId, {
    guardianContactIds: contactIds,
    updatedAt: new Date().toISOString(),
  });
}

async function queueContact(contact: TrustedContact): Promise<void> {
  await enqueue({
    ownerId: contact.ownerId,
    kind: 'contact',
    priority: PRIORITY.contact,
    endpoint: '/contacts',
    method: 'POST',
    body: {
      id: contact.id,
      ownerId: contact.ownerId,
      name: contact.name,
      relationship: contact.relationship,
      // Phone numbers reach the server only because alerts must be able to leave
      // the device through the SMS gateway; nothing else ever does.
      phone: contact.phone,
      email: contact.email,
      canReceiveAlerts: contact.canReceiveAlerts,
      canViewJourney: contact.canViewJourney,
      canSeeLiveLocation: contact.canSeeLiveLocation,
      priority: contact.priority,
    },
    dedupeKey: `contact:${contact.id}`,
  });
}

export interface ContactValidation {
  ok: boolean;
  errors: Partial<Record<'name' | 'phone' | 'email', string>>;
}

export function validateContactInput(input: { name: string; phone: string; email?: string }): ContactValidation {
  const errors: ContactValidation['errors'] = {};
  if (input.name.trim().length < 2) errors.name = 'Enter the name you would recognise in a hurry.';
  if (!isValidPhone(input.phone)) {
    errors.phone = 'Enter a reachable phone number, including the country code if it is not local.';
  }
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    errors.email = 'That email address does not look right.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
