/**
 * Permission handling.
 *
 * Every capability the app depends on is probed *before* it is needed and the
 * result is surfaced in plain language, because a safety app that silently fails
 * to get GPS is worse than one that explains itself.
 */

export type PermissionName = 'geolocation' | 'notifications' | 'persistent-storage' | 'wake-lock' | 'vibration';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

export interface PermissionSnapshot {
  geolocation: PermissionState;
  notifications: PermissionState;
  persistentStorage: PermissionState;
  wakeLock: PermissionState;
  vibration: PermissionState;
  checkedAt: string;
  secureContext: boolean;
  platform: 'ios' | 'android' | 'desktop' | 'other';
  standalone: boolean;
  serviceWorker: boolean;
}

export function detectPlatform(): PermissionSnapshot['platform'] {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Windows|Linux/.test(ua)) return 'desktop';
  return 'other';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari uses a non-standard flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isSecureContextOk(): boolean {
  // Geolocation, WebCrypto and service workers all require a secure context.
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export async function queryPermission(name: PermissionName): Promise<PermissionState> {
  switch (name) {
    case 'geolocation': {
      if (!('geolocation' in navigator)) return 'unsupported';
      return queryViaPermissionsApi('geolocation');
    }
    case 'notifications': {
      if (!('Notification' in window)) return 'unsupported';
      const permission = Notification.permission;
      return permission === 'default' ? 'prompt' : permission;
    }
    case 'persistent-storage': {
      if (!navigator.storage?.persisted) return 'unsupported';
      try {
        return (await navigator.storage.persisted()) ? 'granted' : 'prompt';
      } catch {
        return 'unknown';
      }
    }
    case 'wake-lock': {
      return 'wakeLock' in navigator ? 'prompt' : 'unsupported';
    }
    case 'vibration': {
      return typeof navigator.vibrate === 'function' ? 'granted' : 'unsupported';
    }
    default:
      return 'unknown';
  }
}

async function queryViaPermissionsApi(name: string): Promise<PermissionState> {
  try {
    const permissions = (navigator as unknown as { permissions?: Permissions }).permissions;
    if (!permissions?.query) return 'unknown';
    const status = await permissions.query({ name } as unknown as PermissionDescriptor);
    return status.state as PermissionState;
  } catch {
    // Firefox throws for geolocation in some versions; treat as unknown so the
    // UI asks by attempting a fix rather than claiming it is denied.
    return 'unknown';
  }
}

export async function snapshotPermissions(): Promise<PermissionSnapshot> {
  const [geolocation, notifications, persistentStorage, wakeLock, vibration] = await Promise.all([
    queryPermission('geolocation'),
    queryPermission('notifications'),
    queryPermission('persistent-storage'),
    queryPermission('wake-lock'),
    queryPermission('vibration'),
  ]);

  return {
    geolocation,
    notifications,
    persistentStorage,
    wakeLock,
    vibration,
    checkedAt: new Date().toISOString(),
    secureContext: isSecureContextOk(),
    platform: detectPlatform(),
    standalone: isStandalone(),
    serviceWorker: 'serviceWorker' in navigator,
  };
}

export function describePermission(name: PermissionName, state: PermissionState): string {
  const labels: Record<PermissionName, string> = {
    geolocation: 'Location',
    notifications: 'Notifications',
    'persistent-storage': 'Persistent storage',
    'wake-lock': 'Screen wake lock',
    vibration: 'Vibration',
  };

  const suffix: Record<PermissionState, string> = {
    granted: 'granted',
    denied: 'blocked — enable it in your browser settings',
    prompt: 'will be requested when first needed',
    unsupported: 'not supported on this browser',
    unknown: 'not yet determined',
  };

  return `${labels[name]}: ${suffix[state]}`;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result === 'default' ? 'prompt' : result;
  } catch {
    return 'unknown';
  }
}

export interface LocationFailure {
  reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unknown';
  message: string;
  remedy: string;
}

/**
 * Turns a `PositionError` into something a person can act on. Deliberately
 * explicit about what the app cannot do without a fix.
 */
export function explainLocationError(error: GeolocationPositionError | Error): LocationFailure {
  if (!isSecureContextOk()) {
    return {
      reason: 'insecure',
      message: 'Location needs a secure connection (HTTPS or localhost).',
      remedy:
        'Open SURAKSHA over HTTPS, or install it to your home screen — browsers block location on plain http:// addresses.',
    };
  }

  const code = (error as GeolocationPositionError).code;
  if (code === 1) {
    return {
      reason: 'denied',
      message: 'Location permission is blocked for this app.',
      remedy:
        'Enable location for SURAKSHA in your browser or phone settings, then reload. Journeys still run without live GPS, but checkpoints and route deviation cannot be verified.',
    };
  }
  if (code === 2) {
    return {
      reason: 'unavailable',
      message: 'No position is available right now.',
      remedy:
        'Move somewhere with a clearer view of the sky, or check that location services are switched on. The last known position stays on your device and keeps being used.',
    };
  }
  if (code === 3) {
    return {
      reason: 'timeout',
      message: 'Getting a fix took too long.',
      remedy: 'SURAKSHA will keep trying in the background. Weak GPS indoors is normal — nothing is lost.',
    };
  }
  if (!('geolocation' in navigator)) {
    return {
      reason: 'unsupported',
      message: 'This browser does not provide location to web apps.',
      remedy: 'Use a modern browser (Chrome, Safari, Edge, Firefox) or the installed app on a phone.',
    };
  }
  return {
    reason: 'unknown',
    message: 'Location could not be read.',
    remedy: 'Try again in a moment. Your journey data is unaffected either way.',
  };
}

export type GpsQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'stale' | 'none';

export function gpsQuality(accuracyMeters: number | undefined, ageMs: number | undefined): GpsQuality {
  if (accuracyMeters === undefined) return 'none';
  if (ageMs !== undefined && ageMs > 5 * 60_000) return 'stale';
  if (accuracyMeters <= 15) return 'excellent';
  if (accuracyMeters <= 40) return 'good';
  if (accuracyMeters <= 120) return 'fair';
  return 'poor';
}

export function gpsQualityLabel(quality: GpsQuality): string {
  const labels: Record<GpsQuality, string> = {
    excellent: 'GPS precise',
    good: 'GPS good',
    fair: 'GPS approximate',
    poor: 'GPS weak',
    stale: 'GPS last known',
    none: 'GPS unavailable',
  };
  return labels[quality];
}
