import { useGuardianAlerts } from '@/store/hooks';
/**
 * AppShell — responsive chrome.
 *
 * Desktop/laptop: fixed sidebar navigation, content-first canvas.
 * Tablet: sidebar collapses to icons, content keeps its measure.
 * Mobile: sticky header + bottom navigation with Quick SOS always one tap away
 * (never buried behind a menu).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, FlaskConical, LogIn, Menu, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { navForRole, type NavItem } from './nav';
import { useAppState, store } from '@/store/hooks';
import { useAuth } from '@/store/authStore';
import { StatusPill } from '@/components/ui/primitives';
import { SosButton, SosPanel } from '@/components/domain/SosFlow';
import { CheckInPrompt } from '@/components/domain/CheckInPrompt';
import { ExitModeOverlay } from '@/components/domain/ExitMode';
import { GuardianHelpAlert } from '@/components/domain/GuardianHelpAlert';
import { Toaster } from './Toaster';
import { DemoPanel } from './DemoPanel';
import { RoleSwitcher } from './RoleSwitcher';
import { Badge } from '@/components/ui/primitives';

export function AppShell({ children }: { children: ReactNode }) {
  const { role, journey, travellerProfile, exitMode, ready } = useAppState();
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const nav = navForRole(role);
  const primaryMobile = nav.filter((item) => item.mobile).slice(0, 4);
  const secondaryMobile = nav.filter((item) => !item.mobile);
  const unreadAlerts = useGuardianAlerts().filter((a) => !a.read).length;
  const band = journey?.risk.band ?? 'SAFE';
  const demoMode = travellerProfile.demoMode;

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-raised">
            <ShieldCheck size={22} />
          </span>
          <p className="text-sm font-semibold text-ink-600">Loading SURAKSHA…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <Toaster />
      <SosPanel />
      <CheckInPrompt />
      <ExitModeOverlay />
      {/* The guardian-side surface for "I need help" — without it the traveller
          asked for help and nothing was shown to the person who could give it. */}
      <GuardianHelpAlert />
      <DemoPanel />

      <div className="lg:flex">
        <Sidebar role={role} nav={nav} unreadAlerts={unreadAlerts} band={band} />

        <div className="min-w-0 flex-1">
          <TopBar band={band} demoMode={demoMode} onOpenDemo={() => store.toggleUi('demoPanelOpen', true)} />

          <main
            key={location.pathname}
            className="mx-auto w-full max-w-[1180px] animate-fade-in-up px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:pb-14"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation.
          `transform-gpu` + `translateZ(0)` promote this fixed, blurred bar to
          its own compositing layer. It contains an infinitely animating child
          (the SOS pulse ring), which kept the layer permanently dirty, so the
          backdrop-filter behind it re-composited on every scroll frame. The
          promotion changes nothing visually. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 transform-gpu border-t border-ink-200 bg-white/95 backdrop-blur will-change-transform [transform:translateZ(0)] lg:hidden safe-bottom"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
          {primaryMobile.slice(0, 2).map((item) => (
            <MobileTab key={item.to} item={item} badge={item.to.includes('alerts') ? unreadAlerts : 0} />
          ))}

          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => (signedIn ? store.toggleUi('sosPanelOpen', true) : navigate('/login'))}
              className="relative -mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-critical-600 text-white shadow-overlay transition-state hover:bg-critical-700 active:scale-95"
              aria-label={signedIn ? 'Quick SOS' : 'Sign in to SURAKSHA'}
            >
              {!signedIn ? (
                <span className="absolute inset-0 rounded-2xl ring-2 ring-critical-300/70 animate-pulse-ring" aria-hidden />
              ) : null}
              {signedIn ? (
                <span className="text-[11px] font-bold leading-none">SOS</span>
              ) : (
                <LogIn size={20} />
              )}
            </button>
          </div>

          {primaryMobile.slice(2, 4).map((item) => (
            <MobileTab key={item.to} item={item} badge={0} />
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold text-ink-500 transition-state hover:bg-ink-100 hover:text-ink-700"
            aria-label="More navigation options"
          >
            <Menu size={20} />
            More
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={() => setMoreOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 animate-sheet-up rounded-t-3xl bg-white p-5 pb-8 shadow-overlay safe-bottom">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink-900">More</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-ink-500 hover:bg-ink-100"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <RoleSwitcher variant="full" />
            <ul className="mt-4 grid gap-1">
              {[...secondaryMobile, ...nav.filter((n) => n.mobile && !primaryMobile.includes(n))].map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-semibold transition-state',
                        isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100',
                      )
                    }
                  >
                    <item.icon size={18} />
                    {item.label}
                    <ChevronRight size={16} className="ml-auto opacity-40" />
                  </NavLink>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[11.5px] leading-relaxed text-ink-400">
              SURAKSHA · Safety Before SOS · Proactive safety, not reactive response.
            </p>
          </div>
        </div>
      ) : null}

      {/* Jump-to-guardian shortcut on the traveller journey page (desktop hint) */}
      {role === 'traveller' && journey && exitMode?.active ? (
        <button
          type="button"
          onClick={() => navigate('/traveller/exit')}
          className="fixed bottom-24 right-4 z-30 hidden rounded-full bg-ink-900 px-4 py-2 text-[12.5px] font-semibold text-white shadow-overlay lg:block"
        >
          Exit Mode active — open controls
        </button>
      ) : null}
    </div>
  );
}

