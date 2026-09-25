/**
 * End-to-end test of the killer demo flow, driven through the real store:
 * SAFE → deviation (WATCH) → missed check-in (ALERT) → Exit Mode → SOS (CRITICAL)
 * → guardian acknowledgement → resolution.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { HELP_GRACE_MINUTES, SurakshaStore } from './store';

function newStore(): SurakshaStore {
  const store = new SurakshaStore();
  store.hydrate();
  store.stop();
  return store;
}

describe('demo flow through the store', () => {
  let store: SurakshaStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = newStore();
  });

  it('starts a journey SAFE and notifies the primary guardian', () => {
    const journey = store.startCanonicalJourney();
    const state = store.getState();

    expect(journey.status).toBe('ACTIVE');
    expect(journey.risk.band).toBe('SAFE');
    expect(journey.risk.score).toBe(0);
    expect(state.events.some((e) => e.type === 'journey_started')).toBe(true);
    expect(state.events.some((e) => e.type === 'guardian_notified')).toBe(true);
    expect(state.journey?.guardianNotifiedAt).not.toBeNull();
  });

  it('raises WATCH on deviation and asks the traveller to confirm', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();

    const journey = store.getState().journey!;
    expect(journey.deviationActive).toBe(true);
    expect(journey.deviationCount).toBe(1);
    // One deviation now reads as WATCH: a single open signal must not leave the
    // traveller on a screen that says everything looks normal.
    expect(journey.risk.band).toBe('WATCH');
    expect(journey.risk.reasons.some((r) => r.code === 'route_deviation')).toBe(true);

    store.moveOffRoute();
    const second = store.getState().journey!;
    expect(second.deviationCount).toBe(2);
    expect(second.risk.score).toBe(30);
    expect(second.risk.band).toBe('WATCH');
    expect(store.getState().events.some((e) => e.type === 'route_deviation')).toBe(true);
  });

  it('treats a missed check-in as a signal, not a verdict, and escalates to ALERT', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();
    store.moveOffRoute();
    store.sendCheckInNow();
    store.missCheckIn(true);

    const state = store.getState();
    const journey = state.journey!;

    expect(journey.checkIn.missedCount).toBe(1);
    // deviation 20 + repeated 10 + missed 25, plus +6 for a second unrelated
    // signal family compounding with the first.
    expect(journey.risk.score).toBe(61);
    expect(journey.risk.band).toBe('ALERT');

    const missed = state.events.find((e) => e.type === 'checkin_missed');
    expect(missed).toBeTruthy();
    const label = JSON.stringify(missed?.metadata ?? {});
    expect(label).not.toMatch(/in danger/i);

    // An incident record exists and the circle was alerted.
    expect(journey.incidentId).toBeTruthy();
    const incident = state.incidents.find((i) => i.id === journey.incidentId);
    expect(incident?.severity).toBe('ALERT');
    expect(incident?.status).toBe('OPEN');
    expect(state.alerts.length).toBeGreaterThan(0);
  });

  it('runs Exit Mode as a simulated call with scripted content and no telephony', () => {
    store.startCanonicalJourney();
    store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });

    const exit = store.getState().exitMode!;
    expect(exit.active).toBe(true);
    expect(exit.delaySeconds).toBe(10);
    expect(exit.ringing).toBe(false);

    store.answerExitCall();
    expect(store.getState().exitMode?.answered).toBe(true);
    expect(store.getState().events.some((e) => e.type === 'exit_mode_started')).toBe(true);
    expect(store.getState().events.some((e) => e.type === 'exit_mode_call_answered')).toBe(true);

    store.endExitMode();
    expect(store.getState().exitMode?.active).toBe(false);
  });

  it('escalates to CRITICAL on Quick SOS with a 95 score and full explanation', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();
    store.sendCheckInNow();
    store.missCheckIn(true);
    const incident = store.triggerSos('demo')!;

    const state = store.getState();
    expect(incident.severity).toBe('CRITICAL');
    expect(incident.riskScore).toBe(95);
    expect(incident.riskReasons.map((r) => r.code)).toEqual([
      'route_deviation',
      'missed_checkin',
      'explicit_sos',
    ]);
    expect(state.journey?.risk.band).toBe('CRITICAL');
    expect(state.events.some((e) => e.type === 'sos_triggered')).toBe(true);
    expect(state.events.some((e) => e.type === 'incident_created')).toBe(true);

    // Handoff is honest about what SURAKSHA does not do.
    expect(incident.handoff.emergencyServicesContacted).toBe(false);
    expect(incident.handoff.note).toMatch(/does not contact/i);
  });

  /*
   * "I need help" used to be a one-shot event: the sheet closed and nothing
   * followed. It now opens a grace window that escalates on its own.
   */
  describe('help grace window', () => {
    it('opens a deadline when the traveller asks for help', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');

      const journey = store.getState().journey!;
      expect(journey.helpRequestedAt).not.toBeNull();
      expect(journey.helpDeadlineAt).not.toBeNull();
      expect(journey.helpDeadlineAt! - journey.helpRequestedAt!).toBe(HELP_GRACE_MINUTES * 60_000);
      expect(store.getState().events.some((e) => e.type === 'help_requested')).toBe(true);
    });

    it('escalates to the whole circle once the window lapses unanswered', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');
      const before = store.getState().alerts.length;

      store.setSimSpeed(8);
      const engine = store as unknown as { tick: () => void };
      for (let i = 0; i < 30; i += 1) engine.tick(); // 4 virtual minutes

      const state = store.getState();
      const journey = state.journey!;
      expect(journey.helpDeadlineAt).toBeNull();
      expect(journey.escalationLevel).toBeGreaterThanOrEqual(2);
      expect(state.alerts.length).toBeGreaterThan(before);
      expect(state.alerts.some((a) => /asked for help/i.test(a.title))).toBe(true);

      // It produced a real record the guardian can open, not just a toast.
      const incident = state.incidents.find((i) => i.id === journey.incidentId);
      expect(incident?.severity).toBe('ALERT');
      expect(incident?.summary).toMatch(/help was requested/i);
      // A help request is not an SOS, so it must not carry a dialable number.
      expect(incident?.handoff.emergencyNumber).toBeUndefined();
    });

    it('escalates exactly once, not on every tick after the deadline', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');
      store.setSimSpeed(8);
      const engine = store as unknown as { tick: () => void };
      for (let i = 0; i < 60; i += 1) engine.tick();

      const escalated = store
        .getState()
        .incidents.filter((i) => /help was requested/i.test(i.summary));
      expect(escalated).toHaveLength(1);
    });

    it('stands the deadline down when the traveller confirms safety', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');
      store.confirmSafe('journey');

      const journey = store.getState().journey!;
      expect(journey.helpRequestedAt).toBeNull();
      expect(journey.helpDeadlineAt).toBeNull();
      expect(store.getState().alerts.some((a) => /asked for help/i.test(a.title))).toBe(false);
    });

    it('can be closed when somebody reaches the traveller', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');
      store.resolveHelpFollowUp('acknowledged');

      const journey = store.getState().journey!;
      expect(journey.helpRequestedAt).toBeNull();
      expect(journey.helpDeadlineAt).toBeNull();
      expect(store.getState().events.some((e) => e.type === 'system_note')).toBe(true);
    });

    it('does not escalate while the journey is paused', () => {
      store.startCanonicalJourney();
      store.requestHelp('check-in');
      store.pauseJourney();

      store.setSimSpeed(8);
      const engine = store as unknown as { tick: () => void };
      for (let i = 0; i < 40; i += 1) engine.tick();

      // Pausing freezes the journey's timers, including this deadline.
      expect(store.getState().journey!.helpDeadlineAt).not.toBeNull();
      expect(store.getState().alerts.some((a) => /asked for help/i.test(a.title))).toBe(false);
    });
  });

  it('lets the guardian acknowledge an alert and records it on the timeline', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();
    store.moveOffRoute();
    store.sendCheckInNow();
    store.missCheckIn(true);

    const alertId = store.getState().alerts.find((a) => !a.acknowledgedAt)!.id;
    store.acknowledgeAlert(alertId);

    const state = store.getState();
    const acknowledged = state.alerts.find((a) => a.id === alertId)!;
    expect(acknowledged.acknowledgedAt).not.toBeNull();
    expect(acknowledged.acknowledgedBy).toBe(state.guardianProfile.name);
    expect(state.events.some((e) => e.type === 'guardian_acknowledged')).toBe(true);

    // The alert knows which incident it belongs to, and the incident reflects it.
    expect(acknowledged.incidentId).toBeTruthy();
    const incident = state.incidents.find((i) => i.id === acknowledged.incidentId);
    expect(incident?.status).toBe('ACKNOWLEDGED');
    expect(incident?.guardianAcknowledgedAt).not.toBeNull();
  });

  it('steps the state back down when the traveller confirms safety', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();
    store.moveOffRoute();
    const before = store.getState().journey!.risk.score;

    store.confirmSafe('journey');
    const after = store.getState().journey!;

    // A confirmed-safe message must actually step the score down. The band
    // floor is gated on worries that are still open, so it cannot drag a
    // recovered score back up to WATCH.
    expect(after.risk.score).toBeLessThan(before);
    expect(after.risk.reasons.some((r) => r.code === 'band_floor')).toBe(false);
    expect(after.checkIn.completedCount).toBeGreaterThan(0);
    expect(store.getState().events.some((e) => e.type === 'safe_confirmed')).toBe(true);
  });

  it('resolves the journey and the incident when the journey ends', () => {
    store.startCanonicalJourney();
    store.triggerSos('demo');
    const incidentId = store.getState().journey!.incidentId!;

    store.endJourney('arrived');
    const state = store.getState();

    expect(state.journey?.status).toBe('ENDED');
    expect(state.journey?.resolvedBy).toBe('resolved_after_alert');
    expect(state.incidents.find((i) => i.id === incidentId)?.status).toBe('RESOLVED');
    expect(state.events.some((e) => e.type === 'journey_ended')).toBe(true);
  });

  it('resets the whole scenario back to the seeded state', () => {
    store.startCanonicalJourney();
    store.triggerSos('demo');
    expect(store.getState().journey).not.toBeNull();

    store.resetDemo();
    const state = store.getState();
    expect(state.journey).toBeNull();
    expect(state.events).toHaveLength(0);
    expect(state.alerts).toHaveLength(0);
    expect(state.incidents.map((i) => i.code)).toContain('SRK-1038');
    expect(state.contacts.length).toBeGreaterThan(1);
  });

  it('keeps the event log useful — every event carries the required shape', () => {
    store.startCanonicalJourney();
    store.moveOffRoute();
    store.sendCheckInNow();
    store.confirmSafe('checkin');

    for (const event of store.getState().events) {
      expect(typeof event.id).toBe('string');
      expect(typeof event.type).toBe('string');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.userId).toBe('string');
      expect(event.metadata).toBeTypeOf('object');
      expect('journeyId' in event).toBe(true);
    }
  });

  it('moves the simulated traveller along the route as the clock advances', () => {
    store.startCanonicalJourney();
    const start = store.getState().journey!.position;

    store.setSimSpeed(8);
    // Drive the private tick through the public clock: 30 ticks ≈ 4 virtual minutes.
    for (let i = 0; i < 30; i += 1) {
      (store as unknown as { tick: () => void }).tick();
    }

    const moved = store.getState().journey!.position;
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(50);
    expect(store.getState().journey!.route.travelled.length).toBeGreaterThan(1);
  });
});
