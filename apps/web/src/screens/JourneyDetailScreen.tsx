import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Flag,
  Gauge,
  Link2,
  MapPin,
  Pause,
  Play,
  Route as RouteIcon,
  Share2,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import type { GuardianShareScope, Journey, JourneyEvent, TrustedContact, UserProfile } from '@suraksha/shared';
import { formatCoordinates } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, RiskBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxRow, Field, Input, Textarea } from '@/components/ui/field';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Disclaimer, EmptyState, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { MapView } from '@/components/MapView';
import { TimelineList } from '@/components/TimelineList';
import { RiskPanel } from '@/components/RiskPanel';
import { useMonitoring } from '@/hooks/useMonitoring';
import { db } from '@/lib/db';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDistance, formatDateTime, formatDuration, formatRelative, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { canStartJourney, journeyStatusLabel, markCheckpointReached, deleteJourney, cancelJourney, completeJourney, pauseJourney, resumeJourney, startJourney } from '@/services/journeys';
import { buildTimelineSummary, listEvents } from '@/services/events';
import { listContacts } from '@/services/contacts';
import { SHARE_SCOPES, createGuardianShare, listShares, revokeShare } from '@/services/guardian';
import { mapPackFor } from '@/services/tiles';
import { downloadOfflineBundle, OFFLINE_NOTE } from '@/services/offline';
import { toast } from 'sonner';

/**
 * One journey, end to end.
 *
 * The screen is the honest cockpit for a trip: what the device knows (position,
 * progress, checkpoint ledger), what it is doing (monitoring on/off, guardian
 * links), and what it has recorded (timeline). Every action here is local-first;
 * nothing contacts anyone unless the rules or the traveller say so.
 */
