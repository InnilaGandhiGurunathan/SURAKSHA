import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';
import { db, SETTING_KEYS } from '@/lib/db';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Theme handling.
 *
 * Dark is the default because a safety app gets used at night, and the switch is
 * mirrored into IndexedDB so the preference survives even if localStorage is
 * cleared by the browser.
 */
function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode | null;
    return stored ?? 'dark';
  });

  useEffect(() => {
    void (async () => {
      const stored = await db.settings.get(SETTING_KEYS.theme);
      const value = stored?.value as ThemeMode | undefined;
      if (value && value !== mode) setMode(value);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const applied = resolve(mode);
    document.documentElement.classList.toggle('dark', applied === 'dark');
    document.documentElement.style.colorScheme = applied;
    localStorage.setItem(STORAGE_KEYS.theme, mode);
    void db.settings.put({ key: SETTING_KEYS.theme, value: mode, updatedAt: new Date().toISOString() });
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      const applied = resolve('system');
      document.documentElement.classList.toggle('dark', applied === 'dark');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => (resolve(current) === 'dark' ? 'light' : 'dark'));
  }, []);

  return { mode, setMode, toggle, resolved: resolve(mode) };
}
