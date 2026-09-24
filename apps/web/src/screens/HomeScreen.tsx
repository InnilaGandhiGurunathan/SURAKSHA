import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  ArrowRight,
  Bell,
  CloudOff,
  FileWarning,
  LifeBuoy,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Journey, TrustedContact, UserProfile } from '@suraksha/shared';
import { formatCoordinates } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, RiskBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { ConnectivityPill, Disclaimer, EmptyState, GpsPill, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { TimelineList } from '@/components/TimelineList';
import { useLocation } from '@/hooks/useLocation';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useOnline } from '@/hooks/useConnectivity';
import { db } from '@/lib/db';
import { formatBytes, formatDistance, formatRelative } from '@/lib/format';
import { DISCLAIMERS, DISCLAIMERS as COPY } from '@/lib/constants';
import { listContacts, primaryContact } from '@/services/contacts';
import { listJourneys, journeyStatusLabel } from '@/services/journeys';
import { listEvents } from '@/services/events';
import { reportQueueStats } from '@/services/reports';
import { syncNow } from '@/services/sync';
import { offlineReadiness } from '@/services/offline';
import { callContact } from '@/services/call';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Home dashboard.
 *
 * The order of the page mirrors the order of the questions a traveller asks:
 * am I safe and connected → is a journey running → can I reach someone → what is
 * queued. The SOS control is in the shell (always visible) and repeated here in
 * full size, because this is the screen people open in a hurry.
 */
