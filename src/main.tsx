import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { store } from './store/hooks';
import {
  createGoogleMapsDebugApi,
  installGoogleMapsDebug,
  printGoogleMapsBanner,
} from './services/googleMapsApi';
import { readBasemapPreference, setBasemapPreference } from './services/basemapPreference';
import { hydrateRuntimeMapsConfig, RUNTIME_MAPS_CONFIG_WAIT_MS } from './config/runtimeMapsConfig';
import './index.css';

/*
 * Maps debug surface, installed before React boots so it exists even if the
 * first render throws. Open the console and type `surakshaMaps` — see
 * `surakshaMaps.help()`. Keeping this at the entry point (and out of the
 * component tree) means it works on every screen, including a blank one.
 */
const rootEl = document.getElementById('root');
if (rootEl && rootEl.childElementCount === 0) {
  rootEl.textContent = 'Starting SURAKSHA…';
}

/*
 * The Maps key Vercel has *right now* is not the key Vite may have frozen into
 * this bundle. Wait briefly for /api/maps-config (already in flight from
 * index.html) so the first paint reflects the dashboard value. A slow or
 * missing endpoint must not blank the app — the request keeps running and the
 * map upgrades when it lands.
 */
const mapsConfigReady = hydrateRuntimeMapsConfig();
void Promise.race([
  mapsConfigReady,
  new Promise((resolve) => window.setTimeout(resolve, RUNTIME_MAPS_CONFIG_WAIT_MS)),
]).finally(() => {
  installGoogleMapsDebug(
    createGoogleMapsDebugApi({
      setBasemap: setBasemapPreference,
      readBasemap: readBasemapPreference,
    }),
  );
  printGoogleMapsBanner();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

/*
 * The simulation runs on a virtual clock, so the newest check-in or incident
 * may still be sitting in memory when the tab is closed. Flush it on the way
 * out; a refresh then continues exactly where the journey stopped.
 */
const flush = () => store.flush();
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});


