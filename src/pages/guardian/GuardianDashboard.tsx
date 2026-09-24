/**
 * Guardian Dashboard — desktop-first monitoring surface.
 * Reads the same event log the traveller produces; adds acknowledgement.
 */

import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  Compass,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Siren,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Progress,
  Stat,
  StatusPill,
} from '@/components/ui/primitives';
import { PageHeader, SectionHeading } from '@/components/domain/blocks';
import { JourneyMap } from '@/components/map/JourneyMap';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { RiskBandLadder, RiskWhyPanel } from '@/components/domain/RiskWhyPanel';
import { useAppState, useCircle, store } from '@/store/hooks';
import { formatClock, formatCountdown, formatDurationMinutes, formatRelative, pluralise} from '@/lib/format';
import { estimatedArrivalAt, linkQuality, remainingMinutes } from '@/domain/journey';
import { guardianActionFor } from '@/domain/riskEngine';
import { toneForBand, TONES } from '@/lib/status';
import { cn } from '@/lib/cn';

export function GuardianDashboard() {
  const { journey, events, alerts, now, incidents, receipts } = useAppState();
  const { primary, backup } = useCircle();

  const active = journey && journey.status !== 'ENDED' ? journey : null;
  const assessment = active?.risk ?? null;
  const unacknowledged = alerts.filter((a) => !a.acknowledgedAt);
  const quality = linkQuality(active, now);
  const incident = incidents.find((i) => i.id === active?.incidentId) ?? null;
  const checkInDue = active?.checkIn.dueAt ? active.checkIn.dueAt - now : null;
  const exitArmed = store.getState().exitMode?.active ?? false;

  const band = assessment?.band ?? 'SAFE';
  const action = guardianActionFor(band);
  const tone = toneForBand(band);
  const t = TONES[tone];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Guardian · ${store.getState().guardianProfile.name}`}
        title="Guardian Dashboard"
        description="SURAKSHA shows you signals, not verdicts. A missed check-in means nobody answered — it does not mean something has happened."
        actions={
          <>
            <StatusPill band={band} size="md" />
            <Button size="sm" variant="outline" icon={<BellRing size={15} />} onClick={() => store.markAlertsRead()}>
              Mark alerts read
            </Button>
          </>
        }
      />

      {/* Headline state card */}
      <Card tone={tone} className={cn('overflow-hidden')}>
        <div className={cn('px-5 py-4 sm:px-6 sm:py-5', assessment ? '' : 'bg-white')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', t.dot)} />
                <h2 className="text-[19px] font-bold uppercase tracking-[0.04em] text-ink-900">
                  {band === 'SAFE' ? 'ALL CLEAR' : band}
                </h2>
                {assessment ? (
                  <Badge tone={tone}>
                    score {assessment.score} / 100
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-2xl text-[13.5px] font-medium leading-relaxed text-ink-700">
                {action.title}. {action.body}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {unacknowledged.length ? (
                <Button
                  variant={band === 'CRITICAL' ? 'danger' : 'primary'}
                  icon={<CheckCircle2 size={16} />}
                  onClick={() => store.acknowledgeAlert(unacknowledged[0].id)}
                >
                  ACKNOWLEDGE{unacknowledged.length > 1 ? ` (${unacknowledged.length})` : ''}
                </Button>
              ) : (
                <Chip tone="safe">
                  <CheckCircle2 size={12} /> All alerts acknowledged
                </Chip>
              )}
              {incident ? (
                <Link
                  to={`/guardian/incidents/${incident.id}`}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 text-sm font-semibold text-ink-800 hover:bg-ink-50"
                >
                  <ShieldAlert size={16} />
                  Incident {incident.code}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active journeys"
          value={active ? 1 : 0}
          hint={active ? `${active.travellerName} → ${active.destinationLabel}` : 'Nobody is travelling right now'}
          tone={active ? 'brand' : 'neutral'}
          icon={<Activity size={16} />}
        />
        <Stat
          label="Current risk"
          value={band}
          hint={assessment ? `${assessment.score} / 100` : 'No assessment available'}
          tone={tone}
          icon={<ShieldCheck size={16} />}
        />
        <Stat
          label="Next check-in"
          value={active?.checkIn.dueAt ? formatClock(active.checkIn.dueAt) : '—'}
          hint={
            checkInDue !== null && checkInDue > 0
              ? `in ${formatCountdown(checkInDue)}`
              : active
                ? 'Awaiting the traveller'
                : 'Starts with a journey'
          }
          tone={active?.checkIn.state === 'MISSED' ? 'alert' : 'neutral'}
          icon={<Clock size={16} />}
        />
        <Stat
          label="Alerts"
          value={alerts.length}
          hint={unacknowledged.length ? `${unacknowledged.length} awaiting acknowledgement` : 'Nothing open'}
          tone={unacknowledged.length ? 'critical' : 'safe'}
          icon={<BellRing size={16} />}
        />
      </div>

      {!active ? (
        <EmptyState
          icon={<Compass size={22} />}
          title="No active journey to monitor"
          description="When the traveller starts a journey you will see their simulated position, check-in schedule and risk state here."
          action={
            store.getState().travellerProfile.demoMode ? (
              <Button
                onClick={() => {
                  store.startCanonicalJourney();
                }}
              >
                Start the demo journey
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <CardHeader
                title={`Active journey · ${active.travellerName}`}
                subtitle={`${active.originLabel} → ${active.destinationLabel} · started ${formatClock(active.startedAt)}`}
                icon={<MapPin size={16} />}
                action={
                  <div className="flex items-center gap-2">
                    <Chip tone={quality === 'connected' ? 'safe' : quality === 'delayed' ? 'watch' : 'alert'}>
                      {quality === 'connected'
                        ? 'Live link'
                        : `Last updated ${formatRelative(active.lastPositionAt, now)}`}
                    </Chip>
                    <StatusPill band={band} size="sm" showEmoji={false} />
                  </div>
                }
              />
              <CardBody className="pt-3">
                <JourneyMap journey={active} mode="guardian" height="h-[320px] sm:h-[460px]" />

                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi label="ETA" value={formatDurationMinutes(remainingMinutes(active, now))} hint={formatClock(estimatedArrivalAt(active, now))} />
                  <Kpi
                    label="Route"
                    value={active.deviationActive ? 'Off route' : 'On route'}
                    hint={active.deviationCount ? pluralise(active.deviationCount, 'deviation') : 'In corridor'}
                  />
                  <Kpi
                    label="Check-ins"
                    value={`${active.checkIn.completedCount} / ${active.checkIn.completedCount + active.checkIn.missedCount}`}
                    hint={active.checkIn.missedCount ? `${active.checkIn.missedCount} missed` : 'none missed'}
                  />
                  <Kpi
                    label="Acknowledgement"
                    value={active.guardianAcknowledgedAt ? 'Done' : 'Pending'}
                    hint={active.guardianAcknowledgedAt ? formatClock(active.guardianAcknowledgedAt) : 'You have not acknowledged'}
                  />
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Event timeline"
                subtitle="Everything the traveller's device recorded, newest first."
                icon={<Clock size={16} />}
                action={<Chip tone="neutral">{events.length} events</Chip>}
              />
              <CardBody className="pt-2">
                <EventTimeline events={events} now={now} grouped limit={20} />
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            {assessment ? (
              <Card>
                <CardHeader title="Risk explanation" subtitle="Why the score is what it is." icon={<TrendingUp size={16} />} />
                <CardBody className="space-y-3">
                  <RiskBandLadder band={assessment.band} />
                  <RiskWhyPanel assessment={assessment} defaultOpen={assessment.band !== 'SAFE'} />
                </CardBody>
              </Card>
            ) : null}

            {incident ? (
              <Card tone="critical" className="bg-critical-50">
                <CardHeader
                  title={`Incident ${incident.code}`}
                  subtitle={incident.summary}
                  icon={<Siren size={16} />}
                  action={<Badge tone={incident.status === 'RESOLVED' ? 'safe' : 'critical'}>{incident.status}</Badge>}
                />
                <CardBody className="space-y-2 text-[12.5px] text-critical-900">
                  <p>
                    Created {formatClock(incident.createdAt)} · risk {incident.riskScore} · location{' '}
                    {incident.locationAvailable ? 'available' : 'last known'}
                  </p>
                  <p className="font-semibold">Incident ID {incident.code}</p>
                  <Link
                    to={`/guardian/incidents/${incident.id}`}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-critical-600 px-3.5 text-[13px] font-semibold text-white hover:bg-critical-700"
                  >
                    Open incident detail <ArrowRight size={15} />
                  </Link>
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Trusted contact information" subtitle="Who you can reach, and how." icon={<Users size={16} />} />
              <CardBody className="space-y-2">
                {[primary, backup].filter(Boolean).map((contact, index) => (
                  <div key={contact!.id} className="rounded-xl border border-ink-200 px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-ink-900">{contact!.name}</p>
                      <Chip tone={index === 0 ? 'brand' : 'neutral'}>{index === 0 ? 'Primary' : 'Backup'}</Chip>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-500">{contact!.relationship}</p>
                    <p className="mt-1 text-[12.5px] font-semibold text-ink-700">{contact!.phone}</p>
                  </div>
                ))}
                <Link
                  to="/guardian/contacts"
                  className="mt-1 block rounded-xl border border-dashed border-ink-300 py-2 text-center text-[12.5px] font-semibold text-ink-600 hover:bg-ink-50"
                >
                  Manage trusted contacts
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Notification log" subtitle="What SURAKSHA sent, and where." icon={<BellRing size={16} />} />
              <CardBody className="space-y-2">
                {receipts.length ? (
                  receipts.slice(0, 6).map((receipt) => (
                    <div key={receipt.id} className="rounded-xl border border-ink-200 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[12.5px] font-semibold text-ink-800">{receipt.title}</p>
                        <Badge tone={receipt.status === 'delivered' ? 'safe' : 'watch'}>{receipt.status}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-ink-500">
                        {receipt.contactName} · {receipt.channel} · {formatClock(receipt.at)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-ink-300 px-3 py-5 text-center text-[12.5px] text-ink-500">
                    No notifications sent yet.
                  </p>
                )}
              </CardBody>
            </Card>

            {active.checkIn.state === 'REQUESTED' && active.checkIn.expiresAt ? (
              <Card tone="brand" className="bg-brand-50">
                <CardBody className="space-y-2">
                  <p className="text-[13px] font-bold text-brand-900">Check-in requested</p>
                  <p className="text-[12.5px] text-brand-900/80">
                    The traveller was asked “Everything okay?” Grace period ends in
                  </p>
                  <p className="text-2xl font-bold tabular text-brand-900">
                    {formatCountdown(Math.max(0, active.checkIn.expiresAt - now))}
                  </p>
                  <Progress
                    value={Math.max(
                      0,
                      Math.min(100, ((active.checkIn.expiresAt - now) / (active.gracePeriodMinutes * 60_000)) * 100),
                    )}
                    tone="brand"
                  />
                </CardBody>
              </Card>
            ) : null}

            <Card tone={exitArmed ? 'brand' : undefined} className={exitArmed ? 'bg-brand-50' : ''}>
              <CardBody className="space-y-1.5">
                <p className="text-[13px] font-bold text-ink-900">
                  {exitArmed ? 'Exit Mode is armed' : 'Exit Mode'}
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-600">
                  {exitArmed
                    ? 'The traveller armed a simulated incoming call. Exit Mode notifies nobody — it is an escape aid, not an alert.'
                    : 'The traveller can arm a simulated incoming call to leave an uncomfortable situation. It notifies nobody, by design.'}
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <SectionHeading
        title="Role reminder"
        description="You are viewing as the guardian. Signals come from the traveller's device; SURAKSHA never decides that someone is in danger."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: 'Ackowledge, then act', body: 'Acknowledgement tells the traveller a human is responding. It does not resolve the incident.' },
          { title: 'Try the traveller first', body: 'Most missed check-ins are a flat battery or no signal. Call or message before escalating further.' },
          { title: 'Keep the record', body: 'The timeline stays available after the journey ends, so you can review what actually happened.' },
        ].map((item) => (
          <Card key={item.title}>
            <CardBody className="space-y-1.5">
              <p className="text-[13px] font-bold text-ink-900">{item.title}</p>
              <p className="text-[12.5px] leading-relaxed text-ink-500">{item.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-2.5">
      <dt className="sr-label">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-bold text-ink-900">{value}</dd>
      {hint ? <dd className="text-[11.5px] text-ink-500">{hint}</dd> : null}
    </div>
  );
}
