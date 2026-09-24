import { create } from 'zustand';
import type { ConnectivityInfo } from '@suraksha/shared';

/**
 * Connectivity state, published app-wide.
 *
 * The distinction that matters for this product is *access* versus *quality*:
 * the OS may report a connection while requests still fail (a captive portal, a
 * dead cellular slice). `reachable` is therefore set from real request outcomes
 * as well as `navigator.onLine`, so the UI can say "connection looks usable" only
 * when something actually worked.
 */

export interface ConnectivityState extends ConnectivityInfo {
  reachable: boolean;
  checking: boolean;
  lastErrorAt?: string;
  lastError?: string;
  probeNow: () => Promise<void>;
  note: (error?: string) => void;
  noteSuccess: () => void;
}

interface NavigatorConnection {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  onchange?: (() => void) | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function connectionInfo(): Omit<ConnectivityInfo, 'lastChangedAt'> {
  const connection = (navigator as unknown as { connection?: NavigatorConnection }).connection;
  const downlink = connection?.downlink;
  const rtt = connection?.rtt;

  return {
    state: navigator.onLine ? 'online' : 'offline',
    quality:
      !navigator.onLine
        ? 'unknown'
        : (rtt !== undefined && rtt > 500) || (downlink !== undefined && downlink < 0.6)
          ? 'slow'
          : 'good',
    effectiveType: connection?.effectiveType,
    downlinkMbps: downlink,
    rttMs: rtt,
  };
}

export const useConnectivity = create<ConnectivityState>((set, get) => ({
  ...connectionInfo(),
  reachable: navigator.onLine,
  checking: false,
  lastChangedAt: new Date().toISOString(),

  /** A HEAD request to the API health endpoint is the only real proof of access. */
  probeNow: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      set({
        reachable: response.ok,
        checking: false,
        lastChangedAt: new Date().toISOString(),
        ...connectionInfo(),
      });
    } catch {
      set({
        reachable: false,
        checking: false,
        lastChangedAt: new Date().toISOString(),
        ...connectionInfo(),
      });
    }
  },

  note: (error?: string) =>
    set({
      reachable: false,
      ...connectionInfo(),
      lastErrorAt: new Date().toISOString(),
      lastError: error,
      lastChangedAt: new Date().toISOString(),
    }),

  noteSuccess: () =>
    set({
      reachable: true,
      lastError: undefined,
      ...connectionInfo(),
      lastChangedAt: new Date().toISOString(),
    }),
}));

export function watchConnectivity(): () => void {
  const { probeNow, note } = useConnectivity.getState();

  const refresh = (fromOnline: boolean) => {
    useConnectivity.setState({ ...connectionInfo(), lastChangedAt: new Date().toISOString() });
    if (fromOnline) void probeNow();
    else note('The browser reports no connection.');
  };

  const onOnline = () => refresh(true);
  const onOffline = () => refresh(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const connection = (navigator as unknown as { connection?: NavigatorConnection }).connection;
  connection?.addEventListener?.('change', () => refresh(navigator.onLine));

  void probeNow();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    connection?.removeEventListener?.('change', () => refresh(navigator.onLine));
  };
}

export function connectionLabel(state: ConnectivityState): string {
  if (state.state === 'offline') return 'Offline — everything continues on this device';
  if (!state.reachable) return 'Connection present but the server is unreachable';
  if (state.quality === 'slow') return 'Connected — slow link, sync may lag';
  return 'Connected';
}
