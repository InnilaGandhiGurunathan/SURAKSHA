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
import './index.css';

/*
 * Maps debug surface, installed before React boots so it exists even if the
 * first render throws. Open the console and type `surakshaMaps` — see
 * `surakshaMaps.help()`. Keeping this at the entry point (and out of the
 * component tree) means it works on every screen, including a blank one.
 */
installGoogleMapsDebug(
  createGoogleMapsDebugApi({
    setBasemap: setBasemapPreference,
    readBasemap: readBasemapPreference,
  }),
);
printGoogleMapsBanner();

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
