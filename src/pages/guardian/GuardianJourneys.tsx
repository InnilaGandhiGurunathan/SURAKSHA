/** Active journeys + a live monitoring view for a single journey. */

import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BellRing,
  Clock,
  Compass,
  MapPin,
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
  StatusPill,
} from '@/components/ui/primitives';
import { PageHeader, JourneySummaryCard, SectionHeading } from '@/components/domain/blocks';
import { JourneyMap } from '@/components/map/JourneyMap';
import { useMapSurface } from '@/components/map/useGoogleMaps';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { RiskWhyPanel } from '@/components/domain/RiskWhyPanel';
import { useAppState, useCircle, store } from '@/store/hooks';
import { formatClock, formatDurationMinutes, formatRelative, pluralise} from '@/lib/format';
import { linkQuality, remainingMinutes } from '@/domain/journey';

export function GuardianJourneys() {
  const { journeyId } = useParams<{ journeyId: string }>();
  const { journey, events, now, incidents } = useAppState();
  const mapSurface = useMapSurface();
  const active = journey && journey.status !== 'ENDED' ? journey : null;

  if (journeyId && active && active.id === journeyId) {
    return <JourneyDetail />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · Monitoring"
        title="Active Journeys"
        description="Every journey currently sharing its simulated location with you."
        actions={
          <Chip tone={active ? 'brand' : 'neutral'}>
            <Activity size={12} /> {active ? 1 : 0} active
          </Chip>
        }
      />

      {active ? (
        <div className="space-y-4">
          <JourneySummaryCard journey={active} now={now} to={`/guardian/journeys/${active.id}`} as="guardian" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader
                title="Live map"
                subtitle={`${mapSurface.headerLabel} · updated ${formatRelative(active.lastPositionAt, now)}`}
                icon={<MapPin size={16} />}
                action={<StatusPill band={active.risk.band} size="sm" showEmoji={false} />}
              />
              <CardBody className="pt-3">
                <JourneyMap journey={active} mode="guardian" height="h-[300px]" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recent events" icon={<Clock size={16} />} />
              <CardBody className="pt-2">
                <EventTimeline events={events} now={now} dense limit={8} />
              </CardBody>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Compass size={22} />}
          title="No active journey"
          description="You are not monitoring anyone right now. This is the normal state — SURAKSHA will show a journey here the moment one starts."
          action={
            store.getState().travellerProfile.demoMode ? (
              <Button onClick={() => store.startCanonicalJourney()}>Start the demo journey</Button>
            ) : null
          }
        />
      )}

      {incidents.length ? (
        <div>
          <SectionHeading title="Recent records" description="Journeys that raised an incident." />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {incidents.slice(0, 6).map((incident) => (
              <li key={incident.id}>
                <Link to={`/guardian/incidents/${incident.id}`} className="block focus-visible:rounded-card">
                  <Card className="h-full transition-state hover:border-ink-300 hover:shadow-raised">
                    <CardBody className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-bold text-ink-900">{incident.code}</span>
                        <StatusPill band={incident.severity} size="sm" showEmoji={false} />
                      </div>
                      <p className="text-[12.5px] text-ink-500">{formatClock(incident.createdAt)} · {incident.travellerName}</p>
                      <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-600">{incident.summary}</p>
                      <Badge tone={incident.status === 'RESOLVED' ? 'safe' : 'critical'}>{incident.status}</Badge>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function JourneyDetail() {
  const { journey, events, now, alerts } = useAppState();
  const { primary, backup } = useCircle();
  const mapSurface = useMapSurface();
  if (!journey) return null;

  const quality = linkQuality(journey, now);
  const openAlert = alerts.find((a) => !a.acknowledgedAt);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · Journey detail"
        title={`${journey.travellerName} → ${journey.destinationLabel}`}
        description={`Started ${formatClock(journey.startedAt)} from ${journey.originLabel}. ${quality === 'connected' ? 'Link is live.' : `Last update ${formatRelative(journey.lastPositionAt, now)}.`}`}
        actions={
          <>
            <Link
              to="/guardian/journeys"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50"
            >
              <ArrowLeft size={15} /> All journeys
            </Link>
            <StatusPill band={journey.risk.band} size="md" />
            {openAlert ? (
              <Button icon={<BellRing size={15} />} onClick={() => store.acknowledgeAlert(openAlert.id)}>
                ACKNOWLEDGE
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Live position"
            subtitle={`${mapSurface.headerLabel}. The route and coordinates are fictional.`}
            icon={<MapPin size={16} />}
          />
          <CardBody className="pt-3">
            <JourneyMap journey={journey} mode="guardian" height="h-[340px] sm:h-[520px]" />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Journey status" icon={<Activity size={16} />} />
            <CardBody className="grid grid-cols-2 gap-3">
              <Fact label="ETA" value={formatDurationMinutes(remainingMinutes(journey, now))} hint={formatClock(journey.expectedArrivalAt)} />
              <Fact label="Check-in" value={journey.checkIn.state} hint={journey.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'} />
              <Fact label="Route" value={journey.deviationActive ? 'Off route' : 'On route'} hint={pluralise(journey.deviationCount, 'deviation')} />
              <Fact
                label="Escalation"
                value={journey.escalationLevel > 0 ? `Level ${journey.escalationLevel}` : 'None'}
                hint={journey.guardianNotifiedAt ? `Notified ${formatClock(journey.guardianNotifiedAt)}` : 'No notifications'}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Risk explanation" icon={<Compass size={16} />} />
            <CardBody>
              <RiskWhyPanel assessment={journey.risk} defaultOpen={journey.risk.band !== 'SAFE'} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="People on this journey" icon={<Users size={16} />} />
            <CardBody className="space-y-2">
              {[primary, backup].filter(Boolean).map((contact, index) => (
                <div key={contact!.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{contact!.name}</p>
                    <p className="text-[11.5px] text-ink-500">{contact!.relationship} · {contact!.phone}</p>
                  </div>
                  <Chip tone={index === 0 ? 'brand' : 'neutral'}>{index === 0 ? 'Primary' : 'Backup'}</Chip>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Event timeline" icon={<Clock size={16} />} />
            <CardBody className="pt-2">
              <EventTimeline events={events} now={now} grouped limit={24} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 px-3 py-2.5">
      <p className="sr-label">{label}</p>
      <p className="mt-0.5 text-[13.5px] font-bold text-ink-900">{value}</p>
      {hint ? <p className="text-[11.5px] text-ink-500">{hint}</p> : null}
    </div>
  );
}
