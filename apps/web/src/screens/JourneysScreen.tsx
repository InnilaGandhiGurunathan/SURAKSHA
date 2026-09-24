import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, CheckCircle2, MapPinned, Plus, Route, Users } from 'lucide-react';
import type { Journey, UserProfile } from '@suraksha/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, RiskBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, InfoNote, LoadingBlock, SectionHeader, Disclaimer } from '@/components/StatusPieces';
import { formatDateTime, formatDistance, formatRelative } from '@/lib/format';
import { journeyStatusLabel, listJourneys } from '@/services/journeys';
import { listMapPacks } from '@/services/tiles';
import { DISCLAIMERS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Journey list: everything planned, running and finished, from the device. */
export function JourneysScreen({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'active' | 'planned' | 'past'>('active');

  const journeys = useLiveQuery(async () => listJourneys(user.id), [user.id], undefined);
  const packs = useLiveQuery(async () => listMapPacks(user.id), [user.id], []);

  const grouped = useMemo(() => {
    const list = journeys ?? [];
    return {
      active: list.filter((journey) => ['active', 'paused', 'escalated'].includes(journey.status)),
      planned: list.filter((journey) => journey.status === 'planned'),
      past: list.filter((journey) => ['completed', 'cancelled'].includes(journey.status)),
    };
  }, [journeys]);

  const packsByJourney = useMemo(
    () => new Map((packs ?? []).map((pack) => [pack.journeyId, pack])),
    [packs],
  );

  if (!journeys) {
    return <LoadingBlock label="Reading journeys from this device…" rows={3} />;
  }

  const renderList = (items: Journey[], empty: React.ReactNode) =>
    items.length === 0 ? (
      empty
    ) : (
      <ul className="space-y-2.5">
        {items.map((journey) => {
          const pack = packsByJourney.get(journey.id);
          const reached = journey.checkpoints.filter((item) => item.status === 'reached').length;
          const missed = journey.checkpoints.filter((item) => item.status === 'missed').length;

          return (
            <li key={journey.id}>
              <Link to={`/app/journeys/${journey.id}`} className="block">
                <Card className={cn('transition-colors hover:bg-muted/40', journey.status === 'escalated' && 'border-red-500/50')}>
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {journey.title}
                          {journey.isDemo ? <Badge variant="muted" className="ml-2">demo</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {journey.originLabel} → {journey.destinationLabel}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge
                          variant={
                            journey.status === 'active'
                              ? 'info'
                              : journey.status === 'completed'
                                ? 'success'
                                : journey.status === 'escalated'
                                  ? 'danger'
                                  : journey.status === 'cancelled'
                                    ? 'muted'
                                    : 'outline'
                          }
                        >
                          {journey.status}
                        </Badge>
                        {journey.riskScore !== undefined ? (
                          <RiskBadge band={journey.riskBand ?? 'safe'} score={journey.riskScore} showScore />
                        ) : null}
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground">{journeyStatusLabel(journey)}</p>

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarClock className="size-3" aria-hidden />
                        {formatDateTime(journey.scheduledStartAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Route className="size-3" aria-hidden />
                        {journey.route ? formatDistance(journey.route.distanceMeters) : 'no route'}
                        {journey.route?.approximate ? ' (approx.)' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="size-3" aria-hidden />
                        {reached}/{journey.checkpoints.length} checkpoints
                        {missed ? ` · ${missed} missed` : ''}
                      </span>
                      {journey.guardianContactIds.length > 0 ? (
                        <span className="flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          {journey.guardianContactIds.length} guardian(s)
                        </span>
                      ) : null}
                      {pack ? (
                        <span className={pack.status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                          offline map {pack.status} ({pack.tilesStored}/{pack.tilesRequested})
                        </span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="space-y-4 pb-4">
      <SectionHeader
        title="Journeys"
        description="Planned, running and past journeys — all stored on this device."
        action={
          <Button size="sm" variant="accent" asChild>
            <Link to="/app/journeys/new">
              <Plus className="size-3.5" />
              New
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">Running ({grouped.active.length})</TabsTrigger>
          <TabsTrigger value="planned">Planned ({grouped.planned.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({grouped.past.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {renderList(
            grouped.active,
            <EmptyState
              icon={<MapPinned className="size-5" />}
              title="No journey running"
              description="Start a planned journey to begin monitoring checkpoints, deviation and timing on this device."
              action={
                <Button size="sm" variant="accent" asChild>
                  <Link to="/app/journeys/new">Plan a journey</Link>
                </Button>
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="planned">
          {renderList(
            grouped.planned,
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nothing planned"
              description="A planned journey gives the app a corridor to watch and a checkpoint schedule to compare against."
            />,
          )}
          {grouped.planned.length > 0 ? (
            <InfoNote tone="info" className="mt-3">
              <p>
                Download the offline map corridor from a journey before you travel. Without it the map is blank
                offline, but checkpoints, deviation checks and SOS still work.
              </p>
            </InfoNote>
          ) : null}
        </TabsContent>

        <TabsContent value="past">
          {renderList(
            grouped.past,
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="No past journeys"
              description="Completed journeys keep their full event timeline so you can review what happened."
            />,
          )}
          {grouped.past.length > 0 ? <Disclaimer className="mt-3">{DISCLAIMERS.shareDisclaimer}</Disclaimer> : null}
        </TabsContent>
      </Tabs>

      <InfoNote tone="muted" title="Last synced state">
        <p>
          {journeys.length === 0
            ? 'No journeys stored yet.'
            : `${journeys.length} journey(s) on this device. ${
                (journeys ?? []).filter((journey) => Boolean(journey.startedAt)).length
              } have been monitored at least once.`}
        </p>
      </InfoNote>
    </div>
  );
}

export default JourneysScreen;
