/**
 * DemoPanel — the judge-facing controller.
 *
 * Everything needed to run the 2–3 minute SURAKSHA scenario without waiting for
 * real time: start the canonical journey, walk it through WATCH → ALERT →
 * CRITICAL, jump between roles, and reset the whole scenario.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CircleSlash,
  FlaskConical,
  Gauge,
  MapPinOff,
  PhoneCall,
  Play,
  RotateCcw,
  RouteOff,
  ShieldAlert,
  TimerOff,
  TrendingDown,
  TriangleAlert,
  X,
  Rocket,
} from 'lucide-react';
import { Button, Chip, Segmented, StatusPill } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { store, useAppState } from '@/store/hooks';
import { DEMO_SPEEDS } from '@/store/store';
import { homeForRole } from './nav';

export function DemoPanel() {
  const {
    ui,
    journey,
    role,
    simSpeed,
    travellerProfile,
    exitMode,
    events,
    now,
  } = useAppState();
  const navigate = useNavigate();
  const [showScript, setShowScript] = useState(true);

  const open = ui.demoPanelOpen;
  if (!open) return null;

  const hasJourney = Boolean(journey && journey.status !== 'ENDED');
  const step = deriveStep({
    hasJourney,
    deviation: journey?.deviationCount ?? 0,
    missed: journey?.checkIn.missedCount ?? 0,
    exitArmed: Boolean(exitMode?.active),
    band: journey?.risk.band ?? 'SAFE',
  });

  const close = () => store.toggleUi('demoPanelOpen', false);

  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-[2px]" onClick={close} aria-hidden />
      <aside
        className="relative z-10 flex h-full w-full max-w-md animate-slide-in-right flex-col border-l border-ink-200 bg-white shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Demo controls"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
              <FlaskConical size={17} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-ink-900">Demo Mode</h2>
              <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
                Simulate the full workflow — SAFE → WATCH → ALERT → CRITICAL → RESPONSE.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-500 transition-state hover:bg-ink-100"
            aria-label="Close demo controls"
          >
            <X size={18} />
          </button>
        </header>

        <div className="sr-scroll flex-1 overflow-y-auto px-5 py-4">
          {/* Live state */}
          <section className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="sr-label">Live risk state</span>
              <StatusPill band={journey?.risk.band ?? 'SAFE'} size="sm" showEmoji={false} />
            </div>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-3xl font-bold tabular text-ink-900">{journey?.risk.score ?? 0}</span>
              <span className="pb-1 text-[12px] font-medium text-ink-500">
                {events.length} events · {journey ? journey.checkIn.missedCount : 0} missed check-ins
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-semibold text-ink-500">Virtual clock speed</span>
              <Segmented
                size="sm"
                value={String(simSpeed)}
                onChange={(value) => store.setSimSpeed(Number(value))}
                options={DEMO_SPEEDS.map((speed: number) => ({ value: String(speed), label: `${speed}×` }))}
              />
            </div>
          </section>

          {/* Role + navigation */}
          <section className="mt-4">
            <p className="sr-label">Jump to a view</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<ShieldAlert size={15} />}
                onClick={() => {
                  store.setRole('guardian');
                  navigate('/guardian');
                  close();
                }}
              >
                Guardian dashboard
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<Activity size={15} />}
                onClick={() => {
                  store.setRole('traveller');
                  navigate('/traveller/journey');
                  close();
                }}
              >
                Active journey
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<BellRing size={15} />}
                onClick={() => {
                  store.setRole('guardian');
                  navigate('/guardian/alerts');
                  close();
                }}
              >
                Alerts
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<TrendingDown size={15} />}
                onClick={() => {
                  store.setRole('traveller');
                  navigate('/traveller/incidents');
                  close();
                }}
              >
                Incident detail
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-500">
              Currently acting as <strong className="font-semibold text-ink-700">{role}</strong>. The role switcher is
              always in the sidebar and the mobile “More” sheet.
            </p>
          </section>

          {/* Simulation controls */}
          <section className="mt-5">
            <p className="sr-label">Simulate</p>
            <div className="mt-2 space-y-2">
              <DemoAction
                icon={<Play size={16} />}
                label={hasJourney ? 'Restart the canonical journey' : 'Start journey (10:42 PM)'}
                hint="Campus → Home · ETA 30 min · check-in every 10 min · friend as guardian"
                onClick={() => {
                  store.clearJourney();
                  store.startCanonicalJourney();
                  store.setRole('traveller');
                  navigate('/traveller/journey');
                  close();
                }}
                tone="brand"
              />
              <DemoAction
                icon={<RouteOff size={16} />}
                label="Move off route"
                hint="Traveller leaves the expected corridor — raises WATCH and asks “Everything okay?”"
                disabled={!hasJourney}
                onClick={() => store.moveOffRoute()}
                tone="watch"
              />
              <DemoAction
                icon={<Gauge size={16} />}
                label="Send a check-in now"
                hint="Opens the “Everything okay?” prompt with a live grace countdown"
                disabled={!hasJourney}
                onClick={() => {
                  store.sendCheckInNow();
                  store.setRole('traveller');
                  navigate('/traveller/journey');
                  close();
                }}
              />
              <DemoAction
                icon={<TimerOff size={16} />}
                label="Miss the check-in"
                hint="Records ‘safety check-in missed’, adds +25, escalates to ALERT"
                disabled={!hasJourney}
                onClick={() => {
                  if (journey?.checkIn.state !== 'REQUESTED') store.sendCheckInNow();
                  store.missCheckIn(true);
                }}
                tone="alert"
              />
              <DemoAction
                icon={<RouteOff size={16} />}
                label="Second deviation (+10)"
                hint="Repeated deviation stacks the risk reasons"
                disabled={!hasJourney || (journey?.deviationCount ?? 0) === 0}
                onClick={() => store.moveOffRoute('Demo control: second off-route segment')}
                tone="watch"
              />
              <DemoAction
                icon={<TrendingDown size={16} />}
                label="Back on route"
                hint="Returns the traveller to the expected corridor"
                disabled={!hasJourney || !journey?.deviationActive}
                onClick={() => store.restoreRoute()}
              />
              <DemoAction
                icon={<TimerOff size={16} />}
                label="Shift planned arrival earlier (late arrival)"
                hint="Adds the +10 late-arrival signal without waiting"
                disabled={!hasJourney}
                onClick={() => store.simulateEtaSlip(3)}
              />
              <DemoAction
                icon={<PhoneCall size={16} />}
                label="Trigger Exit Mode"
                hint="Arms a simulated incoming call and opens the call screen"
                onClick={() => {
                  store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' });
                  store.setRole('traveller');
                  navigate('/traveller/exit');
                  close();
                }}
                tone="brand"
              />
              <DemoAction
                icon={<ShieldAlert size={16} />}
                label="Trigger Quick SOS (+50 → CRITICAL)"
                hint="Creates the incident, notifies the circle, opens the incident view"
                disabled={!hasJourney}
                onClick={() => {
                  const incident = store.triggerSos('demo');
                  store.setRole('traveller');
                  navigate(incident ? `/traveller/incidents/${incident.id}` : '/traveller/incidents');
                  close();
                }}
                tone="critical"
              />
              <DemoAction
                icon={<TriangleAlert size={16} />}
                label={journey?.zoneExcursion ? 'Leave the demo risk zone' : 'Stop inside a risk zone (+15)'}
                hint="Fictional zone on the simulator map — shows the zone rule and its reason line"
                disabled={!hasJourney}
                onClick={() => (journey?.zoneExcursion ? store.leaveRiskZone() : store.enterRiskZone())}
                tone="watch"
              />
              <DemoAction
                icon={<MapPinOff size={16} />}
                label="Toggle location availability"
                hint="Demonstrates the ‘location unavailable — last known position’ state"
                disabled={!hasJourney}
                onClick={() => store.setLocationAvailable(!(journey?.locationAvailable ?? true))}
              />
            </div>
          </section>

          {/* Demo script */}
          <section className="mt-5">
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="sr-label">2-minute demo script</span>
              <span className="text-[11.5px] font-semibold text-brand-700">{showScript ? 'Hide' : 'Show'}</span>
            </button>
            {showScript ? (
              <ol className="mt-2 space-y-2">
                {[
                  ['Start journey', 'Journey active, guardian notified, SAFE.'],
                  ['Move off route', 'WATCH — “route change detected”, guardian prompted.'],
                  ['Send + miss check-in', 'ALERT — missed check-in, incident created, circle alerted.'],
                  ['Trigger Exit Mode', 'Simulated incoming call, scripted transcript.'],
                  ['Trigger Quick SOS', 'CRITICAL — incident with explanation and evidence.'],
                  ['Open Guardian dashboard', 'Acknowledge the alert, watch the timeline fill.'],
                ].map(([title, body], index) => {
                  const state = index < step ? 'done' : index === step ? 'current' : 'todo';
                  return (
                    <li
                      key={title}
                      className={cn(
                        'flex gap-3 rounded-xl border px-3 py-2.5 transition-state',
                        state === 'current'
                          ? 'border-brand-300 bg-brand-50'
                          : state === 'done'
                            ? 'border-safe-200 bg-safe-50/60'
                            : 'border-ink-200 bg-white',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                          state === 'current'
                            ? 'bg-brand-600 text-white'
                            : state === 'done'
                              ? 'bg-safe-600 text-white'
                              : 'bg-ink-100 text-ink-500',
                        )}
                      >
                        {state === 'done' ? '✓' : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                          {title}
                          {state === 'current' ? <ArrowRight size={13} className="text-brand-600" /> : null}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{body}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </section>

          <section className="mt-5 rounded-xl border border-ink-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-ink-800">Demo mode</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                  Off hides the demo controls and the seeded scenario framing.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={travellerProfile.demoMode}
                onClick={() => store.setDemoMode(!travellerProfile.demoMode)}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-state',
                  travellerProfile.demoMode ? 'bg-safe-500' : 'bg-ink-300',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-state',
                    travellerProfile.demoMode ? 'left-[22px]' : 'left-0.5',
                  )}
                />
              </button>
            </div>
          </section>

          <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
            <CircleSlash size={13} className="mt-0.5 shrink-0 text-ink-400" />
            <span>
              All data is fictional and stored on this device. SURAKSHA never dials emergency services for you and never
              claims to know whether someone is in danger.
            </span>
          </p>
        </div>

        <footer className="border-t border-ink-200 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={15} />}
              onClick={() => {
                store.resetDemo();
                navigate(homeForRole(store.getState().role));
              }}
            >
              RESET DEMO
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<BadgeCheck size={15} />}
              onClick={() => {
                store.setRole(role === 'traveller' ? 'guardian' : 'traveller');
                navigate(homeForRole(role === 'traveller' ? 'guardian' : 'traveller'));
                close();
              }}
            >
              Switch to {role === 'traveller' ? 'Guardian' : 'Traveller'}
            </Button>
            <Chip tone="neutral" className="ml-auto">
              <Rocket size={12} /> {now > 0 ? 'Sim clock running' : ''}
            </Chip>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function DemoAction({
  icon,
  label,
  hint,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'brand' | 'watch' | 'alert' | 'critical';
}) {
  const toneClasses = {
    neutral: 'border-ink-200 hover:border-ink-300 hover:bg-ink-50 text-ink-700',
    brand: 'border-brand-200 bg-brand-50/60 hover:bg-brand-50 text-brand-800',
    watch: 'border-watch-200 bg-watch-50/70 hover:bg-watch-50 text-watch-800',
    alert: 'border-alert-200 bg-alert-50/70 hover:bg-alert-50 text-alert-800',
    critical: 'border-critical-200 bg-critical-50/70 hover:bg-critical-50 text-critical-800',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-state',
        toneClasses,
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{hint}</span>
      </span>
    </button>
  );
}

/** Which demo beat we are on, used to highlight the script. */
function deriveStep(input: {
  hasJourney: boolean;
  deviation: number;
  missed: number;
  exitArmed: boolean;
  band: 'SAFE' | 'WATCH' | 'ALERT' | 'CRITICAL';
}): number {
  if (!input.hasJourney) return 0;
  if (input.band === 'CRITICAL') return 5;
  if (input.exitArmed) return 4;
  if (input.missed > 0) return 3;
  if (input.deviation > 0) return 2;
  return 1;
}
