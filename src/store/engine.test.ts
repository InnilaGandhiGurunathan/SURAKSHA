/**
 * Simulation engine tests: the virtual clock, the auto check-in cycle, the
 * late-arrival rule and the demo risk zone.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SurakshaStore, TICK_MS } from './store';
import { estimatedArrivalAt } from '@/domain/journey';

function newStore(): SurakshaStore {
  const store = new SurakshaStore();
  store.hydrate();
  store.stop();
  return store;
}

/** Drives the private tick the same way the interval does. */
function tick(store: SurakshaStore, times: number, speed = 8): void {
  store.setSimSpeed(speed);
  const engine = store as unknown as { tick: () => void };
  for (let i = 0; i < times; i += 1) engine.tick();
}

describe('simulation engine', () => {
  let store: SurakshaStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = newStore();
    store.startCanonicalJourney();
  });

  it('advances the virtual clock at the selected demo speed', () => {
    const before = store.getState().now;
    tick(store, 5, 4);
    expect(store.getState().now - before).toBe(5 * TICK_MS * 4);
  });

  it('asks "Everything okay?" once the check-in falls due', () => {
    store.setSimSpeed(8);
    tick(store, 9); // 72 virtual seconds > the 60 s demo-pacing first check-in

    const state = store.getState();
    expect(state.journey?.checkIn.state).toBe('REQUESTED');
    expect(state.ui.checkInPromptOpen).toBe(true);
    expect(state.events.filter((e) => e.type === 'checkin_sent').length).toBeGreaterThan(0);
  });

  it('records a missed check-in after the grace period, then re-arms the next cycle', () => {
    tick(store, 9); // request
    tick(store, 16); // 128 virtual seconds > the 2 minute grace period

    const afterMiss = store.getState();
    expect(afterMiss.journey?.checkIn.missedCount).toBe(1);
    expect(afterMiss.events.some((e) => e.type === 'checkin_missed')).toBe(true);
    expect(afterMiss.alerts.some((a) => a.title === 'Safety check-in missed')).toBe(true);
    // A missed check-in does not silence later prompts.
    expect(afterMiss.journey?.checkIn.dueAt).not.toBeNull();

    tick(store, 120); // 16 more virtual minutes
    expect(store.getState().journey!.checkIn.missedCount).toBeGreaterThanOrEqual(2);
  });

  it('does not treat a missed check-in as proof of danger', () => {
    tick(store, 30);
    const state = store.getState();
    const muted = state.events.filter((e) => e.type === 'checkin_missed');
    const copy = JSON.stringify(muted.map((e) => e.metadata)).toLowerCase();
    expect(copy).not.toMatch(/danger|dangerous|unsafe/);
    expect(state.journey!.risk.headline).not.toMatch(/in danger/i);
  });

  it('adds the late-arrival rule when the planned window passes', () => {
    store.simulateEtaSlip(20);
    tick(store, 160); // > 20 virtual minutes at 8×

    const state = store.getState();
    expect(state.events.some((e) => e.type === 'late_arrival')).toBe(true);
    expect(state.journey!.risk.reasons.some((r) => r.code === 'late_arrival')).toBe(true);
  });

  it('scores the demo risk zone at +15 and keeps the traveller there', () => {
    store.enterRiskZone();
    const state = store.getState();

    expect(state.journey?.inRiskZone).toBe(true);
    expect(state.journey?.risk.reasons.find((r) => r.code === 'risk_zone')?.delta).toBe(15);
    expect(state.events.some((e) => e.type === 'risk_zone_entered')).toBe(true);

    tick(store, 3);
    expect(store.getState().journey?.inRiskZone).toBe(true);

    store.leaveRiskZone();
    expect(store.getState().journey?.inRiskZone).toBe(false);
  });

  it('stops moving a paused journey but keeps the assessment live', () => {
    tick(store, 4);
    const positionBefore = store.getState().journey!.position;
    store.pauseJourney();
    tick(store, 6);

    const paused = store.getState().journey!;
    expect(paused.status).toBe('PAUSED');
    expect(paused.position).toEqual(positionBefore);
    expect(paused.risk.band).toBe('SAFE');
  });

  /*
   * Detours may move the displayed estimate, but do not move the agreed
   * arrival deadline. A journey still open past that deadline is overdue.
   */
  it('charges a late-arrival signal once time lost to a detour pushes the ETA past the plan', () => {
    store.setSimSpeed(8);
    const engine = store as unknown as { tick: () => void };
    const plannedArrival = store.getState().journey!.expectedArrivalAt;

    // Ten virtual minutes off-route, then back on it.
    store.moveOffRoute();
    for (let i = 0; i < 75; i += 1) engine.tick();
    store.restoreRoute();

    const restored = store.getState().journey!;
    // The estimate moved later, but the agreed 30-minute deadline has not
    // passed yet after this ten-minute diversion.
    expect(estimatedArrivalAt(restored, store.getState().now)).toBeGreaterThan(plannedArrival);
    expect(restored.lateMinutes).toBe(0);

    // Keep travelling until the lost time makes the arrival genuinely overdue.
    for (let i = 0; i < 400; i += 1) engine.tick();

    const journey = store.getState().journey!;
    expect(store.getState().now).toBeGreaterThan(estimatedArrivalAt(journey, store.getState().now));
    expect(journey.risk.reasons.some((r) => r.code === 'late_arrival')).toBe(true);
    expect(store.getState().events.some((e) => e.type === 'late_arrival')).toBe(true);
  });

  /*
   * #8 — losing the location feed is a signal. It used to flip a boolean and
   * leave the score, and the headline, completely untouched.
   */
  it('raises the band and the headline when the location feed is lost', () => {
    expect(store.getState().journey!.risk.band).toBe('SAFE');
    expect(store.getState().journey!.risk.headline).toMatch(/looks normal/i);

    store.setLocationAvailable(false);
    const lost = store.getState().journey!;
    expect(lost.risk.reasons.find((r) => r.code === 'location_lost')?.delta).toBe(25);
    expect(lost.risk.band).toBe('WATCH');
    // The user-visible headline must change, not just the itemised reasons.
    expect(lost.risk.headline).not.toMatch(/looks normal/i);
    expect(lost.risk.headline).toMatch(/location/i);

    store.setLocationAvailable(true);
    expect(store.getState().journey!.risk.band).toBe('SAFE');
    expect(store.getState().journey!.risk.score).toBe(0);
  });

  it('streams location updates into the event log while travelling', () => {
    tick(store, 12);
    expect(store.getState().events.some((e) => e.type === 'location_updated')).toBe(true);
  });

  it('resumes a stored journey where the simulated clock stopped', () => {
    window.localStorage.clear();
    const first = new SurakshaStore();
    first.hydrate();
    first.stop();
    first.startCanonicalJourney();
    first.setSimSpeed(8);
    const engine = first as unknown as { tick: () => void };
    for (let i = 0; i < 12; i += 1) engine.tick();
    first.flush();
    const before = first.getState().now;

    // A fresh store, as if the page had been reloaded mid-journey.
    const reloaded = new SurakshaStore();
    reloaded.hydrate();
    reloaded.stop();
    const state = reloaded.getState();

    expect(state.journey).not.toBeNull();
    expect(state.journey!.status).not.toBe('ENDED');
    // The clock continues from where the simulation stopped — it does not
    // jump to the wall clock, which would make the journey look overdue.
    expect(state.now).toBe(before);
    expect(state.journey!.lastPositionAt).toBeLessThanOrEqual(before);
    expect(state.journey!.risk.band).not.toBe('CRITICAL');

    // And it keeps running from there.
    const resumed = reloaded as unknown as { tick: () => void };
    resumed.tick();
    expect(reloaded.getState().now).toBeGreaterThan(before);
  });

  it('discards state written by an older schema version', () => {
    window.localStorage.clear();
    const store = new SurakshaStore();
    store.hydrate();
    store.stop();
    store.startCanonicalJourney();
    expect(store.getState().journey).not.toBeNull();

    const key = Object.keys(window.localStorage).find((k) => k.includes('meta'));
    if (key) window.localStorage.setItem(key, JSON.stringify({ version: 0 }));

    const reloaded = new SurakshaStore();
    reloaded.hydrate();
    reloaded.stop();
    expect(reloaded.getState().journey).toBeNull();
  });
});