export function HomeScreen({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const { usable, online } = useOnline();
  const location = useLocation({ watch: true, minDistanceMeters: 40 });
  const monitoring = useMonitoring(user.id);
  const [syncing, setSyncing] = useState(false);

  const journeys = useLiveQuery(async () => listJourneys(user.id), [user.id], [] as Journey[]);
  const contacts = useLiveQuery(async () => listContacts(user.id), [user.id], [] as TrustedContact[]);
  const events = useLiveQuery(
    async () => (monitoring.journey ? listEvents({ ownerId: user.id, journeyId: monitoring.journey.id, limit: 12 }) : []),
    [user.id, monitoring.journey?.id],
    [],
  );
  const reportQueue = useLiveQuery(async () => reportQueueStats(user.id), [user.id], undefined);
  const readiness = useLiveQuery(async () => offlineReadiness(user.id), [user.id], undefined);
  const unread = useLiveQuery(
    async () =>
      (await db.notifications.where('ownerId').equals(user.id).toArray()).filter((item) => !item.readAt).length,
    [user.id],
    0,
  );
  const lastEvent = useLiveQuery(
    async () => (await listEvents({ ownerId: user.id, limit: 1 }))[0],
    [user.id],
    undefined,
  );

  const upcoming = useMemo(
    () =>
      (journeys ?? [])
        .filter((journey) => journey.status === 'planned')
        .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime())[0],
    [journeys],
  );

  const completed = useMemo(
    () => (journeys ?? []).filter((journey) => journey.status === 'completed').length,
    [journeys],
  );

  const emergencyContact = primaryContact(contacts ?? []);
  const assessment = monitoring.assessment;
  const journey = monitoring.journey;

  const safetyLabel = useMemo(() => {
    if (!journey) return 'No journey being monitored';
    if (journey.status === 'escalated') return 'Escalated — emergency workflow open';
    if (journey.status === 'paused') return 'Monitoring paused';
    if (assessment && assessment.score >= 25) return `Signals building (${assessment.score}/100)`;
    return 'Journey monitored on this device';
  }, [journey, assessment]);

  // Readiness is recomputed when the journey list changes; the result is small.
  const [readinessNote, setReadinessNote] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (readiness) setReadinessNote(readiness.readiness.note);
  }, [readiness]);

  const doSync = async () => {
    setSyncing(true);
    const result = await syncNow(user.id);
    setSyncing(false);
    toast.message(result.message);
  };

  return (
    <div className="space-y-4 pb-4">
      {/* ---------------------------- Safety status ---------------------------- */}
      <Card tone={journey?.status === 'escalated' ? 'danger' : undefined} className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ShieldCheck className={cn('size-4', journey?.status === 'escalated' ? 'text-red-500' : 'text-emerald-500')} aria-hidden />
              {journey ? 'Journey being monitored' : 'Safety status'}
            </span>
            {assessment ? <RiskBadge band={assessment.band} score={assessment.score} /> : <Badge variant="muted">idle</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{safetyLabel}</p>

          {journey ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {journey.originLabel} → {journey.destinationLabel} · {journeyStatusLabel(journey)}
              </p>
              <Progress value={Math.round((monitoring.progress || 0) * 100)} label="Journey progress" />
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span>Travelled {formatDistance((journey.route?.distanceMeters ?? 0) * (monitoring.progress || 0))}</span>
                {monitoring.deviationMeters !== undefined ? (
                  <span className={monitoring.deviationMeters > journey.corridorMeters ? 'text-amber-600 dark:text-amber-400' : ''}>
                    {monitoring.deviationMeters} m from route
                  </span>
                ) : null}
                {monitoring.delayMinutes > 0 ? <span>{monitoring.delayMinutes} min behind plan</span> : null}
                {monitoring.activeShares.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <Users className="size-3" aria-hidden />
                    {monitoring.activeShares.length} guardian(s) watching
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/app/journeys/${journey.id}`}>
                    <Route className="size-3.5" />
                    Open journey
                  </Link>
                </Button>
                {monitoring.monitoring ? (
                  <Button size="sm" variant="ghost" onClick={() => void monitoring.stop()}>
                    Pause monitoring
                  </Button>
                ) : (
                  <Button size="sm" variant="accent" onClick={() => void monitoring.start()}>
                    Start monitoring
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Nothing is being monitored right now. Plan a journey, or turn monitoring on to have SURAKSHA watch
                the device for signals.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="accent" asChild>
                  <Link to="/app/journeys/new">
                    <Plus className="size-3.5" />
                    Plan a journey
                  </Link>
                </Button>
                <Button size="sm" variant="outline" onClick={() => void monitoring.start()}>
                  Start monitoring
                </Button>
              </div>
            </div>
          )}

          <Disclaimer>{DISCLAIMERS.monitoring}</Disclaimer>
        </CardContent>
      </Card>

      {/* --------------------------- Status and SOS ---------------------------- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile
          label="Connectivity"
          value={usable ? 'Online' : online ? 'Server unreachable' : 'Offline'}
          tone={usable ? 'ok' : 'warn'}
          hint={usable ? 'Reports and sync can leave the device' : 'Everything continues on this device'}
          icon={<CloudOff className="size-3.5" aria-hidden />}
        />
        <StatusTile
          label="GPS"
          value={location.quality === 'none' ? 'No fix' : location.quality}
          tone={location.quality === 'none' || location.quality === 'poor' ? 'warn' : 'ok'}
          hint={location.point ? formatCoordinates(location.point, 3) : 'Waiting for a position'}
        />
        <StatusTile
          label="Monitoring"
          value={monitoring.monitoring ? 'On' : 'Off'}
          tone={monitoring.monitoring ? 'ok' : 'default'}
          hint={`${monitoring.status.tickCount} check(s) run`}
        />
        <StatusTile
          label="Queued reports"
          value={String(reportQueue?.pending ?? 0)}
          tone={(reportQueue?.pending ?? 0) > 0 ? 'warn' : 'ok'}
          hint={(reportQueue?.pending ?? 0) > 0 ? 'Still only on this device' : 'Nothing waiting to send'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ConnectivityPill />
        <GpsPill quality={location.quality} accuracyMeters={location.point?.accuracy} ageMs={location.ageMs} />
        {location.watching ? <Badge variant="info">live tracking</Badge> : null}
        <Button size="sm" variant="ghost" className="ml-auto" loading={syncing} onClick={() => void doSync()}>
          <RefreshCw className="size-3.5" />
          Sync now
        </Button>
      </div>

      <Card tone="danger">
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center gap-3">
            <Button variant="sos" size="xl" className="flex-1" onClick={() => navigate('/app/sos')}>
              <LifeBuoy className="size-5" />
              Emergency SOS
            </Button>
            {emergencyContact ? (
              <Button
                variant="outline"
                size="xl"
                onClick={() => void callContact(emergencyContact)}
                aria-label={`Call ${emergencyContact.name}`}
              >
                <Phone className="size-5" />
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            SOS captures your location, journey state and recent events on the device first, then alerts the
            contacts you selected. {COPY.delivery}
          </p>
        </CardContent>
      </Card>

      {/* ----------------------------- Next journey ---------------------------- */}
      {upcoming ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Route className="size-4 text-teal-500" aria-hidden />
              Next journey
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{upcoming.title}</p>
            <p className="text-xs text-muted-foreground">
              {upcoming.originLabel} → {upcoming.destinationLabel}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Departs {formatRelative(upcoming.scheduledStartAt)} · {upcoming.checkpoints.length} checkpoint(s) ·
              ETA {formatRelative(upcoming.expectedArrivalAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="accent" asChild>
                <Link to={`/app/journeys/${upcoming.id}`}>
                  Open
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void db.journeys.update(upcoming.id, { isDemo: upcoming.isDemo });
                }}
              >
                <Bell className="size-3.5" />
                Reminder set on this device
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------ Contacts ------------------------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Users className="size-4 text-teal-500" aria-hidden />
              Trusted contacts
            </span>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/app/contacts">Manage</Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(contacts ?? []).length === 0 ? (
            <InfoNote tone="warning" title="No trusted contacts yet">
              <p>
                Until you add one, escalation has nowhere to go. Add a contact and choose exactly what they may
                see.
              </p>
            </InfoNote>
          ) : (
            <ul className="space-y-2">
              {(contacts ?? []).slice(0, 3).map((contact) => (
                <li key={contact.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/60 p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {contact.name}
                      {contact.isPrimary ? <Badge variant="accent" className="ml-2">primary</Badge> : null}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {contact.phone} · {contact.canReceiveAlerts ? 'alerts on' : 'alerts off'} ·{' '}
                      {contact.canSeeLiveLocation ? 'live location' : 'no live location'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void callContact(contact)}>
                    <Phone className="size-3.5" />
                    Call
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ Quick actions -------------------------- */}
      <div className="grid grid-cols-2 gap-2.5">
        <QuickAction to="/app/report/new" icon={FileWarning} label="Report an incident" hint="Saved on this device first" />
        <QuickAction to="/app/community" icon={Activity} label="Community safety" hint="Verified reports nearby" />
        <QuickAction to="/app/history" icon={MapPin} label="Journey history" hint={`${completed} completed`} />
        <QuickAction
          to="/app/notifications"
          icon={Bell}
          label="Notifications"
          hint={unread ? `${unread} unread` : 'Nothing unread'}
        />
      </div>

      {/* ------------------------------- Offline ------------------------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <CloudOff className="size-4 text-teal-500" aria-hidden />
            Offline readiness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {readiness ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={readiness.readiness.shell ? 'success' : 'warning'}>app shell</Badge>
                <Badge variant={readiness.readiness.rules ? 'success' : 'warning'}>safety rules</Badge>
                <Badge variant={readiness.readiness.contacts ? 'success' : 'warning'}>contacts</Badge>
                <Badge variant={readiness.readiness.tiles ? 'success' : 'warning'}>
                  map tiles ({readiness.storage.perTable.mapPacks} packs)
                </Badge>
                <Badge variant={readiness.readiness.storage ? 'success' : 'warning'}>
                  storage {formatBytes(readiness.storage.usageBytes)}
                </Badge>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{readinessNote ?? readiness.readiness.note}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Checking what is stored on this device…</p>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/journeys/new">Download a journey corridor</Link>
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------ Timeline ------------------------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Activity className="size-4 text-teal-500" aria-hidden />
              {journey ? 'This journey so far' : 'Recent activity'}
            </span>
            {lastEvent ? <span className="text-[10px] text-muted-foreground">last {formatRelative(lastEvent.createdAt)}</span> : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(events ?? []).length === 0 ? (
            <EmptyState
              icon={<Activity className="size-5" />}
              title="No events recorded yet"
              description="Journey starts, checkpoints, deviations, check-ins, SOS and report outcomes all appear here — stored on this device."
            />
          ) : (
            <TimelineList events={events ?? []} limit={8} />
          )}
        </CardContent>
      </Card>

      <SectionHeader
        title="Why the numbers are honest"
        description="SURAKSHA never claims a delivery, an alert or a rescue that did not happen."
      />
      <InfoNote tone="muted" title="The rules this app follows">
        <ul className="list-inside list-disc space-y-1">
          <li>{COPY.riskHeuristic}</li>
          <li>{COPY.noRescueGuarantee}</li>
          <li>{COPY.delivery}</li>
        </ul>
      </InfoNote>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  hint,
}: {
  to: string;
  icon: typeof FileWarning;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-2.5 rounded-2xl border border-border bg-card/70 p-3 transition-colors hover:bg-muted/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </Link>
  );
}

export default HomeScreen;
