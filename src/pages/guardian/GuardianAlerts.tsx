/** Guardian alerts — one card per state change, newest first. */

import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, MapPin, ShieldAlert, Siren, UserCheck } from 'lucide-react';
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
import { PageHeader, SectionHeading } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import { formatClock, formatRelative } from '@/lib/format';
import { guardianActionFor } from '@/domain/riskEngine';
import { toneForBand } from '@/lib/status';
import { cn } from '@/lib/cn';

export function GuardianAlerts() {
  const { alerts, journey, incidents, now, contacts } = useAppState();

  const open = alerts.filter((a) => !a.acknowledgedAt);
  const acknowledged = alerts.filter((a) => a.acknowledgedAt);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · Alerts"
        title="Alerts"
        description="Each alert is a single, explained change in state — with the traveller, location and incident attached so you can act without hunting for context."
        actions={
          <>
            <Chip tone={open.length ? 'critical' : 'safe'}>
              <BellRing size={12} /> {open.length} open
            </Chip>
            {alerts.length ? (
              <Button size="sm" variant="outline" onClick={() => store.markAlertsRead()}>
                Mark all read
              </Button>
            ) : null}
          </>
        }
      />

      {open.length === 0 && acknowledged.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={22} />}
          title="No alerts"
          description="Nothing has needed your attention. SURAKSHA will raise an alert here the moment a safety signal appears."
        />
      ) : null}

      {open.length ? (
        <div>
          <SectionHeading title="Awaiting acknowledgement" description="These need a human to respond." />
          <ul className="space-y-3">
            {open.map((alert) => {
              const tone = toneForBand(alert.band);
              const incident = incidents.find((i) => i.id === alert.incidentId) ?? null;
              const action = guardianActionFor(alert.band);
              return (
                <li key={alert.id}>
                  <Card
                    tone={tone}
                    className={cn(alert.band === 'CRITICAL' ? 'bg-critical-50' : alert.band === 'ALERT' ? 'bg-alert-50' : alert.band === 'WATCH' ? 'bg-watch-50' : 'bg-white')}
                  >
                    <CardHeader
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          {alert.band === 'CRITICAL' ? <Siren size={16} /> : <ShieldAlert size={16} />}
                          {alert.title}
                          <StatusPill band={alert.band} size="sm" showEmoji={false} />
                        </span>
                      }
                      subtitle={alert.body}
                      action={<Badge tone={tone}>{formatRelative(alert.createdAt, now)}</Badge>}
                    />
                    <CardBody className="space-y-3">
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Fact label="Traveller" value={journey?.travellerName ?? '—'} />
                        <Fact label="Risk score" value={journey ? `${journey.risk.score} / 100` : '—'} />
                        <Fact label="Location" value={journey?.locationAvailable ? journey.destinationLabel + ' route' : 'Last known'} />
                        <Fact label="Incident ID" value={incident?.code ?? 'Not created'} />
                        <Fact
                          label="Last update"
                          value={journey ? formatRelative(journey.lastPositionAt, now) : formatRelative(alert.createdAt, now)}
                        />
                      </dl>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant={alert.band === 'CRITICAL' ? 'danger' : 'primary'}
                          icon={<CheckCircle2 size={16} />}
                          onClick={() => store.acknowledgeAlert(alert.id)}
                        >
                          ACKNOWLEDGE
                        </Button>
                        {incident ? (
                          <Link
                            to={`/guardian/incidents/${incident.id}`}
                            className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 text-sm font-semibold text-ink-800 hover:bg-ink-50"
                          >
                            Open incident
                          </Link>
                        ) : null}
                        <Link
                          to="/guardian/journeys"
                          className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 text-sm font-semibold text-ink-800 hover:bg-ink-50"
                        >
                          <MapPin size={16} /> View live map
                        </Link>
                      </div>

                      <p className="rounded-xl bg-white/70 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600">
                        <strong className="font-semibold text-ink-800">What to do:</strong> {action.body}
                      </p>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {acknowledged.length ? (
        <div>
          <SectionHeading title="Acknowledged" description="Closed by you or another guardian." />
          <ul className="space-y-2">
            {acknowledged.map((alert) => (
              <li key={alert.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-safe-50 text-safe-700">
                        <UserCheck size={15} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-ink-800">{alert.title}</p>
                        <p className="text-[11.5px] text-ink-500">
                          {formatClock(alert.createdAt)} · acknowledged by {alert.acknowledgedBy ?? 'guardian'} at{' '}
                          {formatClock(alert.acknowledgedAt)}
                        </p>
                      </div>
                    </div>
                    <StatusPill band={alert.band} size="sm" showEmoji={false} />
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card tone="neutral" className="bg-ink-50">
        <CardBody className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-600">
          <p className="text-[13px] font-bold text-ink-800">Escalation order you can act on</p>
          <p>
            {contacts
              .slice(0, 2)
              .map((c) => `${c.name} (${c.relationship})`)
              .join(' → ')}{' '}
            → emergency services, which you call yourself.
          </p>
          <p className="text-ink-500">
            SURAKSHA does not contact the police, an ambulance or any authority, and never dispatches help based on a
            prediction.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="sr-label">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-semibold text-ink-800">{value}</dd>
    </div>
  );
}
