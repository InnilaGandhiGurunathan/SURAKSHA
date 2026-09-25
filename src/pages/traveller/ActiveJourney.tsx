/**
 * Active Journey — the operational heart of the traveller experience.
 * Big map, live countdown, and exactly two big answers to "Everything okay?".
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  Flag,
  HelpCircle,
  Info,
  MapPin,
  Pause,
  Pencil,
  PhoneCall,
  Play,
  Plus,
  Radar,
  RouteOff,
  ShieldCheck,
  Signal,
  SignalZero,
  Users,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Progress,
  StatusPill,
} from '@/components/ui/primitives';
import { PageHeader, StateHero } from '@/components/domain/blocks';
import { JourneyMap } from '@/components/map/JourneyMap';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { RiskBandLadder, RiskWhyPanel } from '@/components/domain/RiskWhyPanel';
import { HelpPanel } from '@/components/domain/HelpPanel';
import { useAppState, useCircle, store } from '@/store/hooks';
import { formatClock, formatCountdown, formatDurationMinutes, formatRelative, pluralise} from '@/lib/format';
import { effectiveNow, linkQuality, estimatedArrivalAt, remainingMinutes } from '@/domain/journey';
import { cn } from '@/lib/cn';

export function ActiveJourney() {
  const { journey, events, now } = useAppState();
  const { primary } = useCircle();
  const navigate = useNavigate();
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!journey || journey.status === 'ENDED') {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Traveller · Active journey" title="Journey" />
        <EmptyState
          icon={<Compass size={22} />}
          title="No active journey"
          description="Start a journey and SURAKSHA will monitor timing, route and check-ins until you arrive."
          action={
            <Button icon={<Plus size={16} />} onClick={() => navigate('/traveller/start')}>
              Start Journey
            </Button>
          }
        />
      </div>
    );
  }

  const assessment = journey.risk;
  const paused = journey.status === 'PAUSED';
  /*
   * Every visible timer measures against `effectiveNow`, which freezes at the
   * moment a journey was paused. Using the raw store clock here meant the
   * countdowns kept draining while the journey was supposedly on hold, so
   * "paused" looked like it was doing nothing.
   */
  const clock = effectiveNow(journey, now);
  const remaining = journey.checkIn.expiresAt ? journey.checkIn.expiresAt - clock : null;
  const checkInDue = journey.checkIn.dueAt ? journey.checkIn.dueAt - clock : null;
  const quality = linkQuality(journey, now);
  const lateMinutes = Math.max(0, Math.round((clock - estimatedArrivalAt(journey, clock)) / 60_000));

  return (
    <div className="space-y-5">
      <HelpPanel />

      <PageHeader
        eyebrow="Traveller · Active journey"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {journey.originLabel}
            <ArrowRight size={18} className="text-ink-400" />
            {journey.destinationLabel}
          </span>
        }
        description={`Started ${formatClock(journey.startedAt)} · check-ins every ${journey.checkInIntervalMinutes} min · guardian: ${primary?.name ?? 'not set'}`}
        actions={
          <>
            <Chip tone={paused ? 'watch' : 'brand'}>{paused ? 'Paused' : 'Journey active'}</Chip>
            <StatusPill band={assessment.band} size="sm" showEmoji={false} />
          </>
        }
      />

      <StateHero
        assessment={assessment}
        journey={journey}
        now={now}
        subtitle={
          paused
            ? 'Journey paused. Check-in timer and ETA are on hold.'
            : assessment.headline
        }
        action={
          <div className="grid w-full gap-2 sm:w-[190px]">
            <Button
              variant="safe"
              size="lg"
              block
              icon={<CheckCircle2 size={18} />}
              onClick={() => store.confirmSafe('journey')}
            >
              I&apos;M SAFE
            </Button>
            <Button
              variant="outline"
              size="lg"
              block
              className="border-alert-200 text-alert-700 hover:bg-alert-50"
              icon={<HelpCircle size={18} />}
              onClick={() => store.requestHelp()}
            >
              NEED HELP
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Live journey map"
              subtitle={
                journey.locationAvailable
                  ? `Simulated GPS · updated ${formatRelative(journey.lastPositionAt, now)}`
                  : 'Location unavailable — showing last known position'
              }
              icon={<Radar size={16} />}
              action={
                <Chip tone={quality === 'connected' ? 'safe' : quality === 'delayed' ? 'watch' : 'alert'}>
                  {quality === 'connected' ? <Signal size={12} /> : <SignalZero size={12} />}
                  {quality === 'connected' ? 'Live' : quality === 'delayed' ? 'Delayed' : 'Lost'}
                </Chip>
              }
            />
            <CardBody className="pt-3">
              <JourneyMap journey={journey} mode="traveller" height="h-[300px] sm:h-[420px]" />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MapStat label="ETA" value={formatDurationMinutes(remainingMinutes(journey, now))} hint={formatClock(estimatedArrivalAt(journey, now))} />
                <MapStat
                  label="Next check-in"
                  value={journey.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'}
                  hint={checkInDue !== null && checkInDue > 0 ? `in ${formatCountdown(checkInDue)}` : 'due now'}
                />
                <MapStat
                  label="Route status"
                  value={journey.deviationActive ? 'Deviation' : 'On route'}
                  hint={
                    journey.deviationCount
                      ? `${pluralise(journey.deviationCount, 'deviation')} this journey`
                      : 'Inside the expected corridor'
                  }
                />
                <MapStat
                  label="Guardian"
                  value={journey.guardianAcknowledgedAt ? 'Acknowledged' : 'Connected'}
                  hint={journey.guardianNotifiedAt ? `Notified ${formatRelative(journey.guardianNotifiedAt, now)}` : 'No alerts sent'}
                />
              </div>
              {lateMinutes > 5 ? (
                <p className="mt-3 flex gap-2 rounded-xl border border-watch-200 bg-watch-50 px-3 py-2 text-[12.5px] font-medium text-watch-800">
                  <Clock size={14} className="mt-0.5 shrink-0" />
                  You are about {lateMinutes} minutes past the planned arrival window. SURAKSHA records a late-arrival
                  signal and tells your guardian.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {/* Check-in panel */}
          <Card tone={journey.checkIn.state === 'REQUESTED' ? 'brand' : undefined} className={journey.checkIn.state === 'REQUESTED' ? 'bg-brand-50' : ''}>
            <CardHeader
              title={journey.checkIn.state === 'REQUESTED' ? 'Everything okay?' : 'Auto check-in'}
              subtitle={
                journey.checkIn.state === 'REQUESTED'
                  ? `Answer within the grace period. Missed check-ins raise the risk state — they do not mean you are in danger.`
                  : `SURAKSHA will ask again at ${journey.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'}.`
              }
              icon={<Clock size={16} />}
            />
            <CardBody className="space-y-4">
              {journey.checkIn.state === 'REQUESTED' && remaining !== null ? (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-white bg-white/80 px-4 py-3">
                    <span className="text-[12.5px] font-semibold text-ink-600">Grace period remaining</span>
                    <span className={cn('text-2xl font-bold tabular', remaining < 45_000 ? 'text-alert-700' : 'text-ink-900')}>
                      {formatCountdown(Math.max(0, remaining))}
                    </span>
                  </div>
                  <Progress value={Math.max(0, Math.min(100, (remaining / (journey.gracePeriodMinutes * 60_000)) * 100))} tone={remaining < 45_000 ? 'alert' : 'brand'} />
                </>
              ) : checkInDue !== null && checkInDue > 0 ? (
                <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-3">
                  <span className="text-[12.5px] font-semibold text-ink-600">Next check-in in</span>
                  <span className="text-2xl font-bold tabular text-ink-900">{formatCountdown(checkInDue)}</span>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="safe" size="lg" block icon={<CheckCircle2 size={18} />} onClick={() => store.confirmSafe('checkin')}>
                  I&apos;M SAFE
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  block
                  className="border-alert-200 text-alert-700 hover:bg-alert-50"
                  icon={<HelpCircle size={18} />}
                  onClick={() => store.requestHelp()}
                >
                  I NEED HELP
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
                <span>
                  Completed {journey.checkIn.completedCount} · missed {journey.checkIn.missedCount}
                </span>
                {store.getState().travellerProfile.demoMode ? (
                  <>
                    <span className="text-ink-300">|</span>
                    <button
                      type="button"
                      onClick={() => store.sendCheckInNow()}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      Send a check-in now
                    </button>
                    <span className="text-ink-300">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (journey.checkIn.state !== 'REQUESTED') store.sendCheckInNow();
                        store.missCheckIn(true);
                      }}
                      className="font-semibold text-alert-700 hover:underline"
                    >
                      Simulate a missed check-in
                    </button>
                  </>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Journey controls"
              subtitle="Pause, end, or step into a quieter exit."
              icon={<Flag size={16} />}
            />
            <CardBody className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Button
                  variant="outline"
                  icon={paused ? <Play size={16} /> : <Pause size={16} />}
                  onClick={() => (paused ? store.resumeJourney() : store.pauseJourney())}
                >
                  {paused ? 'Resume journey' : 'Pause journey'}
                </Button>
                <Button variant="outline" icon={<PhoneCall size={16} />} onClick={() => navigate('/traveller/exit')}>
                  Open Exit Mode
                </Button>
                <Button variant="outline" icon={<Pencil size={16} />} onClick={() => navigate('/traveller/start')}>
                  Update plan
                </Button>
                <Button
                  variant="outline"
                  icon={<MapPin size={16} />}
                  onClick={() => store.setLocationAvailable(!journey.locationAvailable)}
                >
                  {journey.locationAvailable ? 'Simulate location loss' : 'Restore location'}
                </Button>
                {store.getState().travellerProfile.demoMode ? (
                  <Button
                    variant="outline"
                    icon={<RouteOff size={16} />}
                    onClick={() =>
                      journey.deviationActive ? store.restoreRoute() : store.moveOffRoute('Traveller pressed “simulate”')
                    }
                  >
                    {journey.deviationActive ? 'Return to route' : 'Simulate route change'}
                  </Button>
                ) : null}
                <Button
                  variant={confirmEnd ? 'danger' : 'outline'}
                  icon={<Flag size={16} />}
                  onClick={() => {
                    if (!confirmEnd) {
                      setConfirmEnd(true);
                      return;
                    }
                    store.endJourney('arrived');
                    setConfirmEnd(false);
                    navigate('/traveller');
                  }}
                >
                  {confirmEnd ? 'Confirm: end journey' : 'End journey'}
                </Button>
              </div>

              <p className="flex gap-2 text-[12px] leading-relaxed text-ink-500">
                <Info size={13} className="mt-0.5 shrink-0 text-ink-400" />
                Ending the journey stops monitoring and marks any open incident as resolved by the traveller.
              </p>
            </CardBody>
          </Card>

          {/* Demo controls */}
          {store.getState().travellerProfile.demoMode ? (
            <Card className="border-dashed border-brand-300 bg-brand-50/50">
              <CardHeader
                title="Demo controls"
                subtitle="Shortcut the scenario. Visible only while Demo Mode is on."
                icon={<Radar size={16} />}
                action={
                  <Button size="sm" variant="outline" onClick={() => store.toggleUi('demoPanelOpen', true)}>
                    Full panel
                  </Button>
                }
              />
              <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Button variant="outline" size="sm" icon={<RouteOff size={15} />} onClick={() => store.moveOffRoute()}>
                  Move off route
                </Button>
                <Button variant="outline" size="sm" icon={<Clock size={15} />} onClick={() => store.sendCheckInNow()}>
                  Trigger check-in
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Clock size={15} />}
                  onClick={() => {
                    if (journey.checkIn.state !== 'REQUESTED') store.sendCheckInNow();
                    store.missCheckIn(true);
                  }}
                >
                  Miss check-in
                </Button>
                <Button variant="outline" size="sm" icon={<ShieldCheck size={15} />} onClick={() => store.triggerSos('demo')}>
                  Trigger SOS
                </Button>
                <Button variant="outline" size="sm" icon={<PhoneCall size={15} />} onClick={() => store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' })}>
                  Exit Mode call
                </Button>
                <Button variant="outline" size="sm" icon={<Clock size={15} />} onClick={() => store.simulateEtaSlip(3)}>
                  Late arrival
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<MapPin size={15} />}
                  onClick={() => (journey.zoneExcursion ? store.leaveRiskZone() : store.enterRiskZone())}
                >
                  {journey.zoneExcursion ? 'Leave risk zone' : 'Enter risk zone'}
                </Button>
                <Button variant="outline" size="sm" icon={<MapPin size={15} />} onClick={() => store.setLocationAvailable(false)}>
                  Location lost
                </Button>
                <Button variant="outline" size="sm" icon={<Play size={15} />} onClick={() => store.clearJourney()}>
                  Reset journey
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Safety Risk Engine" subtitle="Deterministic, explained, never a verdict." icon={<ShieldCheck size={16} />} />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="sr-label">Current band</span>
                <StatusPill band={assessment.band} size="sm" showEmoji={false} />
              </div>
              <RiskBandLadder band={assessment.band} />
              <RiskWhyPanel assessment={assessment} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Event timeline"
              subtitle="Newest first. This is exactly what your guardian sees."
              icon={<Clock size={16} />}
              action={<Chip tone="neutral">{events.length} events</Chip>}
            />
            <CardBody className="pt-2">
              <EventTimeline events={events} now={now} dense limit={14} emptyLabel="No events recorded yet." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Trusted circle on watch" icon={<Users size={16} />} />
            <CardBody className="space-y-2">
              {[primary].filter(Boolean).map((contact) => (
                <div key={contact!.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{contact!.name}</p>
                    <p className="text-[11.5px] text-ink-500">
                      {contact!.relationship} · {contact!.notifyBy.join(' + ')}
                    </p>
                  </div>
                  <Chip tone={contact!.available ? 'safe' : 'watch'}>{contact!.available ? 'Available' : 'Queued'}</Chip>
                </div>
              ))}
              <button
                type="button"
                onClick={() => navigate('/traveller/circle')}
                className="w-full rounded-xl border border-dashed border-ink-300 py-2 text-[12.5px] font-semibold text-ink-600 hover:bg-ink-50"
              >
                Manage Trusted Circle
              </button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MapStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2.5">
      <p className="sr-label">{label}</p>
      <p className="mt-0.5 text-[14px] font-bold text-ink-900">{value}</p>
      {hint ? <p className="text-[11.5px] text-ink-500">{hint}</p> : null}
    </div>
  );
}
