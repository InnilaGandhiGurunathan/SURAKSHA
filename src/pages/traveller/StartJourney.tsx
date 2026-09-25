/**
 * Start Journey — plan like a maps app, watch like a guardian.
 *
 * The left column holds a Google-Maps-style route planner (mode tabs, depart /
 * arrive-by, traffic model, custom speed, avoid options, turn steps). The right
 * column keeps the route preset + circle pickers. Everything feeds one
 * `startJourney` call that also stores the route preferences for the live
 * journey screen to re-plan against.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, Info, Route, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Field,
  Input,
  Select,
  Toggle,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { RouteOptionsPanel } from '@/components/domain/RouteOptionsPanel';
import { JourneyMap } from '@/components/map/JourneyMap';
import { useMapSurface } from '@/components/map/useGoogleMaps';
import { useAppState, useCircle, store } from '@/store/hooks';
import { CHECK_IN_OPTIONS, ROUTE_PRESETS } from '@/domain/seed';
import { buildRouteOptions, resolveTraffic } from '@/domain/routing';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { RouteMode, RouteOption, RoutePreferences } from '@/domain/types';

export function StartJourney() {
  const { travellerProfile, contacts, now, journey } = useAppState();
  const { primary, backup } = useCircle();
  const navigate = useNavigate();
  const mapSurface = useMapSurface();

  const [origin, setOrigin] = useState(travellerProfile.campusLabel);
  const [destination, setDestination] = useState(travellerProfile.homeLabel);
  const [interval, setIntervalMinutes] = useState(travellerProfile.preferredCheckInMinutes);
  const [customInterval, setCustomInterval] = useState(25);
  const [grace, setGrace] = useState(travellerProfile.gracePeriodMinutes);
  const [primaryId, setPrimaryId] = useState(primary?.id ?? contacts[0]?.id ?? '');
  const [backupId, setBackupId] = useState(backup?.id ?? contacts[1]?.id ?? '');
  const [routeId, setRouteId] = useState<string>(ROUTE_PRESETS[0].id);
  const [demoPacing, setDemoPacing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Maps-style route planning state
  const [mode, setMode] = useState<RouteMode>('fastest');
  const [preferences, setPreferences] = useState<RoutePreferences>({
    departAt: 'now',
    customDepartureAt: null,
    arriveBy: false,
    customArrivalAt: null,
    avoid: [],
    speedFactor: 1,
    presetTraffic: 'light',
    previewOverride: null,
  });
  const [pendingTraffic, setPendingTraffic] = useState(preferences.presetTraffic);

  // Canonical "Expected arrival" toggle (Duration / Clock time). Lives here so
  // the virtual-clock contract is one, well-known place.
  const [arrivalMode, setArrivalMode] = useState<'duration' | 'clock'>('duration');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [arrivalClock, setArrivalClock] = useState(() => {
    const target = new Date(now + 30 * 60_000);
    return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  });

  const routePreset = ROUTE_PRESETS.find((r) => r.id === routeId) ?? ROUTE_PRESETS[0];
  const checkInMinutes = interval === 0 ? customInterval : interval;

  const options: RouteOption[] = useMemo(() => {
    const traffic = preferences.presetTraffic ?? resolveTraffic(preferences);
    const list = buildRouteOptions(routePreset.points.map((p) => ({ ...p })), preferences.speedFactor ?? 1, traffic);
    // An avoid-caused traffic shift is reflected without re-rolling the set.
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePreset, preferences.speedFactor, preferences.presetTraffic, mode]);

  // Chosen option drives the ETA.
  const chosen = options.find((o) => o.mode === mode) ?? options[0];

  const recalc = () => {
    setPreferences((p) => ({
      ...p,
      presetTraffic: (p.avoid.includes('highways') ? 'heavy' : p.avoid.includes('tolls') ? 'moderate' : 'light') as 'light' | 'moderate' | 'heavy',
    }));
  };

  // The canonical arrival the whole form submits. In clock mode it is read from
  // the simulator's clock; in duration mode it falls out of the chosen mode's
  // estimate. Always >= now + 1min.
  const arrivalAt = useMemo(() => {
    if (arrivalMode === 'clock') {
      const [h, m] = arrivalClock.split(':').map(Number);
      const target = new Date(now);
      target.setHours(h || 0, m || 0, 0, 0);
      if (target.getTime() <= now) target.setDate(target.getDate() + 1);
      return target.getTime();
    }
    const depart =
      preferences.departAt === 'custom' && preferences.customDepartureAt
        ? preferences.customDepartureAt
        : now;
    return depart + (chosen?.durationMin ?? 30) * 60_000;
  }, [arrivalMode, arrivalClock, now, preferences, chosen]);

  const derivedDuration = Math.max(5, Math.round((arrivalAt - now) / 60_000));

  const submit = () => {
    if (!origin.trim() || !destination.trim()) {
      setError('Add a starting point and a destination.');
      return;
    }
    if (!primaryId) {
      setError('Choose a primary trusted contact.');
      return;
    }
    const durationMin = derivedDuration;
    const expectedArrivalAt = arrivalAt;
    if (expectedArrivalAt <= now + 60_000) {
      setError('The expected arrival must be in the future — adjust the departure or route.');
      return;
    }
    store.startJourney({
      originLabel: origin.trim(),
      destinationLabel: destination.trim(),
      expectedArrivalAt,
      etaMinutes: durationMin,
      checkInIntervalMinutes: checkInMinutes,
      gracePeriodMinutes: grace,
      primaryContactId: primaryId,
      backupContactId: backupId,
      routePoints: routePreset.points.map((p) => ({ ...p })),
      demoPacing,
      routePreferences: preferences,
      routeOptions: options,
      routeMode: mode,
    });
    navigate('/traveller/journey');
  };

  const alreadyActive = Boolean(journey && journey.status !== 'ENDED');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Journey setup"
        title="Start Journey"
        description="Plan the route like a maps app — modes, traffic, departure and arrive-by — then tell SURAKSHA who watches. Your guardian is notified the moment you set off."
        actions={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>
            Back
          </Button>
        }
      />

      {alreadyActive ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-[13px] font-medium text-brand-900">
            A journey is already running. Starting a new one closes it.
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/traveller/journey')}>
            Open active journey
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Route planner (maps-style) */}
          <Card>
            <CardHeader title="Route & ETA" subtitle="Modes, traffic, speed, depart / arrive-by — like your maps app." icon={<Route size={16} />} />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starting location" htmlFor="origin" hint="Where you are now.">
                  <Input
                    id="origin"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    placeholder="IIT Campus"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Destination" htmlFor="destination" hint="Where you are heading.">
                  <Input
                    id="destination"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="Home"
                    autoComplete="off"
                  />
                </Field>
              </div>

              <RouteOptionsPanel
                variant="plan"
                origin={origin || 'Starting point'}
                destination={destination || 'Destination'}
                options={options}
                mode={mode}
                onMode={setMode}
                preferences={{ ...preferences, presetTraffic: pendingTraffic }}
                onPreferences={(p) => {
                  setPreferences((prev) => ({ ...prev, ...p, presetTraffic: p.presetTraffic ?? prev.presetTraffic }));
                  setPendingTraffic(p.presetTraffic ?? pendingTraffic);
                }}
                onRefresh={recalc}
                now={now}
                arrivalAt={arrivalAt}
              />

              {/* Canonical expected-arrival toggle — the one block that owns the
                  virtual-clock contract for this form. */}
              <div className="rounded-xl border border-ink-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink-800">Expected arrival</span>
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {(['duration', 'clock'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setArrivalMode(m)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-[12px] font-semibold transition-state',
                          arrivalMode === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
                        )}
                      >
                        {m === 'duration' ? 'Duration' : 'Clock time'}
                      </button>
                    ))}
                  </div>
                </div>

                {arrivalMode === 'duration' ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm font-bold text-ink-900">{durationMinutes} min</p>
                    <input
                      type="range"
                      min={10}
                      max={60}
                      step={5}
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="h-2 w-40 cursor-pointer appearance-none rounded-full bg-ink-200 accent-brand-600"
                    />
                    <span className="text-[11.5px] text-ink-500">slide to adjust</span>
                  </div>
                ) : (
                  <Input
                    type="time"
                    value={arrivalClock}
                    onChange={(e) => setArrivalClock(e.target.value)}
                    className="max-w-[160px]"
                    aria-label="Expected arrival time"
                  />
                )}

                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-500">
                  <Info size={13} className="text-ink-400" />
                  Arriving about {formatClock(arrivalAt)} · {derivedDuration} minutes from now
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Expected route" subtitle="Optional — a corridor, not a cage. Deviations are observations, not verdicts." icon={<Compass size={16} />} />
            <CardBody className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {ROUTE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setRouteId(preset.id)}
                    className={cn(
                      'rounded-xl border px-3.5 py-3 text-left transition-state',
                      routeId === preset.id
                        ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                        : 'border-ink-200 bg-white hover:bg-ink-50',
                    )}
                  >
                    <span className="block text-[13.5px] font-semibold text-ink-800">{preset.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{preset.detail}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip tone="safe">Corridor ~34 m either side</Chip>
                <Chip tone="watch">Deviation → WATCH, not danger</Chip>
                <Chip tone="neutral">Simulated GPS</Chip>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Trusted circle for this journey" subtitle="Escalation order: primary → backup → emergency workflow." icon={<ShieldCheck size={16} />} />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Primary contact" htmlFor="primary">
                  <Select id="primary" value={primaryId} onChange={(e) => setPrimaryId(e.target.value)}>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} — {contact.relationship}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Backup contact" htmlFor="backup">
                  <Select id="backup" value={backupId} onChange={(e) => setBackupId(e.target.value)}>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} — {contact.relationship}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Check-in frequency" hint="How often SURAKSHA asks “Everything okay?”">
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {[...CHECK_IN_OPTIONS.map((m) => ({ value: m as number, label: `${m} min` })), { value: 0, label: 'Custom' }].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setIntervalMinutes(opt.value)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-[12px] font-semibold transition-state',
                          interval === opt.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Grace period" hint="Extra time before a check-in counts as missed.">
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {[1, 2, 5].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setGrace(m)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-[12px] font-semibold transition-state',
                          grace === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
                        )}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              {interval === 0 ? (
                <Field label="Custom interval" hint="Between 3 and 120 minutes.">
                  <Input
                    type="number"
                    min={3}
                    max={120}
                    value={customInterval}
                    onChange={(e) => setCustomInterval(Math.max(3, Math.min(120, Number(e.target.value) || 15)))}
                    className="max-w-[140px]"
                  />
                </Field>
              ) : null}

              <div className="rounded-xl border border-ink-200">
                <Toggle
                  checked={demoPacing}
                  onChange={setDemoPacing}
                  label="Demo pacing — first check-in after 60 seconds"
                  description="Useful for a live walkthrough. Off uses your full check-in interval."
                />
              </div>
            </CardBody>
          </Card>

          {error ? (
            <p className="rounded-xl border border-critical-200 bg-critical-50 px-4 py-3 text-[13px] font-medium text-critical-800">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="xl" icon={<Sparkles size={19} />} onClick={submit} className="min-w-[220px]">
              START JOURNEY
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/traveller')}>
              Not now
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Route preview"
              subtitle={`${mapSurface.headerLabel} · check-ins marked along the corridor.`}
              icon={<Route size={16} />}
            />
            <CardBody className="pt-3">
              <JourneyMap
                journey={null}
                position={routePreset.points[0]}
                height="h-[220px]"
                loading={false}
                previewRoute={routePreset.points.map((p) => ({ ...p }))}
              />
              <div className="mt-3 space-y-2 text-[12.5px] text-ink-600">
                <p className="flex items-start gap-2">
                  <Zap size={14} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    When you press START JOURNEY, SURAKSHA creates the journey, logs{' '}
                    <code className="rounded bg-ink-100 px-1 py-0.5 text-[11.5px] font-semibold">journey_started</code>,
                    sets the state to <strong className="font-semibold">SAFE</strong> and notifies your primary guardian.
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 shrink-0 text-ink-400" />
                  <span>Nobody is added to your circle without your action here, and location can be paused at any time.</span>
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
