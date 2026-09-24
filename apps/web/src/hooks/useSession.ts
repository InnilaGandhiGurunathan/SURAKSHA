import { useCallback, useEffect, useState } from 'react';
import type { UserProfile } from '@suraksha/shared';
import { currentUser, signOut as signOutService } from '@/services/auth';
import { db } from '@/lib/db';

/**
 * The signed-in traveller.
 *
 * There is always an offline path: if the browser is offline when the app opens,
 * the profile is read from IndexedDB and the session stays valid. The only thing
 * that can invalidate it is an explicit sign-out.
 */
export interface SessionState {
  user?: UserProfile;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (patch: Partial<UserProfile>) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): SessionState {
  const [user, setUser] = useState<UserProfile | undefined>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const found = await currentUser();
    setUser(found ?? undefined);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<UserProfile>) => {
      if (!user) return;
      const next: UserProfile = { ...user, ...patch, updatedAt: new Date().toISOString() };
      await db.users.put(next);
      setUser(next);
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await signOutService();
    setUser(undefined);
  }, []);

  return { user, loading, refresh, update, signOut };
}
