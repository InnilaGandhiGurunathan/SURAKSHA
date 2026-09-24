import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';
import { watchConnectivity } from './store/connectivity';
import { TooltipProvider } from './components/ui/misc';

/**
 * Boot sequence.
 *
 * Order matters for an offline-first app:
 *  1. remove the pre-rendered splash as soon as React paints;
 *  2. start watching connectivity (the shell shows it everywhere);
 *  3. register the service worker and, when the browser supports it, ask for
 *     background sync so a queued report can leave while the app is closed.
 */
function dismissSplash() {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 320);
}

watchConnectivity();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('SURAKSHA could not find its mount point.');

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <App />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{ classNames: { toast: 'rounded-xl text-xs' } }}
        />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Wait one frame so the first paint is the app, not an empty div.
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.ready
      .then((registration) => {
        // Background sync lets a queued report leave the outbox even if the tab
        // is closed again — a real offline-first behaviour, not a simulation.
        if ('sync' in registration && navigator.onLine === false) {
          const syncManager = (registration as ServiceWorkerRegistration & {
            sync?: { register: (tag: string) => Promise<void> };
          }).sync;
          void syncManager?.register('suraksha-outbox').catch(() => undefined);
        }
      })
      .catch(() => undefined);
  });
}

// A tiny global hook used by the service worker's notification click handler.
declare global {
  interface Window {
    __SURAKSHA_SW_MESSAGE__?: unknown;
  }
}

navigator.serviceWorker?.addEventListener?.('message', (event: MessageEvent) => {
  if (event.data?.type === 'SURAKSHA_RUN_SYNC') {
    window.dispatchEvent(new CustomEvent('suraksha:sync-requested', { detail: event.data }));
  }
  window.__SURAKSHA_SW_MESSAGE__ = event.data;
});
