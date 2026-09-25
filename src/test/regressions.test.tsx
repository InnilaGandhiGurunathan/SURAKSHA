/**
 * Regression tests for the reported bugs.
 *
 * Each test names the user-visible symptom rather than the implementation, so a
 * future refactor that reintroduces the symptom fails the test even if it takes
 * a completely different route to get there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { TravellerIncidents } from '@/pages/traveller/TravellerIncidents';
import { TrustedCircle } from '@/pages/traveller/TrustedCircle';
import { Learn } from '@/pages/traveller/Learn';
import { JourneyMap } from '@/components/map/JourneyMap';
import { TravellerHome } from '@/pages/traveller/TravellerHome';
import { IncidentDetail } from '@/pages/traveller/IncidentDetail';
import { LESSONS_SEED } from '@/domain/seed';
import { SurakshaStore } from '@/store/store';
import { store as appStore } from '@/store/hooks';

function renderRoute(node: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell>{node}</AppShell>
    </MemoryRouter>,
  );
}

/** Drives the private tick the same way the interval does. */
function tick(times: number, speed = 8) {
  appStore.setSimSpeed(speed);
  const engine = appStore as unknown as { tick: () => void };
  for (let i = 0; i < times; i += 1) engine.tick();
}

type SpeechWindow = {
  speechSynthesis?: unknown;
  SpeechSynthesisUtterance?: unknown;
};

function installSpeech(): { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  const speak = vi.fn();
  const cancel = vi.fn();
  (window as SpeechWindow).speechSynthesis = { speak, cancel, resume: vi.fn() };
  (window as SpeechWindow).SpeechSynthesisUtterance = function Utterance(this: { text?: string }, text: string) {
    this.text = text;
  };
  return { speak, cancel };
}

function removeSpeech(): void {
  delete (window as SpeechWindow).speechSynthesis;
  delete (window as SpeechWindow).SpeechSynthesisUtterance;
}

