import type { Journey, TrustedContact } from '@suraksha/shared';
import { interpolateLine, polylineLengthMeters } from '@suraksha/shared';
import { db } from '@/lib/db';
import { DEMO_TAG } from '@/lib/constants';
import { createContact } from './contacts';
import { buildRouteInfo, createJourney, makeCheckpoint, updateJourney } from './journeys';
import { recordEvent } from './events';
import { pushNotification } from './notifications';

/**
 * Demonstration data.
 *
 * Every record created here is flagged twice: `isDemo: true` on the row itself
 * and a `[DEMO]` prefix in its human-readable name. That is deliberate — a
 * realistic-looking sample journey in a safety app is dangerous if it can be
 * mistaken for a real one, in the UI, in an export, or on a responder console.
 *
 * The sample set is built to show the *honest* parts of the product: one finished
 * journey with a single missed checkpoint that ended in a check-in (not an
 * emergency), and one upcoming journey that can be started to watch Guardian Mode
 * evaluate locally.
 */

const CENTRE = { lat: 12.9756, lng: 77.6068 };

export interface DemoResult {
  journeys: number;
  contacts: number;
  note: string;
}

export async function createDemoData(ownerId: string): Promise<DemoResult> {
  const timestamp = new Date().toISOString();

  /* ------------------------------- contacts ------------------------------- */
  const demoContacts: Array<Parameters<typeof createContact>[0]> = [
    {
      ownerId,
      name: '[DEMO] Aarti Sharma',
      relationship: 'Sister',
      phone: '+919811122334',
      email: 'aarti.demo@example.com',
      notes: 'Demonstration record — replace with a real trusted contact before travelling.',
      isPrimary: true,
      priority: 1,
      canReceiveAlerts: true,
      canViewJourney: true,
      canSeeLiveLocation: true,
      isDemo: true,
    },
    {
      ownerId,
      name: '[DEMO] Ravi Menon',
      relationship: 'Colleague',
      phone: '+919822233445',
      notes: 'Demonstration record.',
      priority: 2,
      canReceiveAlerts: true,
      canViewJourney: true,
      canSeeLiveLocation: false,
      isDemo: true,
    },
  ];

  const created: TrustedContact[] = [];
  for (const contact of demoContacts) {
    created.push(await createContact(contact));
  }
  const contactIds = created.map((contact) => contact.id);

  /* ------------------- a journey that already finished -------------------- */
  const pastOrigin = CENTRE;
  const pastDestination = { lat: 12.9352, lng: 77.6245 };
  const pastGeometry = interpolateLine(pastOrigin, pastDestination, 24);
  const pastDeparture = new Date(Date.now() - 3 * 3600_000).toISOString();

  const completed = await createJourney({
    owner: demoOwner(ownerId),
    title: `[DEMO] Evening metro ride home`,
    originLabel: '[DEMO] MG Road Metro Station',
    origin: pastOrigin,
    destinationLabel: '[DEMO] Koramangala 5th Block',
    destination: pastDestination,
    scheduledStartAt: pastDeparture,
    transportMode: 'transit',
    guardianContactIds: contactIds,
    notes: `${DEMO_TAG} — sample journey for the demonstration mode.`,
    route: buildRouteInfo(pastGeometry, Math.max(1, Math.round(polylineLengthMeters(pastGeometry) / 1000 / 22 * 60)), 'straight-line'),
    isDemo: true,
    checkpoints: [
      makeCheckpoint({ label: '[DEMO] Trinity Circle', location: pastGeometry[8], expectedOffsetMinutes: 10 }),
      makeCheckpoint({ label: '[DEMO] Domlur flyover', location: pastGeometry[16], expectedOffsetMinutes: 22 }),
    ],
  });

  // Finish the journey the way a real one would finish: started, one checkpoint
  // reached, one missed, a check-in answered, then completed.
  const checkpoints = completed.checkpoints.map((checkpoint, index) =>
    index === 0
      ? { ...checkpoint, status: 'reached' as const, reachedAt: new Date(Date.now() - 2.8 * 3600_000).toISOString() }
      : { ...checkpoint, status: 'missed' as const, missedAt: new Date(Date.now() - 2.4 * 3600_000).toISOString() },
  );

  await db.journeys.update(completed.id, {
    status: 'completed',
    startedAt: pastDeparture,
    completedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    checkpoints,
    lastKnownLocation: pastDestination,
    lastLocationAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    riskScore: 10,
    riskBand: 'low',
    escalationStage: 'monitoring',
    updatedAt: timestamp,
  });

  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'journey_started',
    message: '[DEMO] Journey started from MG Road Metro Station.',
    severity: 'info',
    isDemo: true,
    localOnly: true,
  });
  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'checkpoint_reached',
    message: '[DEMO] Checkpoint “Trinity Circle” confirmed by the traveller.',
    severity: 'info',
    isDemo: true,
    localOnly: true,
  });
  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'checkpoint_missed',
    message:
      '[DEMO] Checkpoint “Domlur flyover” was not confirmed in its window (+10). A discreet check-in appeared — nobody was contacted, because a single missed checkpoint never escalates.',
    severity: 'notice',
    riskScore: 10,
    isDemo: true,
    localOnly: true,
  });
  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'checkin_prompted',
    message: '[DEMO] Discreet safety check-in shown on the device.',
    severity: 'notice',
    isDemo: true,
    localOnly: true,
  });
  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'checkin_confirmed_safe',
    message: '[DEMO] Traveller confirmed they were safe; the accumulated signal was cleared.',
    severity: 'info',
    isDemo: true,
    localOnly: true,
  });
  await recordEvent({
    ownerId,
    journeyId: completed.id,
    type: 'journey_completed',
    message: '[DEMO] Journey completed at Koramangala 5th Block.',
    severity: 'info',
    isDemo: true,
    localOnly: true,
  });

  /* --------------------- a journey starting shortly ----------------------- */
  const soonOrigin = { lat: 12.9756, lng: 77.6068 };
  const soonDestination = { lat: 13.0359, lng: 77.597 };
  const soonGeometry = interpolateLine(soonOrigin, soonDestination, 20);
  const soonAt = new Date(Date.now() + 12 * 60_000).toISOString();

  const upcoming = await createJourney({
    owner: demoOwner(ownerId),
    title: '[DEMO] Late-night cab to Hebbal',
    originLabel: '[DEMO] MG Road Metro Station',
    origin: soonOrigin,
    destinationLabel: '[DEMO] Hebbal Bus Bay',
    destination: soonDestination,
    scheduledStartAt: soonAt,
    transportMode: 'drive',
    guardianContactIds: contactIds,
    notes: `${DEMO_TAG} — start this journey to watch Guardian Mode evaluate on the device.`,
    route: buildRouteInfo(soonGeometry, Math.max(1, Math.round(polylineLengthMeters(soonGeometry) / 1000 / 30 * 60)), 'straight-line'),
    isDemo: true,
    checkpoints: [
      makeCheckpoint({ label: '[DEMO] Cubbon Park gate', location: soonGeometry[6], expectedOffsetMinutes: 8 }),
      makeCheckpoint({ label: '[DEMO] Mekhri Circle', location: soonGeometry[14], expectedOffsetMinutes: 22 }),
    ],
  });

  await pushNotification({
    ownerId,
    kind: 'system',
    title: 'Demonstration data added',
    body: `Two sample journeys and ${created.length} sample contacts were created. Every record is labelled ${DEMO_TAG} and can be removed in one action from Settings.`,
    severity: 'info',
    actionUrl: '/app/journeys',
  });

  return {
    journeys: 2,
    contacts: created.length,
    note: `Sample data created for journey ${completed.id.slice(0, 8)}… and ${upcoming.id.slice(0, 8)}…. All of it is marked as ${DEMO_TAG}.`,
  };
}

