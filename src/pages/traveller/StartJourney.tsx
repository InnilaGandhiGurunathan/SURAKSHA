/**
 * Start Journey — the four facts a guardian actually needs:
 * from, to, when, and who is watching.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, Info, Route, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChoiceGroup,
  Chip,
  Field,
  Input,
  Select,
  Toggle,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { JourneyMap } from '@/components/map/JourneyMap';
import { useAppState, useCircle, store } from '@/store/hooks';
import { CHECK_IN_OPTIONS, ROUTE_PRESETS } from '@/domain/seed';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/cn';

export function StartJourney() {
  const { travellerProfile, contacts, now, journey } = useAppState();
  const { primary, backup } = useCircle();
  const navigate = useNavigate();

  const [origin, setOrigin] = useState(travellerProfile.campusLabel);
  const [destination, setDestination] = useState(travellerProfile.homeLabel);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [arrivalMode, setArrivalMode] = useState<'duration' | 'clock'>('duration');
  const [arrivalClock, setArrivalClock] = useState(() => {
    const target = new Date(Date.now() + 30 * 60_000);
    return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  });
  const [interval, setIntervalMinutes] = useState(travellerProfile.preferredCheckInMinutes);
  const [customInterval, setCustomInterval] = useState(25);
  const [grace, setGrace] = useState(travellerProfile.gracePeriodMinutes);
  const [primaryId, setPrimaryId] = useState(primary?.id ?? contacts[0]?.id ?? '');
  const [backupId, setBackupId] = useState(backup?.id ?? contacts[1]?.id ?? '');
  const [routeId, setRouteId] = useState<string>(ROUTE_PRESETS[0].id);
  const [demoPacing, setDemoPacing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const routePreset = ROUTE_PRESETS.find((r) => r.id === routeId) ?? ROUTE_PRESETS[0];
  const checkInMinutes = interval === 0 ? customInterval : interval;

  const expectedArrivalAt = useMemo(() => {
    if (arrivalMode === 'duration') return now + durationMinutes * 60_000;
    const [h, m] = arrivalClock.split(':').map(Number);
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    return target.getTime();
  }, [arrivalMode, arrivalClock, durationMinutes, now]);

  const derivedDuration = Math.max(5, Math.round((expectedArrivalAt - now) / 60_000));

  const submit = () => {
    if (!origin.trim() || !destination.trim()) {
      setError('Add a starting point and a destination.');
      return;
    }
    if (!primaryId) {
      setError('Choose a primary trusted contact.');
      return;
    }
    if (expectedArrivalAt <= now) {
      setError('The expected arrival must be in the future.');
      return;
    }
    store.startJourney({
      originLabel: origin.trim(),
      destinationLabel: destination.trim(),
      expectedArrivalAt,
      etaMinutes: derivedDuration,
      checkInIntervalMinutes: checkInMinutes,
      gracePeriodMinutes: grace,
      primaryContactId: primaryId,
      backupContactId: backupId,
      routePoints: routePreset.points.map((p) => ({ ...p })),
      demoPacing,
    });
    navigate('/traveller/journey');
  };

  const alreadyActive = Boolean(journey && journey.status !== 'ENDED');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Journey setup"
        title="Start Journey"
        description="Tell SURAKSHA the plan. Your guardian is notified the moment you set off — and only about the things you agreed to share."
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

      <div className="grid gap-4 lg:grid-cols-[1.15fr_330px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Journey plan" subtitle="Four facts your guardian can act on." icon={<Compass size={16} />} />
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

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink-800">Expected arrival</span>
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {(['duration', 'clock'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setArrivalMode(mode)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-[12px] font-semibold transition-state',
                          arrivalMode === mode ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
                        )}
                      >
                        {mode === 'duration' ? 'Duration' : 'Clock time'}
                      </button>
                    ))}
                  </div>
                </div>

                {arrivalMode === 'duration' ? (
                  <ChoiceGroup
                    name="duration"
                    columns={4}
                    value={durationMinutes}
                    onChange={setDurationMinutes}
                    options={[10, 20, 30, 45].map((m) => ({ value: m, label: `${m} min`, hint: m === 30 ? 'typical' : undefined }))}
                  />
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
                  Arriving about {formatClock(expectedArrivalAt)} · {derivedDuration} minutes from now
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Check-in frequency" hint="How often SURAKSHA asks “Everything okay?”">
                  <ChoiceGroup
                    name="interval"
                    columns={3}
                    size="sm"
                    value={interval}
                    onChange={setIntervalMinutes}
                    options={[
                      ...CHECK_IN_OPTIONS.map((m) => ({ value: m as number, label: `${m} min` })),
                      { value: 0, label: 'Custom' },
                    ]}
                  />
                </Field>
                <Field label="Grace period" hint="Extra time before a check-in counts as missed.">
                  <ChoiceGroup
                    name="grace"
                    columns={3}
                    size="sm"
                    value={grace}
                    onChange={setGrace}
                    options={[1, 2, 5].map((m) => ({ value: m, label: `${m} min` }))}
                  />
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Expected route" subtitle="Optional — a corridor, not a cage. Deviations are observations, not verdicts." icon={<Route size={16} />} />
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

              <div className="rounded-xl border border-ink-200 divide-y divide-ink-200">
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
            <CardHeader title="Route preview" subtitle="Simulated map · check-ins marked along the corridor." icon={<Route size={16} />} />
            <CardBody className="pt-3">
              <JourneyMap
                journey={null}
                position={routePreset.points[0]}
                height="h-[220px]"
                loading={false}
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
