/**
 * Render smoke tests: every route must mount without throwing, and the two
 * hero interactions (confirm safe, open SOS) must change real state.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { store as appStore } from '@/store/hooks';
import { authStore } from '@/store/authStore';
import { TravellerHome } from '@/pages/traveller/TravellerHome';
import { StartJourney } from '@/pages/traveller/StartJourney';
import { ActiveJourney } from '@/pages/traveller/ActiveJourney';
import { ExitModePage } from '@/pages/traveller/ExitModePage';
import { ExitModeOverlay } from '@/components/domain/ExitMode';
import { CheckInPrompt } from '@/components/domain/CheckInPrompt';
import { TrustedCircle } from '@/pages/traveller/TrustedCircle';
import { TravellerIncidents } from '@/pages/traveller/TravellerIncidents';
import { IncidentDetail } from '@/pages/traveller/IncidentDetail';
import { Community } from '@/pages/traveller/Community';
import { Learn } from '@/pages/traveller/Learn';
import { Profile } from '@/pages/traveller/Profile';
import { GuardianDashboard } from '@/pages/guardian/GuardianDashboard';
import { GuardianJourneys } from '@/pages/guardian/GuardianJourneys';
import { GuardianAlerts } from '@/pages/guardian/GuardianAlerts';
import { GuardianIncidents } from '@/pages/guardian/GuardianIncidents';
import { GuardianContacts } from '@/pages/guardian/GuardianContacts';
import { GuardianSettings } from '@/pages/guardian/GuardianSettings';

function renderRoute(node: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell>{node}</AppShell>
    </MemoryRouter>,
  );
}

describe('screen mounting', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appStore.hydrate();
    appStore.stop();
    appStore.resetDemo();
  });

  it('mounts every traveller screen', () => {
    const screens: Array<[string, React.ReactNode]> = [
      ['home', <TravellerHome />],
      ['start journey', <StartJourney />],
      ['active journey (empty)', <ActiveJourney />],
      ['exit mode', <ExitModePage />],
      ['trusted circle', <TrustedCircle />],
      ['incidents', <TravellerIncidents />],
      ['community', <Community />],
      ['learn', <Learn />],
      ['profile', <Profile />],
    ];

    screens.forEach(([label, node]) => {
      const view = renderRoute(node);
      expect(view.container.firstChild, `${label} rendered nothing`).toBeTruthy();
      view.unmount();
    });
  });

  it('mounts every guardian screen', () => {
    const screens: Array<[string, React.ReactNode]> = [
      ['guardian dashboard', <GuardianDashboard />],
      ['guardian journeys', <GuardianJourneys />],
      ['guardian alerts', <GuardianAlerts />],
      ['guardian incidents', <GuardianIncidents />],
      ['guardian contacts', <GuardianContacts />],
      ['guardian settings', <GuardianSettings />],
    ];

    screens.forEach(([label, node]) => {
      const view = renderRoute(node);
      expect(view.container.firstChild, `${label} rendered nothing`).toBeTruthy();
      view.unmount();
    });
  });

  it('mounts the traveller and guardian screens with a CRITICAL journey', () => {
    appStore.startCanonicalJourney();
    appStore.moveOffRoute();
    appStore.sendCheckInNow();
    appStore.missCheckIn(true);
    const incident = appStore.triggerSos('demo')!;

    const screens: Array<[string, React.ReactNode]> = [
      ['home (critical)', <TravellerHome />],
      ['active journey (critical)', <ActiveJourney />],
      ['incidents (critical)', <TravellerIncidents />],
      ['guardian dashboard (critical)', <GuardianDashboard />],
      ['guardian alerts (critical)', <GuardianAlerts />],
      ['guardian incidents (critical)', <GuardianIncidents />],
    ];

    screens.forEach(([label, node]) => {
      const view = renderRoute(node);
      expect(view.container.firstChild, label).toBeTruthy();
      view.unmount();
    });

    render(
      <MemoryRouter initialEntries={[`/i/${incident.id}`]}>
        <Routes>
          <Route path="/i/:incidentId" element={<IncidentDetail role="traveller" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText(new RegExp(incident.code)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Why this risk score/i).length).toBeGreaterThan(0);
  });

  it('shows honest empty states when there is no journey', () => {
    renderRoute(<ActiveJourney />);
    expect(screen.getAllByText('No active journey').length).toBeGreaterThan(0);
  });

  it('records a confirmed-safe check-in from the journey screen', async () => {
    appStore.startCanonicalJourney();
    appStore.sendCheckInNow();
    const before = appStore.getState().journey!.checkIn.completedCount;

    renderRoute(<ActiveJourney />);
    const buttons = screen.getAllByRole('button', { name: /I'M SAFE|I’M SAFE/ });
    await userEvent.click(buttons[0]);

    expect(appStore.getState().journey!.checkIn.completedCount).toBeGreaterThan(before);
    expect(appStore.getState().events.some((e) => e.type === 'safe_confirmed')).toBe(true);
  });

  it('opens the Quick SOS panel and explains what it will and will not do', async () => {
    appStore.startCanonicalJourney();
    // The SOS surface doubles as the sign-in affordance when signed out, so
    // establish a local session first.
    await authStore.signIn('demo@suraksha.app');
    renderRoute(<TravellerHome />);

    await userEvent.click(screen.getAllByRole('button', { name: /Quick SOS/i })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Quick SOS').length).toBeGreaterThan(0);
    // The quick path is a single tap. Hold-to-confirm was removed from it
    // because speed is the entire point of this control.
    expect(within(dialog).queryAllByText(/Hold 2 seconds/i).length).toBe(0);
    expect(within(dialog).getAllByText(/One tap — no hold required/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/No emergency service is contacted/i)).toBeTruthy();
    expect(within(dialog).getAllByText(/dials for you/i).length).toBeGreaterThan(0);
  });

  it('switches between the traveller and guardian navigation', async () => {
    renderRoute(<TravellerHome />);
    expect(screen.getAllByText('Exit Mode').length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('radio', { name: /Guardian/i })[0]);
    expect(appStore.getState().role).toBe('guardian');
  });

  it('shows the routine check-in prompt and clears it on I am safe', async () => {
    appStore.startCanonicalJourney();
    renderRoute(
      <>
        <ActiveJourney />
        <CheckInPrompt />
      </>,
    );

    // The engine raises the prompt on its own; drive it the same way here.
    appStore.sendCheckInNow();
    const dialogs = await screen.findAllByRole('dialog');
    const dialog = dialogs.find((node) => within(node).queryAllByText(/Everything okay\?/).length > 0);
    expect(dialog, 'no check-in dialog appeared').toBeTruthy();
    const prompt = dialog as HTMLElement;

    await userEvent.click(within(prompt).getAllByRole('button', { name: /I AM SAFE|I'M SAFE|I\u2019M SAFE/ })[0]);

    expect(appStore.getState().journey!.checkIn.state).not.toBe('REQUESTED');
    expect(appStore.getState().ui.checkInPromptOpen).toBe(false);
    expect(appStore.getState().events.some((e) => e.type === 'safe_confirmed')).toBe(true);
  });

  it('plays the Exit Mode call as a simulated, labelled call and never claims telephony', async () => {
    const contact = appStore.getState().contacts[0];
    appStore.startExitMode({ delaySeconds: 10, contactId: contact.id });
    appStore.setSimSpeed(8);
    const engine = appStore as unknown as { tick: () => void };
    for (let i = 0; i < 3; i += 1) engine.tick(); // 24 virtual seconds > the 10 s delay
    expect(appStore.getState().exitMode?.ringing).toBe(true);

    renderRoute(<ExitModeOverlay />);
    expect(screen.getAllByText(/Simulated call/i).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: /^Accept$/i })[0]);

    expect(screen.getAllByText(/where are you/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Simulated call/i).length).toBeGreaterThan(0);
    expect(appStore.getState().events.some((e) => e.type === 'exit_mode_call_answered')).toBe(true);
  });
});
