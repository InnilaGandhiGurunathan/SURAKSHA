import { nanoid } from 'nanoid';
import { config, demoModeAllowed, supabaseEnabled } from './config.js';
import { db, initStore, mirror, persist, persistMeta, storeStats } from './store.js';

/**
 * Demonstration seed.
 *
 * Everything created here is stamped `isDemo` (and prefixed with the
 * `SURAKSHA-DEMO` tag in text) so demonstration data can never be mistaken for a
 * real incident. The script refuses to run when `ENABLE_DEMO_MODE=false`, and it
 * always prints exactly what it wrote.
 *
 *   npm run seed --workspace @suraksha/server
 */

const DEMO_TAG = 'SURAKSHA-DEMO';

const now = Date.now();
const iso = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();

async function main(): Promise<void> {
  if (!demoModeAllowed) {
    console.error('[suraksha] ENABLE_DEMO_MODE=false — the seed script will not create sample data.');
    process.exitCode = 1;
    return;
  }

  await initStore();

  const ownerId = 'demo-traveller';
  const guardianContactId = `ctc_${nanoid(10)}`;
  const colleagueContactId = `ctc_${nanoid(10)}`;

  /* ------------------------------- contacts ------------------------------- */
  const contacts = [
    {
      id: guardianContactId,
      ownerId,
      name: 'Meera (sister)',
      relationship: 'family',
      phone: '+15550000001',
      email: 'meera@example.test',
      canReceiveAlerts: true,
      canViewJourney: true,
      canSeeLiveLocation: true,
      isPrimary: true,
      priority: 1,
      createdAt: iso(60 * 24 * 30),
      isDemo: true,
    },
    {
      id: colleagueContactId,
      ownerId,
      name: 'Priya (colleague in the city)',
      relationship: 'colleague',
      phone: '+15550000002',
      canReceiveAlerts: true,
      canViewJourney: true,
      canSeeLiveLocation: false,
      isPrimary: false,
      priority: 2,
      createdAt: iso(60 * 24 * 12),
      isDemo: true,
    },
  ];

  for (const contact of contacts) {
    const index = db().contacts.findIndex((item) => item.id === contact.id);
    const record = { id: contact.id, ownerId, payload: contact, updatedAt: new Date().toISOString() };
    if (index >= 0) db().contacts[index] = record;
    else db().contacts.unshift(record);
  }

  /* ------------------------------- journeys ------------------------------- */
  const completedJourneyId = `jny_${nanoid(10)}`;
  const plannedJourneyId = `jny_${nanoid(10)}`;

  const completedJourney = {
    id: completedJourneyId,
    ownerId,
    title: `${DEMO_TAG} — Central station to riverside hostel`,
    status: 'completed',
    originLabel: 'Central Railway Station',
    destinationLabel: 'Riverside Hostel',
    origin: { lat: 28.6431, lng: 77.2197 },
    destination: { lat: 28.6153, lng: 77.241 },
    scheduledStartAt: iso(60 * 26),
    startedAt: iso(60 * 25),
    completedAt: iso(60 * 23),
    expectedArrivalAt: iso(60 * 24),
    guardianContactIds: [guardianContactId],
    checkpoints: [
      { id: 'cp1', label: 'Metro exit gate 2', status: 'reached', reachedAt: iso(60 * 24.6), expectedOffsetMinutes: 12 },
      { id: 'cp2', label: 'Old market bus stop', status: 'reached', reachedAt: iso(60 * 24.1), expectedOffsetMinutes: 28 },
      { id: 'cp3', label: 'Riverside footbridge', status: 'missed', expectedOffsetMinutes: 46 },
    ],
    lastKnownLocation: { lat: 28.6189, lng: 77.2381, accuracy: 24 },
    riskScore: 35,
    riskBand: 'medium',
    resolvedAt: iso(60 * 23),
    isDemo: true,
  };

  const plannedJourney = {
    id: plannedJourneyId,
    ownerId,
    title: `${DEMO_TAG} — Hostel to night market`,
    status: 'planned',
    originLabel: 'Riverside Hostel',
    destinationLabel: 'Night Market (north gate)',
    origin: { lat: 28.6153, lng: 77.241 },
    destination: { lat: 28.6332, lng: 77.2199 },
    scheduledStartAt: new Date(now + 45 * 60_000).toISOString(),
    expectedArrivalAt: new Date(now + 105 * 60_000).toISOString(),
    guardianContactIds: [guardianContactId, colleagueContactId],
    checkpoints: [
      { id: 'cp1', label: 'Canal crossing', status: 'pending', expectedOffsetMinutes: 10 },
      { id: 'cp2', label: 'Night market north gate', status: 'pending', expectedOffsetMinutes: 22 },
    ],
    riskScore: 0,
    riskBand: 'safe',
    isDemo: true,
  };

  for (const journey of [completedJourney, plannedJourney]) {
    const index = db().journeys.findIndex((item) => item.id === journey.id);
    const record = { id: journey.id, ownerId, payload: journey, updatedAt: new Date().toISOString() };
    if (index >= 0) db().journeys[index] = record;
    else db().journeys.unshift(record);

    await mirror('journeys', {
      id: journey.id,
      owner_id: ownerId,
      payload: journey,
      is_demo: true,
      updated_at: record.updatedAt,
    });
  }

  /* -------------------------------- events -------------------------------- */
  const eventPlan: Array<{ type: string; message: string; severity: string; minutesAgo: number; journeyId: string; riskScore?: number }> = [
    { journeyId: completedJourneyId, type: 'journey_started', message: `${DEMO_TAG} journey started from Central Railway Station.`, severity: 'info', minutesAgo: 60 * 25 },
    { journeyId: completedJourneyId, type: 'checkpoint_reached', message: 'Checkpoint reached: Metro exit gate 2.', severity: 'info', minutesAgo: 60 * 24.6 },
    { journeyId: completedJourneyId, type: 'route_deviation', message: '75 m off the planned corridor for 6 minutes near the old market.', severity: 'warning', minutesAgo: 60 * 24.4 },
    { journeyId: completedJourneyId, type: 'checkpoint_missed', message: 'Checkpoint not reached on time: Riverside footbridge (+14 min).', severity: 'warning', minutesAgo: 60 * 23.9 },
    { journeyId: completedJourneyId, type: 'checkin_prompted', message: 'Discreet safety check-in shown on the device.', severity: 'notice', minutesAgo: 60 * 23.8 },
    { journeyId: completedJourneyId, type: 'checkin_confirmed_safe', message: 'Traveller confirmed they were safe; accumulated signals cleared.', severity: 'info', minutesAgo: 60 * 23.6 },
    { journeyId: completedJourneyId, type: 'journey_completed', message: 'Journey completed at Riverside Hostel.', severity: 'info', minutesAgo: 60 * 23 },
    { journeyId: plannedJourneyId, type: 'journey_created', message: `${DEMO_TAG} journey planned; offline map corridor not yet downloaded.`, severity: 'info', minutesAgo: 60 * 2 },
  ];

  for (const event of eventPlan) {
    db().events.push({
      id: `evt_${nanoid(12)}`,
      ownerId,
      journeyId: event.journeyId,
      payload: {
        type: event.type,
        message: event.message,
        severity: event.severity,
        riskScore: event.riskScore,
        isDemo: true,
      },
      createdAt: iso(event.minutesAgo),
    });
  }

  /* -------------------------------- reports -------------------------------- */
  const verifiedReportId = `demo-report-verified-${nanoid(6)}`;
  const pendingReportId = `demo-report-pending-${nanoid(6)}`;

  const reports = [
    {
      id: `rpt_${nanoid(14)}`,
      clientReportId: verifiedReportId,
      category: 'poor_lighting',
      severity: 'medium',
      title: `${DEMO_TAG} — Footbridge lights out between 9pm and 11pm`,
      description:
        'Both lamps on the riverside footbridge are out. The path is used by people walking back from the market and is very dark. Marked as a demonstration record.',
      occurredAt: iso(60 * 30),
      anonymity: 'anonymous',
      location: { lat: 28.6171, lng: 77.2402, accuracy: 30 },
      locationLabel: 'Riverside footbridge',
      source: 'pwa' as const,
      status: 'verified',
      verification: 'verified' as const,
      verificationNote: 'Confirmed against the municipal lighting feed; forwarded for repair.',
      isCommunityVisible: true,
      ownerId: undefined,
      receivedAt: iso(60 * 29),
      updatedAt: iso(60 * 20),
      ackId: `ack_${nanoid(16)}`,
      isDemo: true,
    },
    {
      id: `rpt_${nanoid(14)}`,
      clientReportId: pendingReportId,
      category: 'suspicious_activity',
      severity: 'high',
      title: `${DEMO_TAG} — Someone following the lane by the market`,
      description:
        'A person kept walking behind me for about ten minutes along the market lane, then stopped when I joined a group near the gate. Filed as a demonstration record and deliberately left unverified.',
      occurredAt: iso(60 * 3),
      anonymity: 'named',
      reporterName: 'Demo traveller',
      reporterContact: '+15550000009',
      location: { lat: 28.6304, lng: 77.2224, accuracy: 18 },
      locationLabel: 'Market lane, north entrance',
      source: 'pwa' as const,
      status: 'submitted',
      verification: 'unverified' as const,
      isCommunityVisible: false,
      ownerId,
      receivedAt: iso(60 * 2.8),
      updatedAt: iso(60 * 2.8),
      ackId: `ack_${nanoid(16)}`,
      isDemo: true,
    },
  ];

  for (const report of reports) {
    db().reports.unshift(report);
    await mirror('incident_reports', {
      id: report.id,
      client_report_id: report.clientReportId,
      category: report.category,
      severity: report.severity,
      title: report.title,
      description: report.description,
      occurred_at: report.occurredAt,
      anonymity: report.anonymity,
      reporter_name: report.reporterName ?? null,
      reporter_contact: report.reporterContact ?? null,
      location: report.location ?? null,
      location_label: report.locationLabel ?? null,
      risk_score: null,
      source: report.source,
      status: report.status,
      verification: report.verification,
      is_community_visible: report.isCommunityVisible,
      received_at: report.receivedAt,
      is_demo: true,
    });
  }

  /* --------------------------------- alerts -------------------------------- */
  const resolvedAlertId = `esc_${nanoid(14)}`;
  const openSosId = `sos_${nanoid(14)}`;

  db().alerts.unshift(
    {
      id: resolvedAlertId,
      kind: 'escalation',
      ownerId,
      ownerName: 'Demo traveller',
      journeyId: completedJourneyId,
      journeyTitle: `${DEMO_TAG} — Central station to riverside hostel`,
      location: { lat: 28.6195, lng: 77.2371 },
      message: 'Risk escalated to 35 — missed checkpoint plus a contextual deviation.',
      payload: {
        score: 35,
        reason: 'missed_checkpoint + route_deviation_contextual',
        isDemo: true,
      },
      status: 'resolved',
      createdAt: iso(60 * 23.9),
      acknowledgedAt: iso(60 * 23.85),
    },
    {
      id: openSosId,
      kind: 'sos',
      ownerId,
      ownerName: 'Demo traveller',
      journeyId: plannedJourneyId,
      journeyTitle: `${DEMO_TAG} — Hostel to night market`,
      location: { lat: 28.6166, lng: 77.2399 },
      message: 'Silent SOS activated by the traveller (demonstration record — not a real emergency).',
      payload: {
        silent: true,
        note: 'SURAKSHA-DEMO record created by the seed script. This is not a real SOS.',
        isDemo: true,
      },
      status: 'received',
      createdAt: iso(35),
    },
  );

  /* --------------------------------- meta --------------------------------- */
  await persist('contacts');
  await persist('journeys');
  await persist('events');
  await persist('reports');
  await persist('alerts');

  db().meta = {
    ...db().meta,
    lastSeedAt: new Date().toISOString(),
    lastSeedIsDemoOnly: true,
    demoOwnerId: ownerId,
    demoTag: DEMO_TAG,
  };
  await persistMeta();

  const stats = storeStats();
  console.log('');
  console.log('  SURAKSHA demonstration data created');
  console.log('  ----------------------------------');
  console.log(`  Owner id        ${ownerId}`);
  console.log(`  Tag             ${DEMO_TAG} (every record is marked isDemo: true)`);
  console.log(`  Journeys        ${stats.journeys} (one completed with a resolved escalation, one planned)`);
  console.log(`  Events          ${stats.events}`);
  console.log(`  Contacts        ${stats.contacts}`);
  console.log(`  Reports         ${stats.reports} (one verified & published, one awaiting review)`);
  console.log(`  Alerts          ${stats.alerts} (one resolved escalation, one open SOS record)`);
  console.log(`  Store           ${config.dataDir}${supabaseEnabled ? ' (mirrored to Supabase)' : ' (local JSON only)'}`);
  console.log('');
  console.log('  The open SOS record is clearly labelled as a demonstration. Do not present');
  console.log('  seeded records as real incidents, and clear them before any live use:');
  console.log(`    SURAKSHA_DATA_DIR=${config.dataDir}   # delete this directory to reset`);
  console.log('');
}

main().catch((error) => {
  console.error('[suraksha] seed failed', error);
  process.exit(1);
});