export function JourneyDetailScreen({ user }: { user: UserProfile }) {
  const { journeyId = '' } = useParams();
  const navigate = useNavigate();
  const monitoring = useMonitoring(user.id);

  const journey = useLiveQuery(async () => db.journeys.get(journeyId), [journeyId]);
  const events = useLiveQuery(
    async () => (journey ? listEvents({ ownerId: user.id, journeyId, limit: 300 }) : []),
    [journeyId, user.id],
  );
  const contacts = useLiveQuery(async () => listContacts(user.id), [user.id], [] as TrustedContact[]);
  const shares = useLiveQuery(async () => listShares(user.id), [user.id], []);
  const mapPack = useLiveQuery(async () => mapPackFor(journeyId), [journeyId]);
  // Track points are read straight from Dexie: on a journey this can be a long
  // list, so it is capped and sorted oldest-first for the polyline.
  const track = useLiveQuery(
    async () =>
      (await db.locations.where('journeyId').equals(journeyId).toArray())
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
        .slice(-500),
    [journeyId],
  );

  const [tab, setTab] = useState<'overview' | 'checkpoints' | 'guardians' | 'timeline'>('overview');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareContactId, setShareContactId] = useState('');
  const [shareScopes, setShareScopes] = useState<string[]>(['journey:read', 'location:read', 'alerts:read', 'events:read']);
  const [link, setLink] = useState<{ url: string; message: string; warning?: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | undefined>();

  const timeline = useMemo(() => buildTimelineSummary(events ?? []), [events]);
  const isActive = journey?.status === 'active';
  const sharesForJourney = (shares ?? []).filter((share) => share.journeyId === journeyId);
  const selectedContacts = (contacts ?? []).filter((contact) => journey?.guardianContactIds.includes(contact.id));

  if (!journey) {
    return (
      <div className="space-y-3 pb-6">
        <SectionHeader title="Journey" description="This journey is not on this device any more." />
        <Button variant="outline" asChild>
          <Link to="/app/journeys">
            <ArrowLeft className="size-4" />
            Back to journeys
          </Link>
        </Button>
      </div>
    );
  }

  const markers = [
    { id: 'origin', point: journey.origin, label: journey.originLabel, kind: 'origin' as const },
    { id: 'destination', point: journey.destination, label: journey.destinationLabel, kind: 'destination' as const },
    ...journey.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      point: checkpoint.location,
      label: checkpoint.label,
      kind:
        checkpoint.status === 'reached'
          ? ('checkpoint-reached' as const)
          : checkpoint.status === 'missed'
            ? ('checkpoint-missed' as const)
            : ('checkpoint' as const),
    })),
    ...(journey.lastKnownLocation
      ? [{ id: 'traveller', point: journey.lastKnownLocation, label: 'Last known position', kind: 'user' as const }]
      : []),
  ];

  const exportJourney = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      journey,
      events: events ?? [],
      shares: sharesForJourney.map((share) => ({ ...share, token: undefined })),
      note: 'Risk values are heuristic on-device indicators, not probabilities.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `suraksha-journey-${journey.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Journey exported as JSON from this device.');
  };

  return (
    <div className="space-y-4 pb-8">
      <Button variant="ghost" size="sm" onClick={() => navigate('/app/journeys')}>
        <ArrowLeft className="size-3.5" />
        All journeys
      </Button>

      <SectionHeader
        title={journey.title}
        description={`${journey.originLabel} → ${journey.destinationLabel}`}
        action={
          <div className="flex items-center gap-1.5">
            <Badge variant={isActive ? 'success' : journey.status === 'escalated' ? 'danger' : 'muted'}>
              {journey.status}
            </Badge>
            {journey.isDemo ? <Badge variant="outline">demo record</Badge> : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile
          label="Monitoring"
          value={monitoring.monitoring ? 'on this device' : 'off'}
          tone={monitoring.monitoring ? 'ok' : 'warn'}
          hint={monitoring.message}
        />
        <StatusTile
          label="Progress"
          value={`${Math.round((isActive ? monitoring.progress : journey.status === 'completed' ? 1 : 0) * 100)}%`}
          hint={journey.route ? `${formatDistance(journey.route.distanceMeters)} planned` : 'route not set'}
        />
        <StatusTile
          label="Checkpoints"
          value={`${journey.checkpoints.filter((item) => item.status === 'reached').length}/${journey.checkpoints.length}`}
          tone={journey.checkpoints.some((item) => item.status === 'missed') ? 'warn' : 'default'}
          hint={`${journey.checkpoints.filter((item) => item.status === 'missed').length} missed`}
        />
        <StatusTile
          label="Guardians"
          value={String(selectedContacts.length)}
          tone={selectedContacts.length ? 'ok' : 'warn'}
          hint={selectedContacts.length ? 'can be contacted' : 'none selected'}
          icon={<Users className="size-3.5" />}
        />
      </div>

      {journey.riskScore !== undefined ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Gauge className="size-4 text-teal-500" aria-hidden />
                Risk indicator
              </span>
              <RiskBadge band={journey.riskBand ?? 'safe'} score={journey.riskScore} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RiskPanel assessment={monitoring.assessment} rules={monitoring.rules} compact />
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------ controls */}
      <Card>
        <CardContent className="flex flex-wrap gap-2 pt-5">
          {canStartJourney(journey) ? (
            <Button
              variant="accent"
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await startJourney(journey.id);
                toast.success('Journey started — monitoring is running on this device.');
                setBusy(false);
              }}
            >
              <Play className="size-3.5" />
              {journey.status === 'paused' ? 'Resume journey' : 'Start journey'}
            </Button>
          ) : null}

          {isActive ? (
            <>
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await pauseJourney(journey.id);
                  toast.message('Monitoring paused. Nothing is being evaluated while paused.');
                  setBusy(false);
                }}
              >
                <Pause className="size-3.5" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await completeJourney(journey.id);
                  toast.success('Journey marked complete.');
                  setBusy(false);
                }}
              >
                <Square className="size-3.5" />
                Complete
              </Button>
            </>
          ) : null}

          {journey.status === 'paused' ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await resumeJourney(journey.id);
                setBusy(false);
              }}
            >
              <Play className="size-3.5" />
              Resume
            </Button>
          ) : null}

          <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)}>
            <Share2 className="size-3.5" />
            Share with guardian
          </Button>

          <Button size="sm" variant="ghost" onClick={() => void exportJourney()}>
            <Download className="size-3.5" />
            Export JSON
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={async () => {
              await cancelJourney(journey.id);
              toast.message('Journey cancelled. The record stays in your history.');
            }}
          >
            <XCircle className="size-3.5" />
            Cancel journey
          </Button>

          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" className="text-destructive">
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            }
            title="Delete this journey from the device?"
            description="The journey, its track points, events and guardian links are removed locally. Reports filed during it are kept."
            confirmLabel="Delete journey"
            onConfirm={async () => {
              await deleteJourney(journey.id);
              toast.success('Journey deleted from this device.');
              navigate('/app/journeys', { replace: true });
            }}
          />
        </CardContent>
      </Card>

      {isActive ? (
        <InfoNote tone="info" title="Guardian Mode">
          <p>
            While this journey is active the device evaluates route progress, checkpoint windows and delays locally
            every {monitoring.rules?.monitoringIntervalSeconds ?? 45} seconds. Nothing leaves the phone unless the
            escalation rules are met or you trigger SOS.
          </p>
        </InfoNote>
      ) : null}

      {/* --------------------------------------------------------------- tabs */}
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints ({journey.checkpoints.length})</TabsTrigger>
          <TabsTrigger value="guardians">Guardians ({sharesForJourney.filter((s) => s.status === 'active').length})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.total})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-3">
            <MapView
              markers={markers}
              track={(track ?? []).map((point) => point.point)}
              route={journey.route}
              approximate={journey.route?.approximate}
              className="border-0"
            />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <RouteIcon className="size-4 text-teal-500" aria-hidden />
                  Route and timing
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-[11px] sm:grid-cols-2">
                <Row label="Status" value={journeyStatusLabel(journey)} />
                <Row label="Transport" value={journey.transportMode} />
                <Row label="Planned start" value={formatDateTime(journey.scheduledStartAt)} />
                <Row label="Actually started" value={journey.startedAt ? formatDateTime(journey.startedAt) : 'not yet'} />
                <Row label="Expected arrival" value={journey.expectedArrivalAt ? formatDateTime(journey.expectedArrivalAt) : 'not set'} />
                <Row
                  label="Route"
                  value={
                    journey.route
                      ? `${formatDistance(journey.route.distanceMeters)} · ${formatDuration(journey.route.durationMinutes)} · ${journey.route.provider}`
                      : 'no route stored'
                  }
                />
                <Row label="Corridor" value={`${journey.corridorMeters} m each side`} />
                <Row
                  label="Last position"
                  value={
                    journey.lastKnownLocation
                      ? `${formatCoordinates(journey.lastKnownLocation)} · ${journey.lastLocationAt ? formatRelative(journey.lastLocationAt) : 'time unknown'}`
                      : 'no position recorded yet'
                  }
                />
                {journey.notes ? <Row label="Notes" value={journey.notes} span /> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-teal-500" aria-hidden />
                  Offline map pack
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {mapPack ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden />
                      {mapPack.tilesStored}/{mapPack.tilesRequested} tile(s) stored
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatBytesLocal(mapPack.bytes)} · {mapPack.status}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No offline imagery for this corridor yet. Tracking, checkpoints and deviations all work without
                    tiles — the map simply draws the route and your position on a plain canvas.
                  </p>
                )}

                {downloadNote ? <p className="text-[11px] text-muted-foreground">{downloadNote}</p> : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={downloading}
                    disabled={!journey.route}
                    onClick={async () => {
                      setDownloading(true);
                      setDownloadNote('Preparing…');
                      const result = await downloadOfflineBundle({
                        ownerId: user.id,
                        journeyId: journey.id,
                        label: journey.title,
                        origin: journey.origin,
                        destination: journey.destination,
                        paddingPoints: journey.checkpoints.map((checkpoint) => checkpoint.location),
                        onStep: (step) => setDownloadNote(`${step.label}: ${step.detail}`),
                      });
                      setDownloading(false);
                      setDownloadNote(result.messages.slice(-1)[0]);
                      toast.message(result.ok ? 'Offline map corridor stored.' : 'The corridor could not be fully stored.');
                    }}
                  >
                    <Download className="size-3.5" />
                    Download corridor tiles
                  </Button>
                </div>

                <Disclaimer>{OFFLINE_NOTE}</Disclaimer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="checkpoints">
          {journey.checkpoints.length === 0 ? (
            <EmptyState
              icon={<Flag className="size-5" />}
              title="No checkpoints on this journey"
              description="Checkpoints are optional. Adding them gives the device something concrete to verify, and gives a missed one a meaning."
            />
          ) : (
            <ul className="space-y-2">
              {journey.checkpoints.map((checkpoint) => (
                <li key={checkpoint.id}>
                  <Card>
                    <CardContent className="flex items-start gap-3 pt-5">
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-xl',
                          checkpoint.status === 'reached'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : checkpoint.status === 'missed'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden
                      >
                        {checkpoint.status === 'reached' ? <CheckCircle2 className="size-4" /> : <Flag className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{checkpoint.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          expected {checkpoint.expectedOffsetMinutes} min after departure · window {checkpoint.windowMinutes} min
                          {checkpoint.reachedAt ? ` · reached ${formatTime(checkpoint.reachedAt)}` : ''}
                          {checkpoint.missedAt ? ` · missed ${formatTime(checkpoint.missedAt)}` : ''}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatCoordinates(checkpoint.location)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge
                          variant={
                            checkpoint.status === 'reached' ? 'success' : checkpoint.status === 'missed' ? 'warning' : 'muted'
                          }
                        >
                          {checkpoint.status}
                        </Badge>
                        {checkpoint.status === 'pending' && isActive ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await markCheckpointReached(journey.id, checkpoint.id, { automatic: false });
                              toast.success(`Checkpoint “${checkpoint.label}” confirmed.`);
                            }}
                          >
                            I'm here
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <InfoNote tone="warning" title="A missed checkpoint does not summon help" className="mt-3">
            <p>
              One missed checkpoint adds {monitoring.rules?.missedCheckpointWeight ?? 10} to the risk indicator and
              opens a discreet check-in. It never contacts anyone by itself; escalation needs several independent
              signals, and you always get the chance to answer first.
            </p>
          </InfoNote>
        </TabsContent>

        <TabsContent value="guardians">
          {sharesForJourney.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No guardian links yet"
              description="A guardian link gives one trusted person read-only access to this journey — no account needed, encrypted, and revocable at any time."
              action={
                <Button size="sm" variant="accent" onClick={() => setShareOpen(true)}>
                  <Link2 className="size-3.5" />
                  Create a guardian link
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {sharesForJourney.map((share) => (
                <li key={share.id}>
                  <Card>
                    <CardContent className="space-y-2 pt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">{share.contactName}</span>
                        <Badge variant={share.status === 'active' ? 'success' : share.status === 'revoked' ? 'danger' : 'muted'}>
                          {share.status}
                        </Badge>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          expires {formatDateTime(share.expiresAt)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {share.scopes.map((scope) => (
                          <Badge key={scope} variant="outline">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {share.lastViewedAt ? `last opened ${formatRelative(share.lastViewedAt)}` : 'not opened yet'} ·
                        snapshot updates only when this device has a connection
                      </p>
                      {share.status === 'active' ? (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="ghost" className="text-destructive">
                              Revoke access
                            </Button>
                          }
                          title="Revoke this guardian link?"
                          description="The link stops working immediately and the stored snapshot is deleted. The guardian will see that access was withdrawn."
                          confirmLabel="Revoke"
                          onConfirm={async () => {
                            await revokeShare(share.id);
                            toast.success('Guardian link revoked.');
                          }}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4 text-teal-500" aria-hidden />
                Journey timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
                <Badge variant="muted">{timeline.total} event(s)</Badge>
                <Badge variant="danger">{timeline.critical} critical</Badge>
                <Badge variant="warning">{timeline.warnings} warning(s)</Badge>
                <Badge variant="outline">
                  {journey.checkpoints.filter((item) => item.status === 'reached').length} checkpoint(s) reached
                </Badge>
              </div>
              <TimelineList events={(events ?? []) as JourneyEvent[]} collapsibleBeyond={10} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------------- share dialog */}
      <Dialog open={shareOpen} onOpenChange={(open) => !open && setShareOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this journey with a guardian</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="Trusted contact" htmlFor="share-contact" required>
              <select
                id="share-contact"
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                value={shareContactId}
                onChange={(event) => setShareContactId(event.target.value)}
              >
                <option value="">Select a contact…</option>
                {(contacts ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} {contact.canViewJourney ? '' : '(journey viewing not permitted)'}
                  </option>
                ))}
              </select>
            </Field>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">What they can see</p>
              {SHARE_SCOPES.map((scope) => (
                <CheckboxRow
                  key={scope.value}
                  id={`scope-${scope.value}`}
                  label={scope.label}
                  description={scope.description}
                  checked={shareScopes.includes(scope.value)}
                  onChange={(checked) =>
                    setShareScopes((current) =>
                      checked ? [...current, scope.value] : current.filter((value) => value !== scope.value),
                    )
                  }
                />
              ))}
            </div>

            {link ? (
              <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
                <p className="text-xs font-semibold">Link created</p>
                <p className="break-all font-mono text-[10px]">{link.url}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(link.message);
                      toast.success('Invitation copied. Send it through a channel you already trust.');
                    }}
                  >
                    Copy invitation
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    asChild
                  >
                    <a href={`sms:?&body=${encodeURIComponent(link.message)}`}>Open in messages</a>
                  </Button>
                </div>
                {link.warning ? <p className="text-[10px] text-amber-600 dark:text-amber-400">{link.warning}</p> : null}
                <Disclaimer>{DISCLAIMERS.shareDisclaimer}</Disclaimer>
              </div>
            ) : (
              <Button
                variant="accent"
                full
                loading={busy}
                onClick={async () => {
                  const contact = (contacts ?? []).find((item) => item.id === shareContactId);
                  if (!contact) {
                    toast.error('Choose a trusted contact first.');
                    return;
                  }
                  setBusy(true);
                  try {
                    const created = await createGuardianShare({
                      journeyId: journey.id,
                      ownerId: user.id,
                      contact: { id: contact.id, name: contact.name },
                      scopes: shareScopes as GuardianShareScope[],
                    });
                    setLink({ url: created.url, message: created.message, warning: created.warning });
                    toast.success('Guardian link created. Copy it now — the key is never shown again.');
                  } catch (error) {
                    toast.error((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Share2 className="size-4" />
                Create encrypted link
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShareOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(journey.status === 'cancelled' || journey.status === 'completed') && journey.riskScore && journey.riskScore >= 25 ? (
        <InfoNote tone="muted" title="How this journey ended">
          <p>
            It finished with a peak heuristic indicator of {journey.riskScore} ({journey.riskBand}). The timeline above
            shows exactly which signals fired and how they were resolved. Nothing here implies that anyone was
            dispatched.
          </p>
        </InfoNote>
      ) : null}

      <InfoNote tone="muted" title="What the app cannot do">
        <p>
          <AlertTriangle className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
          {DISCLAIMERS.monitoring}
        </p>
      </InfoNote>
    </div>
  );
}

function formatBytesLocal(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'no tiles yet';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Row({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border bg-muted/20 px-2.5 py-2', span && 'sm:col-span-2')}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[11px] font-medium">{value}</dd>
    </div>
  );
}

export default JourneyDetailScreen;
