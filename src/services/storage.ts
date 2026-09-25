/**
 * Persistence abstraction.
 *
 * The prototype runs entirely on the device. Every write goes through this
 * interface so a Firebase (or REST) adapter can be dropped in later without
 * touching the store or the UI: implement `StorageAdapter` and swap it in
 * `createStorage()`.
 */

export interface StorageAdapter {
  readonly kind: 'local' | 'memory' | 'firebase';
  read<T>(key: string): T | null;
  write<T>(key: string, value: T, requireDurable?: boolean): void;
  remove(key: string): void;
  clearNamespace(): void;
}

const NAMESPACE = 'suraksha.v1';

function namespaced(key: string): string {
  return `${NAMESPACE}.${key}`;
}

class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  private available: boolean;

  constructor() {
    this.available = LocalStorageAdapter.probe();
  }

  private static probe(): boolean {
    try {
      const probeKey = `${NAMESPACE}.__probe`;
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  private memory = new Map<string, string>();

  read<T>(key: string): T | null {
    try {
      const raw = this.available ? window.localStorage.getItem(namespaced(key)) : this.memory.get(namespaced(key)) ?? null;
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  write<T>(key: string, value: T, requireDurable?: boolean): void {
    const raw = JSON.stringify(value);
    if (requireDurable && !this.available) throw new Error('Persistent storage is unavailable.');
    try {
      if (this.available) window.localStorage.setItem(namespaced(key), raw);
      else this.memory.set(namespaced(key), raw);
    } catch {
      if (requireDurable) throw new Error('Could not save changes. Device storage may be full.');
      // Quota or private-mode failure: fall back to in-memory for this session.
      this.memory.set(namespaced(key), raw);
    }
  }

  remove(key: string): void {
    try {
      if (this.available) window.localStorage.removeItem(namespaced(key));
    } catch {
      /* ignore */
    }
    this.memory.delete(namespaced(key));
  }

  clearNamespace(): void {
    try {
      if (this.available) {
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith(`${NAMESPACE}.`))
          .forEach((k) => window.localStorage.removeItem(k));
      }
    } catch {
      /* ignore */
    }
    this.memory.clear();
  }
}

/** Used during SSR/tests or when localStorage is unavailable. */
class MemoryStorageAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  private store = new Map<string, string>();

  read<T>(key: string): T | null {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  write<T>(key: string, value: T, requireDurable?: boolean): void {
    if (requireDurable) throw new Error('Persistent storage is unavailable.');
    this.store.set(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.store.delete(key);
  }

  clearNamespace(): void {
    this.store.clear();
  }
}

export function createStorage(): StorageAdapter {
  if (typeof window !== 'undefined' && 'localStorage' in window) return new LocalStorageAdapter();
  return new MemoryStorageAdapter();
}

export const storage = createStorage();

export const STORAGE_KEYS = {
  auth: 'auth',
  journey: 'journey',
  events: 'events',
  incidents: 'incidents',
  contacts: 'contacts',
  alerts: 'alerts',
  profiles: 'profiles',
  role: 'role',
  community: 'community',
  learning: 'learning',
  session: 'session',
  meta: 'meta',
} as const;
