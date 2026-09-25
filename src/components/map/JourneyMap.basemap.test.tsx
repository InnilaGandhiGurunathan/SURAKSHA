/**
 * The map's Google Maps behaviour, tested through the real component.
 *
 * The promise of this feature is: *nothing changes until a key exists, and the
 * moment a usable key exists the map becomes real without a code change.* Both
 * halves are asserted here — including the fallback, because a broken basemap on
 * a safety screen is worse than a plain one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JourneyMap } from './JourneyMap';
import { GOOGLE_MAPS_KEY_VAR } from '@/config/googleMaps';
import { resetGoogleMapsLoader, type GoogleMapsApi } from '@/services/googleMapsApi';
import { setBasemapPreference } from '@/services/basemapPreference';
import { store as appStore } from '@/store/hooks';
import type { Journey } from '@/domain/types';

const env = import.meta.env as unknown as Record<string, string | undefined>;
const KEY = `AIza${'Q'.repeat(35)}`;
type GoogleWindow = Record<string, any>;

function installFakeGoogleMaps() {
  const win = window as unknown as GoogleWindow;
  class FakeMap {
    setOptions() {}
    setCenter() {}
    panTo() {}
    setZoom() {}
    getZoom() {
      return 16;
    }
    fitBounds() {}
  }
  class FakePath {
    setMap() {}
    setOptions() {}
    setPath() {}
  }
  class FakeMarker {
    setMap() {}
    setPosition() {}
    setOptions() {}
  }
  win.google = {
    maps: {
      Map: FakeMap,
      Marker: FakeMarker,
      Polyline: FakePath,
      Polygon: FakePath,
      LatLngBounds: class {
        extend() {}
      },
      SymbolPath: { CIRCLE: 1 },
      event: { addListener: () => ({ remove: () => undefined }) },
    } satisfies Partial<GoogleMapsApi>,
  };
}

function journey(): Journey {
  appStore.startCanonicalJourney();
  return appStore.getState().journey!;
}

beforeEach(() => {
  for (const name of [GOOGLE_MAPS_KEY_VAR, 'VITE_GOOGLE_MAPS_KEY', 'VITE_GOOGLE_MAPS_KEY_ID']) delete env[name];
  window.sessionStorage.clear();
  window.localStorage.clear();
  const win = window as unknown as GoogleWindow;
  delete win.google;
  delete win.__SURAKSHA_GOOGLE_MAPS_KEY__;
  resetGoogleMapsLoader();
  setBasemapPreference('auto');
  appStore.resetDemo();
});

describe('without a key', () => {
  it('draws the simulated map and says why on the surface itself', () => {
    const { container } = render(<JourneyMap journey={journey()} />);

    expect(container.querySelector('svg[role="img"]')).toBeTruthy();
    expect(container.querySelector('[data-suraksha-live-map]')).toBeNull();
    expect(screen.getByRole('button', { name: /no maps key — simulated map/i })).toBeTruthy();
  });

  it('opens a key check that names the file, the variable and the restart', async () => {
    render(<JourneyMap journey={journey()} />);
    await userEvent.click(screen.getByRole('button', { name: /no maps key — simulated map/i }));

    const panel = await screen.findByTestId('suraksha-maps-debug-panel');
    expect(within(panel).getByText(/to switch it on/i)).toBeTruthy();
    expect(panel.textContent).toContain('.env');
    expect(panel.textContent).toContain(GOOGLE_MAPS_KEY_VAR);
    expect(panel.textContent).toMatch(/restart/i);
    expect(within(panel).getByRole('button', { name: /test connection/i })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /close the google maps key check/i }));
    expect(screen.queryByTestId('suraksha-maps-debug-panel')).toBeNull();
  });

  it('does not go blank when someone forces the live map anyway', async () => {
    const { container } = render(<JourneyMap journey={journey()} />);
    await userEvent.click(screen.getByRole('button', { name: /no maps key — simulated map/i }));
    const panel = await screen.findByTestId('suraksha-maps-debug-panel');
    await userEvent.click(within(panel).getByRole('button', { name: /switch to live tiles/i }));

    await waitFor(() => expect(container.querySelector('svg[role="img"]')).toBeTruthy());
    expect(container.querySelector('[data-suraksha-live-map]')).toBeNull();
    expect(screen.getByText(/showing the simulated map instead/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(within(panel).getByText(/no usable key/i)).toBeTruthy();
  });
});

describe('with a usable key', () => {
  it('makes Google tiles the map automatically once a key exists', async () => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
    installFakeGoogleMaps();

    const { container } = render(<JourneyMap journey={journey()} />);
    await waitFor(() => expect(container.querySelector('[data-suraksha-live-map]')).toBeTruthy());

    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(screen.getByRole('button', { name: /live map · aiza…/i })).toBeTruthy();
    expect(screen.getByText(/google tiles · route and coordinates simulated/i)).toBeTruthy();
  });

  it('keeps the labels, zoom and recentre controls working on the live map', async () => {
    env[GOOGLE_MAPS_KEY_VAR] = KEY;
    installFakeGoogleMaps();

    render(<JourneyMap journey={journey()} />);
    await screen.findByRole('button', { name: /live map · aiza…/i });

    await userEvent.click(screen.getByRole('button', { name: /^zoom in$/i }));
    await userEvent.click(screen.getByRole('button', { name: /hide labels/i }));
    await userEvent.click(screen.getByRole('button', { name: /show labels/i }));
    await userEvent.click(screen.getByRole('button', { name: /recentre on traveller/i }));

    // There is no basemap switch on the map any more — the simulated canvas is
    // reached from the key panel, as the fallback it is.
    expect(screen.queryByRole('button', { name: /switch to the simulated map/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /live map · aiza…/i }));
    const panel = await screen.findByTestId('suraksha-maps-debug-panel');
    await userEvent.click(within(panel).getByRole('button', { name: /force the simulated fallback/i }));

    expect(await screen.findByRole('button', { name: /key ready — simulated map chosen/i })).toBeTruthy();

    expect(screen.getByRole('button', { name: /key ready — simulated map chosen/i })).toBeTruthy();
  });

  it('leaves the demo untouched for a reviewer who never sets the variable', () => {
    const { container } = render(<JourneyMap journey={journey()} />);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('class')).toContain('touch-pan-y');
    expect(container.textContent).toContain('Higher-risk zone');
  });
});

afterEach(() => {
  appStore.resetDemo();
});
