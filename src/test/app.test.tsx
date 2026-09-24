/**
 * Boot test — the closest thing to "does the deployed preview actually work".
 *
 * It mounts the real entry component (`<App />`, with its real router and real
 * routing table), waits for hydration to finish, then walks the primary demo
 * route. If this passes, the preview is not stuck on a loading screen and every
 * top-level route renders through the same code path a browser would use.
 *
 * Queries are scoped to each render's own container: a previous mount is not
 * necessarily unmounted when the next one starts, and a global `screen` query
 * could otherwise resolve against a stale tree.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { store as appStore } from '@/store/hooks';

function boot(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

/** Waits for hydration to replace the splash screen inside this render only. */
async function waitForShell(container: HTMLElement) {
  await waitFor(
    () => {
      expect(within(container).getAllByText('Safety Before SOS').length).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );
  await waitFor(() => expect(within(container).queryByText(/Starting SURAKSHA/)).toBeNull(), {
    timeout: 4000,
  });
}

describe('application boot', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appStore.stop();
    appStore.resetDemo();
  });

  it('boots past the splash screen into the traveller home', async () => {
    const view = boot('/traveller');
    await waitForShell(view.container);

    expect(within(view.container).queryByText(/Starting SURAKSHA|Loading SURAKSHA/)).toBeNull();
    // Real content, not a blank shell.
    expect(within(view.container).getAllByText(/Aarav Sharma/i).length).toBeGreaterThan(0);
    view.unmount();
  });

  it('renders every top-level route from the real router', async () => {
    const routes = [
      ['/traveller', /Good (morning|afternoon|evening)/i],
      ['/traveller/start', /Start Journey/i],
      ['/traveller/journey', /Journey|No active journey/i],
      ['/traveller/exit', /Exit Mode/i],
      ['/traveller/circle', /Trusted Circle/i],
      ['/traveller/incidents', /Incident/i],
      ['/traveller/community', /Community/i],
      ['/traveller/learn', /Learn/i],
      ['/traveller/profile', /Profile/i],
      ['/guardian', /Guardian/i],
      ['/guardian/journeys', /Journey/i],
      ['/guardian/alerts', /Alert/i],
      ['/guardian/incidents', /Incident/i],
      ['/guardian/contacts', /Contact/i],
      ['/guardian/settings', /Settings/i],
    ] as const;

    for (const [path, expected] of routes) {
      const view = boot(path);
      await waitForShell(view.container);

      const text = view.container.textContent ?? '';
      expect(text, `${path} rendered nothing`).not.toHaveLength(0);
      expect(text, `${path} did not show ${expected}`).toMatch(expected);
      expect(view.container.innerHTML, `${path} leaked "undefined"`).not.toContain('undefined');
      expect(view.container.innerHTML, `${path} leaked "NaN"`).not.toContain('NaN');

      // The navigation must match the page: a /guardian URL shows the guardian
      // nav, a /traveller URL shows the traveller nav.
      const nav = within(view.container).getAllByRole('navigation');
      const navText = nav.map((n) => n.textContent ?? '').join(' ');
      if (path.startsWith('/guardian')) {
        expect(navText, `${path} showed the traveller navigation`).toMatch(/Overview/);
      } else {
        expect(navText, `${path} showed the guardian navigation`).toMatch(/Trusted Circle/);
      }

      view.unmount();
    }
  });

  it('walks the hero demo flow and reaches CRITICAL with a real incident', async () => {
    const view = boot('/traveller/journey');
    await waitForShell(view.container);

    // Empty state first — honest, not a fake journey.
    expect(within(view.container).getAllByText('No active journey').length).toBeGreaterThan(0);

    appStore.startCanonicalJourney();
    const journey = appStore.getState().journey!;
    expect(journey.risk.band).toBe('SAFE');
    expect(appStore.getState().events.some((e) => e.type === 'journey_started')).toBe(true);
    expect(appStore.getState().events.some((e) => e.type === 'guardian_notified')).toBe(true);

    appStore.moveOffRoute();
    appStore.sendCheckInNow();
    appStore.missCheckIn(true);
    const incident = appStore.triggerSos('demo')!;

    expect(appStore.getState().journey!.risk.band).toBe('CRITICAL');
    expect(appStore.getState().journey!.risk.score).toBe(95);
    expect(incident.code).toMatch(/^SRK-/);
    expect(appStore.getState().events.some((e) => e.type === 'incident_created')).toBe(true);
    expect(appStore.getState().events.some((e) => e.type === 'sos_triggered')).toBe(true);

    // React flushes the store subscription asynchronously, so wait for the
    // re-render instead of probing immediately.
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Emergency workflow activated/i);
    });
    expect(view.container.textContent).toMatch(/CRITICAL/);
    view.unmount();

    // The guardian sees the same incident and can acknowledge it.
    appStore.setRole('guardian');
    const guardian = boot('/guardian/alerts');
    await waitForShell(guardian.container);
    expect(guardian.container.textContent).toMatch(/Safety check-in missed/i);

    const ack = within(guardian.container).getAllByRole('button', { name: /ACKNOWLEDGE/i })[0];
    await userEvent.click(ack);
    expect(appStore.getState().events.some((e) => e.type === 'guardian_acknowledged')).toBe(true);
    guardian.unmount();
  });

  it('restores the seeded scenario on reset, keeping the role being demonstrated', async () => {
    const view = boot('/guardian');
    await waitForShell(view.container);

    appStore.startCanonicalJourney();
    appStore.triggerSos('demo');
    expect(appStore.getState().journey).not.toBeNull();
    expect(appStore.getState().incidents.length).toBeGreaterThan(0);

    appStore.resetDemo();
    expect(appStore.getState().journey).toBeNull();
    expect(appStore.getState().events).toHaveLength(0);
    // Deliberate: a judge resetting mid-demo stays on the view they are showing.
    expect(appStore.getState().role).toBe('guardian');
    view.unmount();
  });
});
