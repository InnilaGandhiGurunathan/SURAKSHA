import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, CheckCircle2, Download, FileWarning, Route, ShieldCheck } from 'lucide-react';
import type { IncidentReport, Journey, UserProfile } from '@suraksha/shared';
import { reportReference } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, RiskBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Disclaimer, EmptyState, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { TimelineList } from '@/components/TimelineList';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDate, formatDateTime, formatDistance, formatDuration, formatRelative } from '@/lib/format';
import { buildTimelineSummary, listEvents } from '@/services/events';
import { listJourneys, journeySummary } from '@/services/journeys';
import { listReports } from '@/services/reports';
import { db } from '@/lib/db';
import { recordEvent } from '@/services/events';
import { toast } from 'sonner';

/**
 * Journey and report history.
 *
 * Everything can be exported as JSON straight from the device — the data belongs
 * to the user, and that includes being able to take it somewhere else. Each past
 * journey keeps its full timeline so a user (or a responder reading it later) can
 * see what the app actually observed.
 */
export function HistoryScreen({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'journeys' | 'reports'>('journeys');
  const [expanded, setExpanded] = useState<string | undefined>();

  const journeys = useLiveQuery(async () => listJourneys(user.id), [user.id], undefined);
  const reports = useLiveQuery(async () => listReports(user.id), [user.id], undefined);
  const summary = useLiveQuery(async () => journeySummary(user.id), [user.id], undefined);

  const past = useMemo(
    () => (journeys ?? []).filter((journey) => ['completed', 'cancelled', 'escalated'].includes(journey.status)),
    [journeys],
  );

  const exportAll = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      owner: { id: user.id, name: user.fullName, role: user.role },
      journeys: journeys ?? [],
      reports: reports ?? [],
      events: await db.events.where('ownerId').equals(user.id).toArray(),
      contacts: await db.contacts.where('ownerId').equals(user.id).toArray(),
      note:
        'Exported from SURAKSHA. Risk values in this file are heuristic indicators produced by on-device rules, not probabilities.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `suraksha-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    await recordEvent({ ownerId: user.id, type: 'data_exported', message: 'Full history exported as JSON from this device.' });
    toast.success('History exported.');
  };

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="History"
        description="Everything SURAKSHA recorded on this device, exportable."
        action={
          <Button size="sm" variant="outline" onClick={() => void exportAll()}>
            <Download className="size-3.5" />
            Export JSON
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile label="Journeys" value={String(summary?.total ?? 0)} hint={`${summary?.completed ?? 0} completed`} />
        <StatusTile label="Checkpoints reached" value={String(summary?.checkpointsReached ?? 0)} tone="ok" />
        <StatusTile
          label="Checkpoints missed"
          value={String(summary?.checkpointsMissed ?? 0)}
          tone={(summary?.checkpointsMissed ?? 0) > 0 ? 'warn' : 'ok'}
          hint="Each one raised the indicator, none alerted anyone"
        />
        <StatusTile label="Distance logged" value={formatDistance(summary?.distanceMeters ?? 0)} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="journeys">Journeys ({past.length})</TabsTrigger>
          <TabsTrigger value="reports">Reports ({reports?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="journeys">
          {past.length === 0 ? (
            <EmptyState
              icon={<Route className="size-5" />}
              title="No completed journeys yet"
              description="Finished journeys keep their route, checkpoint outcomes and full event timeline here."
            />
          ) : (
            <ul className="space-y-2.5">
              {past.map((journey) => (
                <li key={journey.id}>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <CheckCircle2
                            className={journey.status === 'completed' ? 'size-4 text-emerald-500' : 'size-4 text-muted-foreground'}
                            aria-hidden
                          />
                          <span className="truncate">{journey.title}</span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant={journey.status === 'completed' ? 'success' : journey.status === 'escalated' ? 'danger' : 'muted'}>
                            {journey.status}
                          </Badge>
                          {journey.riskScore !== undefined ? (
                            <RiskBadge band={journey.riskBand ?? 'safe'} score={journey.riskScore} showScore={false} />
                          ) : null}
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2.5">
                      <p className="text-[11px] text-muted-foreground">
                        {journey.originLabel} → {journey.destinationLabel} · {formatDate(journey.scheduledStartAt)}
                      </p>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span>
                          {journey.checkpoints.filter((item) => item.status === 'reached').length}/
                          {journey.checkpoints.length} checkpoints reached
                        </span>
                        {journey.route ? (
                          <span>
                            {formatDistance(journey.route.distanceMeters)} · planned {formatDuration(journey.route.durationMinutes)}
                          </span>
                        ) : null}
                        {journey.startedAt && journey.completedAt ? (
                          <span>
                            actual {formatDuration(
                              (new Date(journey.completedAt).getTime() - new Date(journey.startedAt).getTime()) / 60_000,
                            )}
                          </span>
                        ) : null}
                        {journey.isDemo ? <span>demo record</span> : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpanded((value) => (value === journey.id ? undefined : journey.id))}
                        >
                          <Activity className="size-3.5" />
                          {expanded === journey.id ? 'Hide timeline' : 'Show timeline'}
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/app/journeys/${journey.id}`}>Open journey</Link>
                        </Button>
                      </div>

                      {expanded === journey.id ? (
                        <JourneyTimeline journeyId={journey.id} ownerId={user.id} />
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="reports">
          {(reports ?? []).length === 0 ? (
            <EmptyState
              icon={<FileWarning className="size-5" />}
              title="No reports filed"
              description="Reports you file appear here with their delivery outcome and verification state."
            />
          ) : (
            <ul className="space-y-2.5">
              {(reports ?? []).map((report: IncidentReport) => (
                <li key={report.id}>
                  <Link to={`/app/report/${report.id}`} className="block">
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardContent className="space-y-1.5 pt-5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold">{report.title}</p>
                          <Badge
                            variant={
                              report.verification === 'verified'
                                ? 'success'
                                : report.serverAckId
                                  ? 'info'
                                  : 'warning'
                            }
                          >
                            {report.verification === 'verified' ? 'verified' : report.serverAckId ? 'delivered' : 'on device'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {reportReference(report.clientReportId)} · {report.category} · occurred{' '}
                          {formatDateTime(report.occurredAt)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Filed {formatRelative(report.createdAt)} · {report.attempts} attempt(s)
                          {report.serverAckId ? ` · ack ${report.serverAckId.slice(0, 8)}…` : ' · no acknowledgement'}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-teal-500" aria-hidden />
            What history is good for
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Reviewing what the app recorded — checkpoints, deviations, check-ins answered or missed — helps you
            adjust your safety rules. It is also the record a responder can read if you choose to share it.
          </p>
          <p>
            History lives on this device. Nothing in this screen has been published anywhere, and exporting it is a
            local download only.
          </p>
          <Disclaimer>{DISCLAIMERS.riskHeuristic}</Disclaimer>
        </CardContent>
      </Card>

      <InfoNote tone="muted" title="Retention">
        <p>
          Track points and events older than 120 days are pruned automatically to keep the device database small.
          Reports and journeys themselves are kept until you delete them.
        </p>
      </InfoNote>
    </div>
  );
}

function JourneyTimeline({ journeyId, ownerId }: { journeyId: string; ownerId: string }) {
  const events = useLiveQuery(
    async () =>
      (await db.events.where('journeyId').equals(journeyId).toArray()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [journeyId],
    [],
  );

  const summary = useMemo(() => buildTimelineSummary(events ?? []), [events]);

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
        <Badge variant="muted">{summary.total} event(s)</Badge>
        {summary.critical ? <Badge variant="danger">{summary.critical} critical</Badge> : null}
        {summary.warnings ? <Badge variant="warning">{summary.warnings} warning(s)</Badge> : null}
      </div>
      <TimelineList events={events ?? []} emptyLabel="No events recorded for this journey." collapsibleBeyond={6} />
      <p className="mt-2 text-[10px] text-muted-foreground">Owner reference {ownerId.slice(0, 8)}… · stored locally</p>
    </div>
  );
}

export default HistoryScreen;