export async function clearDemoData(ownerId: string): Promise<{ journeys: number; contacts: number }> {
  const journeys = await db.journeys.where('ownerId').equals(ownerId).toArray();
  const demoJourneys = journeys.filter((journey) => journey.isDemo || journey.notes === DEMO_TAG || journey.title.startsWith('[DEMO]'));

  for (const journey of demoJourneys) {
    await db.events.where('journeyId').equals(journey.id).delete();
    await db.locations.where('journeyId').equals(journey.id).delete();
    await db.riskSnapshots.where('journeyId').equals(journey.id).delete();
    await db.checkIns.where('journeyId').equals(journey.id).delete();
    await db.mapPacks.where('journeyId').equals(journey.id).delete();
    await db.journeys.delete(journey.id);
  }

  const contacts = await db.contacts.where('ownerId').equals(ownerId).toArray();
  const demoContacts = contacts.filter((contact) => contact.isDemo || contact.name.startsWith('[DEMO]'));
  for (const contact of demoContacts) {
    await db.contacts.delete(contact.id);
  }

  // Events that are not attached to a demo journey (notifications about the
  // demo, for instance) are cleaned up by their own marker.
  const events = await db.events.where('ownerId').equals(ownerId).toArray();
  for (const event of events.filter((item) => item.isDemo || item.message.startsWith('[DEMO]'))) {
    await db.events.delete(event.id);
  }

  const notifications = await db.notifications.where('ownerId').equals(ownerId).toArray();
  for (const notification of notifications.filter((item) => item.title.includes('Demonstration data'))) {
    await db.notifications.delete(notification.id);
  }

  return { journeys: demoJourneys.length, contacts: demoContacts.length };
}

/**
 * A minimal owner profile for the journey helpers.
 *
 * Demo journeys are created with the signed-in traveller's id but never carry the
 * traveller's personal emergency details, so nothing seeded can leak real data.
 */
function demoOwner(ownerId: string) {
  return {
    id: ownerId,
    fullName: 'Demonstration traveller',
    role: 'traveller' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deviceOnly: true,
    emergency: {
      emergencyNumber: '112',
      medicalNotes: '',
      bloodGroup: '',
      allergies: '',
      vehicleDetails: '',
      accommodation: '',
      localEmergencyContact: '',
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Handy for tests: lists everything currently tagged as demonstration data. */
export async function listDemoRecords(ownerId: string): Promise<{ journeys: Journey[]; contacts: TrustedContact[] }> {
  const journeys = (await db.journeys.where('ownerId').equals(ownerId).toArray()).filter(
    (journey) => journey.isDemo || journey.title.startsWith('[DEMO]'),
  );
  const contacts = (await db.contacts.where('ownerId').equals(ownerId).toArray()).filter(
    (contact) => contact.isDemo || contact.name.startsWith('[DEMO]'),
  );
  return { journeys, contacts };
}
