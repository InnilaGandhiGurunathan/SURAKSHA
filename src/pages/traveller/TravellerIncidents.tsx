/** Incident history — every record SURAKSHA kept, with severity and status. */

import { Link } from 'react-router-dom';
import { ArrowRight, FileText, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, StatusPill } from '@/components/ui/primitives';
import { PageHeader, SectionHeading } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import { formatClock, formatDate, formatDateTime } from '@/lib/format';
import { toneForSeverity, TONES } from '@/lib/status';
import { cn } from '@/lib/cn';

export function TravellerIncidents() {
  const { incidents, journey } = useAppState();
  const active = incidents.find((i) => i.status !== 'RESOLVED');
  const past = incidents.filter((i) => i.id !== active?.id);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Records"
        title="Incidents"
        description="An incident is a record SURAKSHA created when safety signals stacked up or SOS was triggered. It is a timeline plus evidence — not a conclusion."
        actions={
          journey?.incidentId ? (
            <Link
              to={`/traveller/incidents/${journey.incidentId}`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-critical-600 px-3.5 text-[13px] font-semibold text-white hover:bg-critical-700"
            >
              Open current incident
              <ArrowRight size={15} />
            </Link>
          ) : null
        }
      />

      {active ? (
        <Card tone={toneForSeverity(active.severity)} className={cn(TONES[toneForSeverity(active.severity)].surface)}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono">{active.code}</span>
                <StatusPill band={active.severity} size="sm" showEmoji={false} />
              </span>
            }
            subtitle={active.summary}
            icon={<ShieldAlert size={16} />}
            action={<Badge tone={active.status === 'RESOLVED' ? 'safe' : 'critical'}>{active.status}</Badge>}
          />
          <CardBody className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Created" value={formatDateTime(active.createdAt)} />
              <Fact label="Risk score" value={`${active.riskScore} / 100`} />
              <Fact label="Location" value={active.locationAvailable ? 'Available' : 'Last known'} />
              <Fact
                label="Guardian"
                value={active.guardianAcknowledgedAt ? `Acknowledged ${formatClock(active.guardianAcknowledgedAt)}` : 'Notified'}
              />
            </dl>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/traveller/incidents/${active.id}`}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800"
              >
                Open incident detail
                <ArrowRight size={16} />
              </Link>
              <Button variant="outline" onClick={() => store.endJourney('arrived')}>
                End journey &amp; resolve
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div>
        <SectionHeading title="History" description={`${past.length} previous record(s) kept on this device.`} />
        {past.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {past.map((incident) => {
              const tone = toneForSeverity(incident.severity);
              return (
                <li key={incident.id}>
                  <Link to={`/traveller/incidents/${incident.id}`} className="block focus-visible:rounded-card">
                    <Card className="h-full transition-state hover:border-ink-300 hover:shadow-raised">
                      <CardBody className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[13px] font-bold text-ink-900">{incident.code}</span>
                          <StatusPill band={incident.severity} size="sm" showEmoji={false} />
                        </div>
                        <p className="text-[12.5px] leading-relaxed text-ink-600 line-clamp-2">{incident.summary}</p>
                        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500">
                          <span>{formatDate(incident.createdAt, { month: 'short', day: 'numeric' })}</span>
                          <span className="text-ink-300">·</span>
                          <span>risk {incident.riskScore}</span>
                          <span className="text-ink-300">·</span>
                          <span
                            className={cn(
                              'font-semibold',
                              incident.status === 'RESOLVED' ? TONES.safe.text : TONES[tone].text,
                            )}
                          >
                            {incident.status}
                          </span>
                        </div>
                        {incident.evidence.length ? (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-500">
                            <FileText size={12} /> {incident.evidence.length} evidence item(s)
                          </span>
                        ) : null}
                      </CardBody>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<ShieldAlert size={20} />}
            title="No incidents recorded."
            description="That is the goal. If signals stack up, the record will appear here with its full timeline."
          />
        )}
      </div>
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