function Sidebar({
  role,
  nav,
  unreadAlerts,
  band,
}: {
  role: 'traveller' | 'guardian';
  nav: NavItem[];
  unreadAlerts: number;
  band: 'SAFE' | 'WATCH' | 'ALERT' | 'CRITICAL';
}) {
  const { travellerProfile } = useAppState();
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-ink-200 bg-white lg:flex xl:w-[276px]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
          <ShieldCheck size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold leading-tight tracking-tight text-ink-900">SURAKSHA</span>
          <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
            Safety Before SOS
          </span>
        </span>
      </div>

      <div className="px-4 pb-3">
        <div className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="sr-label">{role === 'guardian' ? 'Monitored state' : 'Your state'}</span>
            <StatusPill band={band} size="sm" showEmoji={false} />
          </div>
        </div>
      </div>

      <nav className="sr-scroll flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        <ul className="space-y-0.5">
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-state',
                    isActive ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                  )
                }
              >
                <item.icon size={17} />
                <span className="flex-1">{item.label}</span>
                {item.to.includes('alerts') && unreadAlerts > 0 ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-critical-600 px-1.5 text-[10.5px] font-bold text-white">
                    {unreadAlerts}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-ink-200 p-4">
        <RoleSwitcher variant="compact" />
        <p className="mt-3 text-[10.5px] leading-relaxed text-ink-400">
          {travellerProfile.demoMode ? 'Demo mode · fictional data only' : 'Live prototype · local device storage'}
        </p>
      </div>
    </aside>
  );
}

function TopBar({
  band,
  demoMode,
  onOpenDemo,
}: {
  band: 'SAFE' | 'WATCH' | 'ALERT' | 'CRITICAL';
  demoMode: boolean;
  onOpenDemo: () => void;
}) {
  const { role, incidents, journey } = useAppState();
  const navigate = useNavigate();
  const { signedIn, user } = useAuth();
  const authName = user?.email?.split('@')[0] ?? user?.name ?? 'Account';
  const unreadAlerts = useGuardianAlerts().filter((a) => !a.read).length;
  const openIncident = incidents.find((i) => i.status !== 'RESOLVED' && i.id === journey?.incidentId);

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-4 py-3 sm:px-6">
        <span className="flex items-center gap-2 lg:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck size={16} />
          </span>
          <span className="text-[14.5px] font-bold tracking-tight text-ink-900">SURAKSHA</span>
        </span>

        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          <StatusPill band={band} size="sm" showEmoji={false} />
          <span className="truncate text-[12.5px] font-medium text-ink-500">
            {role === 'guardian'
              ? journey
                ? `Watching ${journey.travellerName} → ${journey.destinationLabel}`
                : 'No active journey to monitor'
              : journey
                ? `${journey.originLabel} → ${journey.destinationLabel}`
                : 'No active journey'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {demoMode ? (
            <button
              type="button"
              onClick={onOpenDemo}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 text-[12.5px] font-bold uppercase tracking-[0.06em] text-brand-700 transition-state hover:bg-brand-100"
            >
              <FlaskConical size={15} />
              Demo
            </button>
          ) : null}

          {role === 'guardian' ? (
            <button
              type="button"
              onClick={() => navigate('/guardian/alerts')}
              className="relative inline-flex h-10 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] font-semibold text-ink-700 transition-state hover:bg-ink-50"
            >
              Alerts
              {unreadAlerts > 0 ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-critical-600 px-1.5 text-[10.5px] font-bold text-white">
                  {unreadAlerts}
                </span>
              ) : null}
            </button>
          ) : null}

          {openIncident ? (
            <Badge tone="critical" className="hidden sm:inline-flex">
              {openIncident.code} open
            </Badge>
          ) : null}

          {signedIn ? (
            <button
              type="button"
              onClick={() => navigate(role === 'guardian' ? '/guardian/settings' : '/traveller/profile')}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] font-semibold text-ink-700 transition-state hover:bg-ink-50"
              title="Signed-in account"
            >
              <ShieldCheck size={15} className="text-safe-600" />
              <span className="hidden max-w-[140px] truncate sm:inline">{authName}</span>
            </button>
          ) : null}

          <SosButton compact />
        </div>
      </div>
    </header>
  );
}

function MobileTab({ item, badge }: { item: NavItem; badge: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10.5px] font-semibold transition-state sm:text-[11px]',
          isActive ? 'text-brand-700' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <item.icon size={20} />
            {badge > 0 ? (
              <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-critical-600 px-1 text-[9.5px] font-bold text-white">
                {badge}
              </span>
            ) : null}
          </span>
          <span className="truncate">{item.short ?? item.label}</span>
          {isActive ? <span className="absolute -top-1.5 h-0.5 w-8 rounded-full bg-brand-600" aria-hidden /> : null}
        </>
      )}
    </NavLink>
  );
}
