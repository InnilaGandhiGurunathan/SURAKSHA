import type { TrustedContact, UserProfile } from '@suraksha/shared';
import { recordEvent } from './events';

/**
 * Dialling.
 *
 * A safety app should never place a call silently: the OS dialler is the only
 * place a call actually starts, and the user stays in control. These helpers
 * simply hand the number over and log that they did — nothing here claims a call
 * connected.
 */
export async function callNumber(input: { ownerId: string; number: string; label: string }): Promise<void> {
  const number = input.number.replace(/[^\d+]/g, '');
  if (!number) return;

  await recordEvent({
    ownerId: input.ownerId,
    type: 'emergency_contact_dialled',
    message: `Opened the dialler for ${input.label} (${number}). SURAKSHA cannot confirm whether the call connected.`,
    severity: 'notice',
  });

  window.location.href = `tel:${number}`;
}

export async function callContact(contact: TrustedContact): Promise<void> {
  await callNumber({ ownerId: contact.ownerId, number: contact.phone, label: contact.name });
}

export async function callEmergency(user: UserProfile): Promise<void> {
  await callNumber({
    ownerId: user.id,
    number: user.emergency.emergencyNumber || '112',
    label: 'emergency services',
  });
}

export function dialLink(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, '')}`;
}
