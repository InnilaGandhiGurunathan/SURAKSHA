/** Demo relationship selectors. Not a substitute for server authentication. */
import type { GuardianAlert, Incident, Journey, UserProfile } from './types';
import { GUARDIAN_ID } from './seed';

export function guardianContactId(profile: UserProfile): string | null {
  // Backwards-compatible mapping for v4's single, explicitly seeded guardian.
  return profile.contactId ?? (profile.id === GUARDIAN_ID ? 'ct-rohan' : null);
}

export function guardianCanMonitor(record: Pick<Journey | Incident, 'escalationOrder'>, profile: UserProfile): boolean {
  const contactId = guardianContactId(profile);
  return contactId !== null && record.escalationOrder.includes(contactId);
}

export function alertBelongsToGuardian(alert: GuardianAlert, profile: UserProfile): boolean {
  // Unscoped v4 alerts belonged only to the original demo guardian.
  return (alert.guardianId ?? GUARDIAN_ID) === profile.id;
}
