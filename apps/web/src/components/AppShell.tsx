import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Home,
  LifeBuoy,
  Map,
  Settings as SettingsIcon,
  Shield,
  Users,
  WifiOff,
} from 'lucide-react';
import type { UserProfile } from '@suraksha/shared';
import { cn } from '@/lib/utils';
import { useConnectivity } from '@/store/connectivity';
import { useMonitor } from '@/store/monitor';
import { unreadCount } from '@/services/notifications';
import { db } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { BrandLockup, Shield as ShieldMark } from './Shield';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ConnectivityPill } from './StatusPieces';
import { CheckInDialog } from './CheckInDialog';
import { InstallPrompt } from './InstallPrompt';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * The application shell.
 *
 * Three things are always present, because they are the ones a traveller needs
 * in a hurry: the SOS control, the current monitoring state, and an unambiguous
 * connectivity indicator. Everything else is one tap away.
 */

const NAV_ITEMS = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/journeys', label: 'Journeys', icon: Map },
  { to: '/app/report', label: 'Reports', icon: Shield },
  { to: '/app/contacts', label: 'Contacts', icon: Users },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
] as const;

export function AppShell({ user }: { user: UserProfile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useConnectivity();
  const monitoring = useMonitor((store) => store.monitoring);
  const checkIn = useMonitor((store) => store.checkIn);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const unread = useLiveQuery(async () => unreadCount(user.id), [user.id, location.pathname], 0);
  const openReports = useLiveQuery(
    async () =>
      (await db.reports.where('ownerId').equals(user.id).toArray()).filter(
        (report) => report.status !== 'acknowledged' && report.status !== 'synced' && report.status !== 'verified',
      ).length,
    [user.id],
    0,
  );

  // Scroll to the top on navigation: a safety app should never drop you halfway
  // down a previous screen.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  return (
    <div className="app-shell flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-lg safe-top">
        <div className="shell flex items-center gap-3 px-4 py-2.5">
          <Link to="/app" className="flex items-center gap-2.5" aria-label="SURAKSHA home">
            <ShieldMark className="size-8" />
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-[0.18em]">SURAKSHA</span>
              <span className="block text-[9px] uppercase tracking-[0.12em] text-teal-600 dark:text-teal-300">
                Your Safety, Our Priority
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <ConnectivityPill />
            {monitoring ? (
              <Badge variant="info" className="hidden py-1 sm:inline-flex">
                monitoring
              </Badge>
            ) : null}
            <Button variant="ghost" size="icon-sm" asChild aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Link to="/app/notifications" className="relative grid place-items-center">
                <Bell className="size-4" />
                {unread ? (
                  <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-sos text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {state === 'offline' && !bannerDismissed ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
          <div className="shell flex items-start gap-2">
            <WifiOff className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="flex-1 text-[11px] leading-snug text-amber-900 dark:text-amber-100">
              You are offline. Journeys, checkpoints, risk scoring, SOS and incident reports all keep working
              on this device — reports stay queued until a connection returns.
            </p>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              className="text-[11px] font-semibold underline"
            >
              Hide
            </button>
          </div>
        </div>
      ) : null}

      {openReports > 0 && location.pathname !== '/app/report' ? (
        <Link
          to="/app/report"
          className="border-b border-border bg-muted/40 px-4 py-1.5 text-center text-[11px] text-muted-foreground"
        >
          {openReports} incident report(s) are still only on this device — tap to see their delivery status
        </Link>
      ) : null}

      <main className="shell flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      {/* SOS is always reachable, and never hidden behind a menu. */}
      <button
        type="button"
        onClick={() => navigate('/app/sos')}
        className="fixed bottom-20 right-4 z-40 grid size-16 place-items-center rounded-full bg-sos text-sos-foreground shadow-[var(--shadow-sos)] transition-transform active:scale-95 sm:bottom-24 sm:right-6"
        aria-label="Open emergency SOS"
      >
        <span className="absolute inset-0 rounded-full animate-sos-ring bg-sos/40" aria-hidden />
        <LifeBuoy className="relative size-7" />
      </button>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 backdrop-blur-lg safe-bottom"
        aria-label="Primary"
      >
        <ul className="shell flex items-stretch">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors',
                    isActive ? 'text-accent' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <CheckInDialog ownerId={user.id} checkIn={checkIn} />
      <InstallPrompt />
      <UpdatePrompt />
    </div>
  );
}

export { BrandLockup };
