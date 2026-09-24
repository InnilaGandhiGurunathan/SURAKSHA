import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks matchMedia — used by the responsive hooks.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (!window.scrollTo) {
  Object.defineProperty(window, 'scrollTo', { writable: true, value: () => undefined });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
