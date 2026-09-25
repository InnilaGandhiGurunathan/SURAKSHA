/**
 * Virtual-clock integrity.
 *
 * SURAKSHA runs on a simulated clock that starts at a fixed 22:42. The wall
 * clock is a *different* time, so anything that reads `Date.now()` and renders
 * it next to something on the simulated timeline produces visible nonsense —
 * a notification delivered "14 h ago" the moment it appears, or a "bill"
 * timestamped 08:19 beside an incident created at 22:42.
 *
 * These tests pin the rule: only the store's clock feeds user-visible time.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GuardianDashboard } from '@/pages/guardian/GuardianDashboard';
import { StartJourney } from '@/pages/traveller/StartJourney';
import { presentEvent } from '@/services/eventBus';
import { deliver } from '@/services/notifications';
import { createEvidenceRecord, syntheticVoiceNoteBuffer } from '@/services/evidence';
import { INCIDENT_SEED } from '@/domain/seed';
import { SCHEMA_VERSION } from '@/services/backend';
import { SurakshaStore } from '@/store/store';
import { HelpPanel } from '@/components/domain/HelpPanel';
import { store as appStore } from '@/store/hooks';
import type { SafetyEvent } from '@/domain/types';

function renderRoute(node: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell>{node}</AppShell>
    </MemoryRouter>,
  );
}

function tick(times: number, speed = 8) {
  appStore.setSimSpeed(speed);
  const engine = appStore as unknown as { tick: () => void };
  for (let i = 0; i < times; i += 1) engine.tick();
}

describe('virtual clock integrity', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appStore.hydrate();
    appStore.stop();
    appStore.resetDemo();
  });

  /* ------------------------------------------------------------------ */
  /* The store's clock is the only clock                                */
  /* ------------------------------------------------------------------ */

  it('walks a new journey from the simulated clock, not the wall clock', () => {
    const journey = appStore.startCanonicalJourney();
    const { now } = appStore.getState();

    // The simulator starts at 22:42; the wall clock is a different time of day.
    expect(new Date(journey.startedAt).getHours()).toBe(22);
    expect(new Date(journey.startedAt).getMinutes()).toBe(42);
    expect(journey.startedAt).toBe(now);
    expect(Math.abs(journey.startedAt - Date.now())).toBeGreaterThan(60_000);
  });

  it('stamps delivery receipts on the simulated timeline', () => {
    const journey = appStore.startCanonicalJourney();
    const receipts = appStore.getState().receipts;

    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) {
      // Inside the journey's own timeline — never the wall clock. A small
      // stagger is expected, so allow the fan-out window rather than an exact
      // upper bound.
      expect(receipt.at).toBeGreaterThanOrEqual(journey.startedAt);
      expect(receipt.at).toBeLessThan(journey.startedAt + 5_000);
      // And nowhere near the wall clock, which is hours away from 22:42.
      expect(Math.abs(receipt.at - Date.now())).toBeGreaterThan(60_000);
    }
  });

  it('stamps each receipt from the timestamp it is given', () => {
    const contacts = appStore.getState().contacts;
    const at = new Date('2026-01-02T22:42:00Z').getTime();
    const receipts = deliver({ contacts, title: 't', body: 'b', at });

    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0].at).toBe(at);
    // A stagger is allowed, but everything stays on the supplied clock.
    expect(receipts[1]?.at ?? at).toBe(at + 400);
  });

  it('stamps evidence on the simulated timeline', async () => {
    const at = appStore.getState().now;
    const record = await createEvidenceRecord({
      fileName: 'note.wav',
      mimeType: 'audio/wav',
      buffer: syntheticVoiceNoteBuffer(1),
      kind: 'voice_note',
      description: 'test',
      at,
    });

    expect(record.createdAt).toBe(at);
    expect(record.id).toContain(at.toString(36));
  });

  it('attaches evidence that sits inside the incident timeline', async () => {
    appStore.startCanonicalJourney();
    const incident = appStore.triggerSos('quick_sos')!;
    const at = appStore.getState().now;

    const record = await createEvidenceRecord({
      fileName: 'voice.wav',
      mimeType: 'audio/wav',
      buffer: syntheticVoiceNoteBuffer(1),
      kind: 'voice_note',
      description: 'test',
      at,
    });
    appStore.attachEvidence(record);

    const stored = appStore.getState().incidents.find((i) => i.id === incident.id)!;
    const attached = stored.evidence[0];
    expect(attached.createdAt).toBe(at);
    // Not the wall clock: the file must not appear to predate its incident.
    expect(attached.createdAt).toBeGreaterThanOrEqual(stored.createdAt);
  });

  /* ------------------------------------------------------------------ */
  /* Explainability: the ledger must add up, everywhere                 */
  /* ------------------------------------------------------------------ */

  it('keeps every seeded incident\'s reasons summing to its score', () => {
    for (const incident of INCIDENT_SEED) {
      const total = incident.riskReasons.reduce((sum, reason) => sum + reason.delta, 0);
      expect(total, `${incident.code} ledger`).toBe(incident.riskScore);
    }
  });

  it('keeps a newly created incident\'s reasons summing to its score', () => {
    appStore.startCanonicalJourney();
    appStore.enterRiskZone();
    appStore.sendCheckInNow();
    appStore.missCheckIn(true);

    const incident = appStore
      .getState()
      .incidents.find((i) => i.id === appStore.getState().journey!.incidentId)!;
    const total = incident.riskReasons.reduce((sum, reason) => sum + reason.delta, 0);
    expect(total).toBe(incident.riskScore);
  });

  it('records a seeded incident as passively detected, so it carries no dialable number', () => {
    for (const incident of INCIDENT_SEED) {
      expect(incident.origin).toBe('passive_signal');
      expect(incident.handoff.emergencyNumber).toBeUndefined();
    }
  });

  /* ------------------------------------------------------------------ */
  /* #13 leftovers: every countdown freezes with the journey            */
  /* ------------------------------------------------------------------ */

  it('#13 keeps the guardian next-check-in countdown frozen while paused', async () => {
    appStore.startCanonicalJourney();
    tick(4);
    appStore.pauseJourney();

    const paused = appStore.getState().journey!;
    const expected = new Date(paused.checkIn.dueAt! - paused.pausedAt!).getTime();
    renderRoute(<GuardianDashboard />);

    const readCountdown = () => {
      // The hint renders as "in mm:ss".
      const match = screen.getByText(/in \d{2}:\d{2}/).textContent ?? '';
      return /in (\d{2}:\d{2})/.exec(match)?.[1] ?? '';
    };
    const before = readCountdown();
    expect(before).toBeTruthy();

    await act(async () => {
      tick(60); // a full virtual minute of wall time passes
    });

    // The journey's own deadline has not moved, and the guardian sees the same
    // number — before this fix the countdown drained while "paused".
    const after = appStore.getState().journey!;
    expect(after.checkIn.dueAt! - after.pausedAt!).toBe(expected);
    expect(readCountdown()).toBe(before);
  });

  it('#13 keeps the help countdown frozen while paused', async () => {
    appStore.startCanonicalJourney();
    appStore.requestHelp('check-in');
    appStore.pauseJourney();

    const paused = appStore.getState().journey!;
    renderRoute(<HelpPanel />);
    act(() => appStore.toggleUi('helpPanelOpen', true));

    const read = () => {
      const dialog = screen.getByRole('dialog');
      const match = /(\d{2}:\d{2})/.exec(dialog.textContent ?? '');
      return match?.[1] ?? '';
    };
    const before = read();
    expect(before).toBeTruthy();

    await act(async () => {
      tick(40);
    });

    expect(read()).toBe(before);
    expect(appStore.getState().journey!.helpDeadlineAt).toBe(paused.helpDeadlineAt);
  });

  /* ------------------------------------------------------------------ */
  /* Start Journey must not mix clocks                                  */
  /* ------------------------------------------------------------------ */

  it('defaults the arrive-by field from the simulator clock, not the wall clock', async () => {
    renderRoute(<StartJourney />);

    await userEvent.click(screen.getByRole('button', { name: /Clock time/i }));

    const summary = screen.getByText(/Arriving about/i).textContent ?? '';
    const minutes = Number(/(\d+)\s+minutes from now/.exec(summary)?.[1] ?? '0');
    // The field is seeded 30 min after the simulator's clock, so the derived
    // duration stays ~30 rather than jumping by the wall-clock offset.
    expect(minutes).toBeGreaterThanOrEqual(25);
    expect(minutes).toBeLessThanOrEqual(35);
  });

  /* ------------------------------------------------------------------ */
  /* The timeline must distinguish a help request from its escalation    */
  /* ------------------------------------------------------------------ */

  it('labels an escalated help request differently from the original request', () => {
    const base: Omit<SafetyEvent, 'id' | 'metadata'> = {
      type: 'help_requested',
      timestamp: 0,
      journeyId: 'jny-1',
      incidentId: null,
      userId: 'usr-1',
    };

    const request = presentEvent({ ...base, id: 'e1', metadata: { via: 'check-in' } });
    const escalated = presentEvent({
      ...base,
      id: 'e2',
      metadata: { via: 'escalation', escalated: true, waitedMinutes: 3 },
    });

    expect(request.label).toMatch(/requested help/i);
    expect(escalated.label).toMatch(/escalated/i);
    expect(escalated.label).toMatch(/3 min/);
    expect(escalated.label).not.toBe(request.label);
    // An escalation is more serious than the request it came from.
    expect(escalated.tone).toBe('critical');
  });

  it('shows the escalated help event on the traveller timeline', () => {
    appStore.startCanonicalJourney();
    appStore.requestHelp('check-in');
    appStore.setSimSpeed(8);
    const engine = appStore as unknown as { tick: () => void };
    for (let i = 0; i < 30; i += 1) engine.tick();

    const escalated = appStore
      .getState()
      .events.filter((e) => e.type === 'help_requested' && e.metadata.escalated === true);
    expect(escalated).toHaveLength(1);
    expect(presentEvent(escalated[0]).label).toMatch(/escalated/i);
  });

  /* ------------------------------------------------------------------ */
  /* Persisted shape                                                   */
  /* ------------------------------------------------------------------ */

  it('discards state written before the current schema version', () => {
    appStore.startCanonicalJourney();
    expect(appStore.getState().journey).not.toBeNull();

    // State written by the previous build must not be rendered half-migrated:
    // it lacks `helpRequestedAt`, `Incident.origin` and the handoff additions.
    window.localStorage.setItem('suraksha.v1.meta', JSON.stringify({ version: SCHEMA_VERSION - 1 }));

    const reloaded = new SurakshaStore();
    reloaded.hydrate();
    reloaded.stop();

    expect(reloaded.getState().journey).toBeNull();
  });
});
