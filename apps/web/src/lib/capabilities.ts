/**
 * Feature detection. The app must degrade gracefully when the browser (or the
 * sandbox it runs in) does not support a capability, and it must never claim a
 * capability it does not have.
 */

export interface CapabilityReport {
  serviceWorker: boolean;
  notifications: boolean;
  pushManager: boolean;
  geolocation: boolean;
  backgroundGeolocation: boolean;
  wakeLock: boolean;
  storageEstimate: boolean;
  persistentStorage: boolean;
  vibration: boolean;
  share: boolean;
  webCrypto: boolean;
  sms: boolean;
  tel: boolean;
  geolocationSecureContext: boolean;
}

export function detectCapabilities(): CapabilityReport {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const win = typeof window === 'undefined' ? undefined : window;
  const secure = win?.isSecureContext ?? false;

  return {
    serviceWorker: typeof nav?.serviceWorker !== 'undefined',
    notifications: typeof win !== 'undefined' && 'Notification' in win,
    pushManager: typeof win !== 'undefined' && 'PushManager' in win,
    geolocation: typeof nav?.geolocation !== 'undefined',
    // There is no standard background geolocation; we are explicit about it.
    backgroundGeolocation: false,
    wakeLock: typeof nav !== 'undefined' && 'wakeLock' in nav,
    storageEstimate: typeof nav?.storage?.estimate === 'function',
    persistentStorage: typeof nav?.storage?.persist === 'function',
    vibration: typeof nav !== 'undefined' && 'vibrate' in nav,
    share: typeof nav !== 'undefined' && 'share' in nav,
    webCrypto: typeof globalThis.crypto?.subtle !== 'undefined',
    sms: typeof nav !== 'undefined',
    tel: typeof nav !== 'undefined',
    geolocationSecureContext: secure,
  };
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface PermissionSnapshot {
  geolocation: PermissionState;
  notifications: PermissionState;
  camera: PermissionState;
  microphone: PermissionState;
  persistentStorage: PermissionState;
}

export async function readPermissions(): Promise<PermissionSnapshot> {
  const caps = detectCapabilities();

  const query = async (name: PermissionName): Promise<PermissionState> => {
    try {
      if (!navigator.permissions?.query) return 'unsupported';
      const status = await navigator.permissions.query({ name });
      return status.state as PermissionState;
    } catch {
      return 'unsupported';
    }
  };

  let persistentStorage: PermissionState = 'unsupported';
  if (caps.persistentStorage) {
    try {
      persistentStorage = (await navigator.storage.persisted()) ? 'granted' : 'prompt';
    } catch {
      persistentStorage = 'unsupported';
    }
  }

  return {
    geolocation: caps.geolocation ? await query('geolocation' as PermissionName) : 'unsupported',
    notifications: caps.notifications ? await query('notifications' as PermissionName) : 'unsupported',
    camera: await query('camera' as PermissionName),
    microphone: await query('microphone' as PermissionName),
    persistentStorage,
  };
}

export function describePermission(state: PermissionState): {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
} {
  switch (state) {
    case 'granted':
      return { label: 'Granted', tone: 'ok' };
    case 'prompt':
      return { label: 'Not yet asked', tone: 'warn' };
    case 'denied':
      return { label: 'Denied in browser settings', tone: 'bad' };
    default:
      return { label: 'Not supported here', tone: 'muted' };
  }
}

/** Rough device/OS label for the setup diagnostics panel. */
export function deviceSummary(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const platform = /android/i.test(ua)
    ? 'Android'
    : /iphone|ipad|ipod/i.test(ua)
      ? 'iOS'
      : /mac os x/i.test(ua)
        ? 'macOS'
        : /windows/i.test(ua)
          ? 'Windows'
          : /linux/i.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${platform}${navigator.onLine ? '' : ' · offline'}`;
}
