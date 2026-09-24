/** Demo role switcher — one tap between Traveller and Guardian. */

import { useNavigate } from 'react-router-dom';
import { Activity, User } from 'lucide-react';
import type { Role } from '@/domain/types';
import { cn } from '@/lib/cn';
import { store, useAppState } from '@/store/hooks';
import { useMediaQuery } from '@/store/hooks';
import { homeForRole } from './nav';

export function RoleSwitcher({ variant }: { variant: 'compact' | 'full' }) {
  const { role, travellerProfile, guardianProfile } = useAppState();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const switchTo = (next: Role) => {
    store.setRole(next);
    navigate(homeForRole(next));
  };

  const people: Array<{ role: Role; name: string; sub: string; icon: typeof User }> = [
    { role: 'traveller', name: travellerProfile.name, sub: 'Traveller', icon: User },
    { role: 'guardian', name: guardianProfile.name, sub: 'Guardian', icon: Activity },
  ];

  return (
    <div className="space-y-1.5">
      {variant === 'full' ? <p className="sr-label px-1">Switch demo role</p> : null}
      <div
        className={cn('grid gap-1.5', variant === 'compact' ? 'grid-cols-1' : 'grid-cols-2')}
        role="radiogroup"
        aria-label="Demo role"
      >
        {people.map((person) => {
          const active = person.role === role;
          return (
            <button
              key={person.role}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => switchTo(person.role)}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-state',
                active
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
                variant === 'compact' && 'py-2',
              )}
            >
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                  active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500',
                )}
              >
                <person.icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink-900">{person.name}</span>
                <span className="block text-[11px] font-medium text-ink-500">
                  {person.sub}
                  {active && isDesktop ? ' · active' : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
