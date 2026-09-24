import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';
import { isStandalone } from '@/lib/permissions';

/**
 * PWA lifecycle: installability and service-worker updates.
 *
 * Install matters for this product beyond polish: an installed app is more
 * likely to keep its storage, and on iOS the installed PWA is the only way to
 * get a home-screen icon and a full-screen experience.
 */
export interface InstallState {
  available: boolean;
  installed: boolean;
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismiss: () => void;
  dismissed: boolean;
  platform: 'ios' | 'android' | 'desktop' | 'other';
  iosInstructions: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt(): InstallState {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [dismissed, setDismissed] = useState(localStorage.getItem(STORAGE_KEYS.installDismissed) === '1');

  useEffect(() => {
    const onPrompt = (nativeEvent: Event) => {
      nativeEvent.preventDefault();
      setEvent(nativeEvent as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const ua = navigator.userAgent;
  const platform: InstallState['platform'] = /iPad|iPhone|iPod/.test(ua)
    ? 'ios'
    : /Android/i.test(ua)
      ? 'android'
      : /Macintosh|Windows|Linux/.test(ua)
        ? 'desktop'
        : 'other';

  const prompt = useCallback(async () => {
    if (!event) return 'unavailable' as const;
    await event.prompt();
    const choice = await event.userChoice;
    setEvent(null);
    return choice.outcome;
  }, [event]);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
    setDismissed(true);
  }, []);

  return {
    available: Boolean(event) || (platform === 'ios' && !installed),
    installed,
    prompt,
    dismiss,
    dismissed,
    platform,
    iosInstructions:
      'On iPhone or iPad: tap the Share button, then “Add to Home Screen”. Installed, SURAKSHA opens full screen and keeps its offline data more reliably.',
  };
}

export interface UpdateState {
  ready: boolean;
  apply: () => void;
  dismiss: () => void;
  dismissed: boolean;
  note: string;
}

/**
 * Service-worker updates are surfaced, never applied behind the user's back:
 * swapping the worker mid-journey could reload the page while monitoring.
 */
export function useServiceWorkerUpdate(): UpdateState {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(localStorage.getItem(STORAGE_KEYS.updateDismissed) === '1');

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    let cancelled = false;

    void navigator.serviceWorker.getRegistration().then((found) => {
      if (cancelled || !found) return;
      setRegistration(found);
      if (found.waiting) setReady(true);

      found.addEventListener('updatefound', () => {
        const installing = found.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) setReady(true);
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback(() => {
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    // The new worker takes control and reloads once, cleanly.
    setTimeout(() => window.location.reload(), 400);
  }, [registration]);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.updateDismissed, '1');
    setDismissed(true);
  }, []);

  return {
    ready,
    apply,
    dismiss,
    dismissed,
    note: 'A new version is ready. Updating reloads the app — do it when you are not mid-journey.',
  };
}

export function useBeforeUnloadWarning(enabled: boolean, message = 'A journey is being monitored. Leave anyway?') {
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [enabled, message]);
}
