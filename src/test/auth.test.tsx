/**
 * Auth-gated SOS + login page contract.
 *
 * The SOS button is the sign-in affordance: while signed out the shell's SOS
 * surface reads "SIGN IN" and leads to /login, and completing a sign-in (local
 * fallback or Supabase) flips it back to the emergency workflow. These tests
 * pin that behaviour so a regression reintroducing a silent "no auth" demo
 * fails loudly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { store as appStore } from '@/store/hooks';
import { authStore } from '@/store/authStore';

describe('sign-in gateway', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appStore.stop();
    appStore.resetDemo();
    authStore.resetLocalAuth();
  });

  it('renders the login page with the brand story and the email form', async () => {
    window.history.pushState({}, '', '/login');
    const view = render(<App />);
    await waitFor(() => expect(view.container.textContent).toMatch(/Help starts moving/i), { timeout: 4000 });

    expect(view.container.textContent).toMatch(/Safety Before SOS/i);
    expect(view.container.textContent).toMatch(/Continue with email/i);
    expect(view.container.textContent).toMatch(/Connect your Supabase project/i);
    view.unmount();
  });

  it('completes a local sign-in and flips the SOS control back', async () => {
    window.history.pushState({}, '', '/login');
    const view = render(<App />);
    await waitFor(() => expect(view.container.textContent).toMatch(/Continue with email/i), { timeout: 4000 });

    const input = view.container.querySelector('input[type="email"]') as HTMLInputElement;
    await userEvent.type(input, 'demo@suraksha.app');
    await userEvent.click(within(view.container).getByRole('button', { name: /Continue with email/i }));

    // Signed in -> the login page effect lands on the traveller home, and the
    // SOS button is once again the emergency workflow, not the sign-in door.
    await waitFor(() => expect(authStore.isSignedIn()).toBe(true), { timeout: 4000 });
    await waitFor(
      () => expect(within(view.container).getAllByRole('button', { name: /Quick SOS/i }).length).toBeGreaterThan(0),
      { timeout: 4000 },
    );
    view.unmount();
  });

  it('shows SIGN IN on the SOS surface while signed out', async () => {
    // A returning (non-fresh) visitor reaches the app shell without auth.
    window.localStorage.setItem('suraksha.v1.landingVisited', '1');
    window.history.pushState({}, '', '/traveller');
    const view = render(<App />);
    await waitFor(() => expect(view.container.textContent).toMatch(/Safety Before SOS/i), { timeout: 4000 });

    expect(within(view.container).getAllByRole('button', { name: /Sign in to SURAKSHA/i }).length).toBeGreaterThan(0);
    view.unmount();
  });
});
