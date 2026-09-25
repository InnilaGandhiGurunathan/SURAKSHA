/**
 * React 18 StrictMode mounts every component, unmounts it, then mounts it
 * again in development. `main.tsx` renders `<App />` inside StrictMode, so the
 * store is hydrated, stopped and hydrated again before the user sees anything.
 *
 * `hydrate()` used to bail out on the second pass while `stop()` had already
 * cleared the interval, leaving the virtual clock permanently frozen in dev:
 * no journey movement, no check-in countdowns, no ETA drift. This file pins the
 * contract so that regression cannot come back.
 */

import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { App } from '@/App';
import { store } from '@/store/hooks';

describe('store lifecycle under StrictMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    store.stop();
    store.resetDemo();
  });

  it('keeps the virtual clock ticking after the StrictMode remount', async () => {
    window.history.pushState({}, '', '/traveller');
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(store.getState().ready).toBe(true), { timeout: 4000 });

    const before = store.getState().now;
    await waitFor(() => expect(store.getState().now).toBeGreaterThan(before), { timeout: 5000 });

    view.unmount();
  });
});