describe('reported bugs', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appStore.hydrate();
    appStore.stop();
    appStore.resetDemo();
    removeSpeech();
  });

  /* ------------------------------------------------------------------ */
  /* #1 — Quick SOS needs a single tap, not a two-second hold            */
  /* ------------------------------------------------------------------ */

  it('#1 activates Quick SOS from one tap, with no hold and no confirm step', async () => {
    appStore.startCanonicalJourney();
    act(() => appStore.toggleUi('sosPanelOpen', true));
    renderRoute(<TravellerHome />);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Activate now/i }));

    const journey = appStore.getState().journey!;
    expect(journey.risk.band).toBe('CRITICAL');
    expect(journey.risk.score).toBe(75);
    expect(journey.incidentId).toBeTruthy();
    expect(appStore.getState().events.some((e) => e.type === 'sos_triggered')).toBe(true);
  });

  it('#1 is idempotent — activating twice does not create two incidents', () => {
    appStore.startCanonicalJourney();
    const first = appStore.triggerSos('quick_sos')!;
    const second = appStore.triggerSos('quick_sos')!;
    expect(second.id).toBe(first.id);
    expect(appStore.getState().incidents.filter((i) => i.origin === 'explicit_sos')).toHaveLength(1);
    expect(appStore.getState().activeIncidentId).toBe(first.id);
  });

  /* ------------------------------------------------------------------ */
  /* #5 — 112 is offered on an explicit SOS and unreachable passively    */
  /* ------------------------------------------------------------------ */

  it('#5 offers a tel:112 link on an explicit SOS and records the traveller pressing it', async () => {
    appStore.startCanonicalJourney();
    appStore.triggerSos('quick_sos');
    act(() => appStore.toggleUi('sosPanelOpen', true));
    renderRoute(<TravellerHome />);

    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByRole('link', { name: /Call 112 now/i });
    expect(link.getAttribute('href')).toBe('tel:112');

    await userEvent.click(link);
    const incident = appStore
      .getState()
      .incidents.find((i) => i.id === appStore.getState().journey!.incidentId)!;
    expect(incident.handoff.emergencyNumberDialledAt).not.toBeNull();
    // SURAKSHA never claims it placed the call, and never contacts services.
    expect(incident.handoff.emergencyServicesContacted).toBe(false);
  });

  it('#5 gives a passively detected incident no dialable number at all', async () => {
    appStore.startCanonicalJourney();
    // zone + missed check-in = 56 → ALERT, created with no traveller action.
    appStore.enterRiskZone();
    appStore.sendCheckInNow();
    appStore.missCheckIn(true);

    const journey = appStore.getState().journey!;
    const incident = appStore.getState().incidents.find((i) => i.id === journey.incidentId)!;
    expect(incident.origin).toBe('passive_signal');
    expect(incident.handoff.emergencyNumber).toBeUndefined();

    // The store refuses to log a dial attempt against a passive record.
    appStore.recordEmergencyDialAttempt(incident.id);
    const after = appStore.getState().incidents.find((i) => i.id === incident.id)!;
    expect(after.handoff.emergencyNumberDialledAt ?? null).toBeNull();

    // And the UI offers no dial affordance for it.
    act(() => appStore.toggleUi('sosPanelOpen', true));
    renderRoute(<TravellerHome />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('link', { name: /Call 112 now/i })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /How to call emergency services/i })).toBeTruthy();
  });

  /* ------------------------------------------------------------------ */
  /* #11 — incident links resolve, dangling references are repaired      */
  /* ------------------------------------------------------------------ */

  it('#11 clears the journey incident reference when the incident is deleted', () => {
    appStore.startCanonicalJourney();
    const incident = appStore.triggerSos('quick_sos')!;
    expect(appStore.getState().journey!.incidentId).toBe(incident.id);

    appStore.deleteIncident(incident.id);

    const state = appStore.getState();
    expect(state.journey!.incidentId).toBeNull();
    expect(state.incidents.find((i) => i.id === incident.id)).toBeUndefined();
    expect(state.alerts.every((a) => a.incidentId !== incident.id)).toBe(true);
  });

  it('#11 renders no "open current incident" link once the record is gone', async () => {
    appStore.startCanonicalJourney();
    const incident = appStore.triggerSos('quick_sos')!;
    appStore.deleteIncident(incident.id);

    renderRoute(<TravellerIncidents />);
    expect(screen.queryByText(/Open current incident/i)).toBeNull();
  });

  it('#11 repairs a dangling reference written by an older build on hydrate', () => {
    appStore.startCanonicalJourney();
    const { journey } = appStore.getState();
    expect(journey).not.toBeNull();

    // Simulate storage written by a build that removed the record but left the
    // journey pointing at it. hydrate() is one-shot, so this needs a fresh store.
    window.localStorage.setItem(
      'suraksha.v1.journey',
      JSON.stringify({ ...journey, incidentId: 'inc-does-not-exist' }),
    );

    const reloaded = new SurakshaStore();
    reloaded.hydrate();
    reloaded.stop();

    const state = reloaded.getState();
    expect(state.journey?.id).toBe(journey!.id);
    expect(state.journey?.incidentId).toBeNull();
    expect(state.activeIncidentId).toBeNull();
  });

  it('#11 opens a real incident for both roles', () => {
    appStore.startCanonicalJourney();
    const incident = appStore.triggerSos('demo')!;

    for (const role of ['traveller', 'guardian'] as const) {
      const view = render(
        <MemoryRouter initialEntries={[`/i/${incident.id}`]}>
          <Routes>
            <Route path="/i/:incidentId" element={<IncidentDetail role={role} />} />
          </Routes>
        </MemoryRouter>,
      );
      // The code renders inside a composite heading, so match on the container.
      expect(view.container.textContent).toContain(incident.code);
      expect(view.container.textContent).toMatch(/Why this risk score/i);
      view.unmount();
    }
  });

  /* ------------------------------------------------------------------ */
  /* #9 — the focus trap must not steal the caret or scroll the page     */
  /* ------------------------------------------------------------------ */

  it('#9 lets the Add Contact fields accept keyboard input across re-renders', async () => {
    // A live journey makes the store re-render subscribers once a second, which
    // is exactly what used to re-arm the focus trap and pull the caret out.
    appStore.startCanonicalJourney();
    renderRoute(<TrustedCircle />);

    await userEvent.click(screen.getByRole('button', { name: /Add contact/i }));
    const dialog = await screen.findByRole('dialog');

    const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
    await userEvent.click(name);
    await userEvent.keyboard('Rohan');
    expect(name.value).toBe('Rohan');
    expect(document.activeElement).toBe(name);

    const phone = within(dialog).getByLabelText('Phone') as HTMLInputElement;
    await userEvent.click(phone);
    await userEvent.keyboard('9000000000');
    expect(phone.value).toBe('9000000000');

    // A store tick while the dialog is open must not move focus.
    await act(async () => {
      tick(1);
    });
    expect(document.activeElement).toBe(phone);
    expect(phone.value).toBe('9000000000');
  });

  it('#9 does not re-focus on unrelated re-renders, so a dialog cannot scroll the page', async () => {
    appStore.startCanonicalJourney();
    renderRoute(<TravellerHome />);

    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await act(async () => {
      appStore.toggleUi('sosPanelOpen', true);
    });
    const afterOpen = focusSpy.mock.calls.length;
    expect(afterOpen).toBeGreaterThan(0); // the trap focuses on open, once

    await act(async () => {
      tick(1);
      tick(1);
      tick(1);
    });
    // Re-rendering the tree must not re-arm the trap. Each re-arm used to call
    // focus(), which scrolls its target into view — once per second.
    expect(focusSpy.mock.calls.length).toBe(afterOpen);
    focusSpy.mockRestore();
  });

  /* ------------------------------------------------------------------ */
  /* #12 — quick-check choices select, change and unselect               */
  /* ------------------------------------------------------------------ */

  it('#12 selects, changes and unselects a quick-check answer', async () => {
    renderRoute(<Learn />);

    await userEvent.click(screen.getByRole('button', { name: new RegExp(LESSONS_SEED[0].title, 'i') }));
    const dialog = await screen.findByRole('dialog');

    const group = within(dialog).getAllByRole('radiogroup')[0];
    const options = within(group).getAllByRole('radio');
    expect(options.length).toBeGreaterThan(1);
    expect(options.every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true);

    await userEvent.click(options[0]);
    expect(options[0].getAttribute('aria-checked')).toBe('true');

    // Change the answer.
    await userEvent.click(options[1]);
    expect(options[1].getAttribute('aria-checked')).toBe('true');
    expect(options[0].getAttribute('aria-checked')).toBe('false');

    // Unselect by tapping the chosen answer again.
    await userEvent.click(options[1]);
    expect(options[1].getAttribute('aria-checked')).toBe('false');
  });

  /* ------------------------------------------------------------------ */
  /* #2 / #14 — touch-action must match what the map can actually do     */
  /* ------------------------------------------------------------------ */

  it('#2 lets the page scroll when the map is at its default zoom', () => {
    appStore.startCanonicalJourney();
    const { container } = render(<JourneyMap journey={appStore.getState().journey!} />);
    const svg = container.querySelector('svg')!;
    const classes = svg.getAttribute('class') ?? '';
    // At default zoom the map cannot pan, so it must not swallow the gesture.
    expect(classes).toContain('touch-pan-y');
    expect(classes).not.toContain('touch-none');
  });

  it('#2 claims the touch gesture only once the map can actually pan', async () => {
    appStore.startCanonicalJourney();
    const { container } = render(<JourneyMap journey={appStore.getState().journey!} />);

    await userEvent.click(screen.getByRole('button', { name: /Zoom in/i }));
    const classes = container.querySelector('svg')!.getAttribute('class') ?? '';
    // Zoomed in and genuinely pannable: now it may take the gesture.
    expect(classes).toContain('touch-none');
  });

  /* ------------------------------------------------------------------ */
  /* #13 — pause freezes the timers                                      */
  /* ------------------------------------------------------------------ */

  it('#13 freezes lateness and deadlines while paused, then shifts them on resume', () => {
    appStore.startCanonicalJourney();
    tick(4);

    appStore.pauseJourney();
    const paused = appStore.getState().journey!;
    const etaAtPause = paused.expectedArrivalAt;
    const dueAtPause = paused.checkIn.dueAt!;
    const frozenClock = paused.pausedAt!;

    tick(30); // 30 virtual seconds pass while paused
    const stillPaused = appStore.getState().journey!;

    expect(stillPaused.lateMinutes).toBe(0);
    expect(stillPaused.expectedArrivalAt).toBe(etaAtPause);
    expect(stillPaused.checkIn.dueAt).toBe(dueAtPause);
    // Nothing was asked, missed or escalated while the journey was on hold.
    expect(stillPaused.checkIn.missedCount).toBe(0);

    appStore.resumeJourney();
    const resumed = appStore.getState().journey!;
    const pausedFor = appStore.getState().now - frozenClock;
    expect(pausedFor).toBeGreaterThan(0);
    // The pause duration is excluded exactly once.
    expect(resumed.expectedArrivalAt).toBe(etaAtPause + pausedFor);
    expect(resumed.checkIn.dueAt).toBe(dueAtPause + pausedFor);
  });

  /* ------------------------------------------------------------------ */
  /* #3 — Exit Mode speaks, and mute means silent                        */
  /* ------------------------------------------------------------------ */

  it('#3 rings a call armed during an active journey, not only on an idle app', () => {
    appStore.startCanonicalJourney();
    expect(appStore.getState().journey!.status).toBe('ACTIVE');

    appStore.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });
    expect(appStore.getState().exitMode?.ringing).toBe(false);

    tick(3); // 24 virtual seconds — past the 10 s delay

    // The journey is still running, and the call has rung anyway. Exit Mode is
    // only ever armed mid-journey, so an idle-app-only countdown never fires.
    expect(appStore.getState().journey!.status).toBe('ACTIVE');
    expect(appStore.getState().exitMode?.ringing).toBe(true);
  });

  it('#3 starts no audio before the call is answered', () => {
    const { speak } = installSpeech();
    appStore.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });
    tick(3); // rings
    expect(appStore.getState().exitMode?.ringing).toBe(true);

    // Speech only ever begins from the Accept gesture. A ringtone would have to
    // start from the timer, which is not a gesture and would be blocked.
    expect(speak).not.toHaveBeenCalled();
  });

  it('#3 speaks the scripted line once answered, and mute cancels immediately', async () => {
    const { speak, cancel } = installSpeech();
    appStore.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });
    tick(3);
    renderRoute(<TravellerHome />);

    await userEvent.click(screen.getAllByRole('button', { name: /^Accept$/i })[0]);

    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0][0] as { text: string }).text).toMatch(/where are you/i);

    const cancelsBefore = cancel.mock.calls.length;
    await userEvent.click(screen.getAllByRole('button', { name: /Mute/i })[0]);
    expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);
  });
});
