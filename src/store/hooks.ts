import { alertBelongsToGuardian } from '@/domain/guardianScope';
/** React bindings for the store (external-store subscription, no context churn). */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SurakshaStore, type AppState } from './store';

export const store = new SurakshaStore();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Read the store without subscribing (event handlers, effects). */
export function readState(): AppState {
  return store.getState();
}

export function useStore(): SurakshaStore {
  return store;
}

/** The virtual clock. Re-renders about once a second. */
export function useNow(): number {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().now,
    () => store.getState().now,
  );
}

/** 1 Hz ticker for countdown displays that must not depend on store updates. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/** A ticking value derived from the store clock. */
export function useCountdown(target: number | null | undefined): number | null {
  const now = useNow();
  useTicker(500);
  if (!target) return null;
  return Math.max(0, target - now);
}

/**
 * Fires `onFire` once when the condition flips false → true.
 * Used for demo beats like "the simulated call is ringing".
 */
export function useEdgeTrigger(condition: boolean, onFire: () => void): void {
  const previous = useRef(condition);
  const handler = useRef(onFire);
  handler.current = onFire;
  useEffect(() => {
    if (condition && !previous.current) handler.current();
    previous.current = condition;
  }, [condition]);
}

/** Media query hook for the few places where layout logic differs. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** Convenience: contacts resolved into primary/backup slots. */
export function useCircle() {
  const { contacts } = useAppState();
  return useMemo(() => {
    const primary = contacts.find((c) => c.slots.includes('primary')) ?? null;
    const backup = contacts.find((c) => c.slots.includes('backup')) ?? null;
    return { contacts, primary, backup };
  }, [contacts]);
}

/** Use the same guardian scope for list, badges and dashboard counts. */
export function useGuardianAlerts() {
  const { alerts, guardianProfile } = useAppState();
  return alerts.filter((alert) => alertBelongsToGuardian(alert, guardianProfile));
}
