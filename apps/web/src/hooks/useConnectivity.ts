import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnectivity } from '@/store/connectivity';

/**
 * Connectivity with a genuinely useful meaning.
 *
 * `online` is the browser's opinion; `usable` requires that a request actually
 * succeeded recently. The UI shows "queued on device" whenever `usable` is false,
 * which is the honest answer when the phone is on a captive-portal Wi-Fi.
 */
export function useOnline() {
  const state = useConnectivity();
  return {
    online: state.state === 'online',
    usable: state.state === 'online' && state.reachable,
    quality: state.quality,
    label: state.state === 'offline' ? 'Offline' : state.reachable ? 'Online' : 'Server unreachable',
    checking: state.checking,
    probeNow: state.probeNow,
    since: state.lastChangedAt,
  };
}

/** Interval that pauses while the tab is hidden — used for live-ish screens. */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    const timer = setInterval(run, ms);
    const onVisible = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms, enabled]);
}

export interface CountdownState {
  remainingMs: number;
  remainingSeconds: number;
  elapsedMs: number;
  expired: boolean;
  percent: number;
}

/** Used by the report screen to show the real 30-second acknowledgement window. */
export function useCountdown(durationMs: number, running: boolean): CountdownState {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      startedAt.current = Date.now();
      return undefined;
    }
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
    }, 200);
    return () => clearInterval(timer);
  }, [running, durationMs]);

  const remainingMs = Math.max(0, durationMs - elapsed);
  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    elapsedMs: elapsed,
    expired: remainingMs === 0,
    percent: durationMs === 0 ? 100 : Math.min(100, (elapsed / durationMs) * 100),
  };
}

/** Small async helper that keeps loading and error state out of every screen. */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setLoading(true);
      setError(undefined);
      try {
        return await action(...args);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.');
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [action],
  );

  return { run, loading, error, setError };
}
