import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import type { IncidentReport, UserProfile } from '@suraksha/shared';
import { REPORT_CATEGORIES, reportReference } from '@suraksha/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Disclaimer, EmptyState, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { TimelineList } from '@/components/TimelineList';
import { RISK_BAND_META } from '@/lib/format';
import { APP_VERSION, DISCLAIMERS, SUPPORT_EMAIL } from '@/lib/constants';
import { appEnv } from '@/lib/env';
import { ApiRequestError, apiFetch, checkHealth, type HealthResult } from '@/services/api';
import { formatDateTime, formatRelative, truncate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Admin / response dashboard.
 *
 * Role-gated: the `admin` or `responder` role is required, and the check is
 * repeated on the server for every endpoint — the client gate is only there so a
 * traveller never accidentally lands on a console full of other people's data.
 *
 * The console is deliberately read-and-review. It shows incident queues,
 * verification workflow, alert monitoring and journey event timelines, and it
 * refuses to invent anything when the backend is unreachable.
 */

type IncidentRow = {
  clientReportId: string;
  reference?: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  verification: 'unverified' | 'verified' | 'rejected';
  isCommunityVisible?: boolean;
  verificationNote?: string;
  occurredAt: string;
  receivedAt?: string;
  createdAt?: string;
  reporterName?: string;
  reporterContact?: string;
  anonymity?: string;
  location?: { lat: number; lng: number; accuracy?: number };
  locationLabel?: string;
  journeyId?: string;
  source?: string;
  riskScore?: number;
};

type AlertRow = {
  id: string;
  journeyId?: string;
  ownerId?: string;
  kind: string;
  status: string;
  message: string;
  location?: { lat: number; lng: number };
  riskScore?: number;
  riskBand?: string;
  createdAt: string;
  acknowledgedAt?: string;
  isDemo?: boolean;
};

type ShareRow = {
  token: string;
  journeyId: string;
  contactName: string;
  scopes: string[];
  status: string;
  expiresAt: string;
  lastViewedAt?: string;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  traveller: 'Traveller',
  guardian: 'Guardian',
  responder: 'Responder',
  admin: 'Administrator',
};

export function AdminScreen({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'incidents' | 'alerts' | 'shares' | 'system'>('incidents');

  const [incidents, setIncidents] = useState<IncidentRow[] | undefined>();
  const [alerts, setAlerts] = useState<AlertRow[] | undefined>();
  const [shares, setShares] = useState<ShareRow[] | undefined>();
  const [health, setHealth] = useState<HealthResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [verificationFilter, setVerificationFilter] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<IncidentRow | undefined>();
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const authorised = user.role === 'admin' || user.role === 'responder';

  const load = useCallback(async () => {
    if (!authorised) return;
    setLoading(true);
    setError(undefined);

    const [healthResult, incidentResult, alertResult, shareResult] = await Promise.allSettled([
      checkHealth(6000),
      apiFetch<{ items: IncidentRow[] }>(`/admin/incidents${verificationFilter ? `?verification=${verificationFilter}` : ''}`),
      apiFetch<{ items: AlertRow[] }>('/alerts?limit=60'),
      apiFetch<{ items: ShareRow[] }>('/admin/shares?limit=60').catch(() => ({ items: [] as ShareRow[] })),
    ]);

    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);

    if (incidentResult.status === 'fulfilled') {
      setIncidents(incidentResult.value.items ?? []);
    } else {
      setIncidents(undefined);
      setError(
        incidentResult.reason instanceof ApiRequestError
          ? incidentResult.reason.status === 401 || incidentResult.reason.status === 403
            ? 'The reporting server refused this request: your account does not carry the responder or administrator role there. Roles are granted in Supabase (see db/README).'
            : incidentResult.reason.message
          : 'The incident queue could not be loaded.',
      );
    }

    setAlerts(alertResult.status === 'fulfilled' ? (alertResult.value.items ?? []) : undefined);
    setShares(shareResult.status === 'fulfilled' ? shareResult.value.items ?? [] : undefined);
    setLoading(false);
  }, [authorised, verificationFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!incidents) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return incidents;
    return incidents.filter((incident) =>
      [incident.title, incident.description, incident.reference, incident.clientReportId, incident.locationLabel]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [incidents, query]);

  const review = async (incident: IncidentRow, decision: 'verified' | 'rejected', communityVisible: boolean) => {
    setReviewBusy(true);
    try {
      await apiFetch(`/admin/incidents/${encodeURIComponent(incident.clientReportId)}/verification`, {
        method: 'POST',
        body: { verification: decision, note: reviewNote.trim() || undefined, communityVisible },
      });
      toast.success(
        decision === 'verified'
          ? communityVisible
            ? 'Verified and published to the community feed with identity removed.'
            : 'Verified. It stays private.'
          : 'Marked as rejected. It will not be published.',
      );
      setOpen(undefined);
      setReviewNote('');
      await load();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'The review could not be saved.');
    } finally {
      setReviewBusy(false);
    }
  };

  if (!authorised) {
    return (
      <div className="space-y-4 pb-6">
        <SectionHeader title="Response dashboard" description="Restricted area." />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-destructive" aria-hidden />
              You do not have access
            </CardTitle>
            <CardDescription>
              This console shows incident reports and alert traffic for everyone on the deployment, so it is limited to
              accounts with the <strong>responder</strong> or <strong>administrator</strong> role.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Your current role on this device is <Badge variant="muted">{ROLE_LABEL[user.role] ?? user.role}</Badge>.
            </p>
            <InfoNote tone="info" title="If you are the deployment operator">
              <ul className="list-inside list-disc space-y-0.5">
                <li>Sign in with a Supabase account, then set the role in the <code>profiles</code> table.</li>
                <li>
                  The reporting server authorises every <code>/admin/*</code> request itself using the bearer token —
                  this screen cannot be unlocked from the browser.
                </li>
                <li>
                  Setup steps are documented in <code>db/README.md</code> and <code>.env.example</code>.
                </li>
              </ul>
            </InfoNote>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/app">Back to my dashboard</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/app/settings">Check integrations</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const unverified = (incidents ?? []).filter((incident) => incident.verification === 'unverified').length;
  const published = (incidents ?? []).filter((incident) => incident.isCommunityVisible).length;
  const openAlerts = (alerts ?? []).filter((alert) => alert.status !== 'resolved' && alert.status !== 'cancelled').length;
  const activeShares = (shares ?? []).filter((share) => share.status === 'active').length;

  return (
    <div className="space-y-4 pb-8">
      <SectionHeader
        title="Response dashboard"
        description={`Signed in as ${user.fullName} · role ${ROLE_LABEL[user.role] ?? user.role}`}
        action={
          <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile
          label="Awaiting review"
          value={incidents ? String(unverified) : '—'}
          tone={unverified ? 'warn' : 'ok'}
          hint="Unverified incident reports"
        />
        <StatusTile label="Published" value={incidents ? String(published) : '—'} hint="Visible in the community feed" />
        <StatusTile
          label="Open alerts"
          value={alerts ? String(openAlerts) : '—'}
          tone={openAlerts ? 'bad' : 'ok'}
          hint="SOS and escalations not yet resolved"
        />
        <StatusTile
          label="Server"
          value={health ? (health.reachable ? 'reachable' : 'unreachable') : 'unknown'}
          tone={health?.reachable ? 'ok' : 'warn'}
          hint={health ? `Supabase: ${health.supabase}` : 'checking…'}
        />
      </div>

      {error ? (
        <InfoNote tone="danger" title="The incident queue could not be loaded">
          <p>{error}</p>
        </InfoNote>
      ) : null}

      {health && !health.reachable ? (
        <InfoNote tone="warning" title="Reporting server unreachable">
          <p>
            Nothing is displayed from cache here on purpose: a responder console that shows stale incident queues is
            worse than one that shows none. Queued items on travellers' devices will appear once the server is back.
          </p>
        </InfoNote>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="incidents">Incidents ({incidents?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alerts?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="shares">Guardian links ({activeShares})</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- incidents */}
        <TabsContent value="incidents">
          <Card className="mb-3">
            <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium">Search</span>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Reference, title, place…"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium">Verification state</span>
                <Select
                  value={verificationFilter}
                  onChange={(event) => setVerificationFilter(event.target.value)}
                  options={[
                    { value: '', label: 'All' },
                    { value: 'unverified', label: 'Unverified (needs review)' },
                    { value: 'verified', label: 'Verified' },
                    { value: 'rejected', label: 'Rejected' },
                  ]}
                />
              </label>
            </CardContent>
          </Card>

          {!incidents ? (
            <InfoNote tone="muted">
              <p>{loading ? 'Loading the incident queue…' : 'No incident queue available. Check the server connection above.'}</p>
            </InfoNote>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-5" />}
              title="Nothing to review"
              description="No incident reports match this filter. Reports filed while offline arrive here when the reporter's device reconnects."
            />
          ) : (
            <ul className="space-y-2.5">
              {filtered.map((incident) => (
                <li key={incident.clientReportId}>
                  <Card
                    className={cn(
                      incident.severity === 'critical' && 'border-red-500/50',
                      incident.verification === 'unverified' && incident.severity !== 'critical' && 'border-amber-500/40',
                    )}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate">{incident.title}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant={incident.severity === 'critical' ? 'danger' : incident.severity === 'high' ? 'warning' : 'muted'}>
                            {incident.severity}
                          </Badge>
                          <Badge
                            variant={
                              incident.verification === 'verified'
                                ? 'success'
                                : incident.verification === 'rejected'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {incident.verification}
                          </Badge>
                        </div>
                      </CardTitle>
                      <CardDescription>
                        {REPORT_CATEGORIES.find((entry) => entry.value === incident.category)?.label ?? incident.category} ·
                        occurred {formatDateTime(incident.occurredAt)} ·{' '}
                        {incident.receivedAt ? `received ${formatRelative(incident.receivedAt)}` : 'received time unknown'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2.5">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {truncate(incident.description, 220)}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span className="font-mono">{incident.reference ?? reportReference(incident.clientReportId)}</span>
                        {incident.locationLabel ? <span>{incident.locationLabel}</span> : null}
                        {incident.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {incident.location.lat.toFixed(4)}, {incident.location.lng.toFixed(4)}
                            {incident.location.accuracy ? ` ±${Math.round(incident.location.accuracy)} m` : ''}
                          </span>
                        ) : null}
                        <span>
                          reporter:{' '}
                          {incident.anonymity === 'anonymous'
                            ? 'anonymous (withheld by the reporter)'
                            : incident.reporterName ?? 'not given'}
                        </span>
                        {incident.source ? <span>channel: {incident.source}</span> : null}
                        {incident.journeyId ? <span>journey linked</span> : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setOpen(incident); setReviewNote(incident.verificationNote ?? ''); }}>
                          <Eye className="size-3.5" />
                          Review
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const lines = [
                              `REF ${incident.reference ?? reportReference(incident.clientReportId)}`,
                              `${incident.category} · ${incident.severity}`,
                              incident.title,
                              incident.locationLabel ?? '',
                              incident.location ? `${incident.location.lat},${incident.location.lng}` : '',
                            ].filter(Boolean);
                            await navigator.clipboard?.writeText(lines.join('\n'));
                            toast.success('Brief copied for a dispatch note.');
                          }}
                        >
                          Copy brief
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- alerts */}
        <TabsContent value="alerts">
          {!alerts ? (
            <InfoNote tone="muted">
              <p>Alert traffic is not available right now.</p>
            </InfoNote>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-5" />}
              title="No alerts on the server"
              description="SOS triggers and escalations appear here when a traveller's device can reach the server. Devices that are offline keep their alerts queued, so an empty queue is not proof that nothing happened."
            />
          ) : (
            <ul className="space-y-2.5">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Card className={cn(alert.kind === 'sos' && alert.status !== 'resolved' && 'border-red-500/50')}>
                    <CardContent className="space-y-2 pt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={alert.kind === 'sos' ? 'danger' : 'warning'}>{alert.kind}</Badge>
                        <Badge variant={alert.status === 'resolved' ? 'success' : alert.status === 'acknowledged' ? 'info' : 'warning'}>
                          {alert.status}
                        </Badge>
                        {alert.riskBand && alert.riskScore !== undefined ? (
                          <Badge variant="outline" className="gap-1.5">
                            <span className={cn('size-2 rounded-full', RISK_BAND_META[alert.riskBand as keyof typeof RISK_BAND_META]?.className ?? 'bg-muted')} aria-hidden />
                            {RISK_BAND_META[alert.riskBand as keyof typeof RISK_BAND_META]?.label ?? alert.riskBand} · {alert.riskScore}
                          </Badge>
                        ) : null}
                        {alert.isDemo ? <Badge variant="muted">demo record</Badge> : null}
                        <span className="ml-auto text-[10px] text-muted-foreground">{formatRelative(alert.createdAt)}</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">{alert.message}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {formatDateTime(alert.createdAt)}
                        </span>
                        {alert.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {alert.location.lat.toFixed(4)}, {alert.location.lng.toFixed(4)}
                          </span>
                        ) : (
                          <span>no location attached</span>
                        )}
                        {alert.journeyId ? <span className="font-mono">journey {alert.journeyId.slice(0, 8)}…</span> : null}
                        {alert.acknowledgedAt ? <span>acknowledged {formatRelative(alert.acknowledgedAt)}</span> : null}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- shares */}
        <TabsContent value="shares">
          {!shares || shares.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No guardian links"
              description="When a traveller shares a journey, the link appears here with its scopes and expiry. Snapshot contents stay end-to-end encrypted: the server only ever stores ciphertext."
            />
          ) : (
            <ul className="space-y-2.5">
              {shares.map((share) => (
                <li key={share.token}>
                  <Card>
                    <CardContent className="space-y-2 pt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">{share.contactName}</span>
                        <Badge variant={share.status === 'active' ? 'success' : 'muted'}>{share.status}</Badge>
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
                        {share.lastViewedAt ? `Last opened ${formatRelative(share.lastViewedAt)}` : 'Not opened yet'} ·
                        created {formatRelative(share.createdAt)} ·{' '}
                        <span className="font-mono">{share.token.slice(0, 10)}…</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        The decryption key travels in the link fragment and never reaches the server, so this page
                        cannot show the shared contents — by design.
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- system */}
        <TabsContent value="system">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Deployment status</CardTitle>
              <CardDescription>
                What is configured on this build. Nothing here is a substitute for the server's own checks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-[11px]">
              <dl className="grid gap-2 sm:grid-cols-2">
                <SystemRow label="Web app version" value={APP_VERSION} />
                <SystemRow label="API base" value={appEnv.apiBaseUrl} />
                <SystemRow label="Service worker" value={'serviceWorker' in navigator ? 'registered' : 'unsupported'} />
                <SystemRow
                  label="Reporting server"
                  value={health ? (health.reachable ? `reachable${health.version ? ` (v${health.version})` : ''}` : 'unreachable') : 'unknown'}
                />
                <SystemRow label="Supabase" value={health?.supabase ?? (appEnv.supabaseConfigured ? 'configured' : 'not configured')} />
                <SystemRow label="Fallback reporting site" value={appEnv.fallbackReportUrl} />
                <SystemRow label="Tile host" value={appEnv.tileUrlTemplate.includes('openstreetmap') ? 'public OSM (replace for production)' : 'custom'} />
                <SystemRow label="Support contact" value={SUPPORT_EMAIL} />
              </dl>

              <InfoNote tone={health?.supabase === 'connected' ? 'success' : 'warning'} title="Supabase and role-based access">
                <p>
                  Administrator and responder access is enforced by the reporting server and by Supabase row-level
                  security policies. If Supabase is not connected, this deployment is device-only: reports queue
                  locally and are shown to the user as queued, never as delivered.
                </p>
              </InfoNote>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Tables expected by this console</p>
                <ul className="grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
                  {['profiles', 'incident_reports', 'journeys', 'journey_locations', 'journey_events', 'trusted_contacts', 'alerts', 'guardian_shares'].map(
                    (table) => (
                      <li key={table} className="rounded-lg border border-border bg-muted/20 px-2 py-1 font-mono">
                        {table}
                      </li>
                    ),
                  )}
                </ul>
                <p className="text-[10px] text-muted-foreground">
                  Schema, row-level security policies and setup steps are in <code>db/schema.sql</code> and{' '}
                  <code>db/README.md</code>.
                </p>
              </div>

              <Disclaimer>{DISCLAIMERS.noRescueGuarantee}</Disclaimer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* --------------------------------------------------------- review dialog */}
      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(undefined)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-3">
            {open ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted" className="font-mono">
                    {open.reference ?? reportReference(open.clientReportId)}
                  </Badge>
                  <Badge variant="outline">{open.category}</Badge>
                  <Badge variant={open.severity === 'critical' ? 'danger' : 'warning'}>{open.severity}</Badge>
                  <Badge variant="muted">{open.status}</Badge>
                </div>

                <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/20 p-3 text-[11px] leading-relaxed">
                  {open.description}
                </p>

                <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
                  <SystemRow label="Occurred" value={formatDateTime(open.occurredAt)} />
                  <SystemRow label="Received" value={open.receivedAt ? formatDateTime(open.receivedAt) : 'not recorded'} />
                  <SystemRow label="Reporter" value={open.anonymity === 'anonymous' ? 'anonymous' : open.reporterName ?? 'not given'} />
                  <SystemRow label="Contact" value={open.anonymity === 'anonymous' ? 'withheld' : open.reporterContact ?? 'not given'} />
                  <SystemRow label="Place" value={open.locationLabel ?? 'not described'} />
                  <SystemRow
                    label="Position"
                    value={open.location ? `${open.location.lat.toFixed(5)}, ${open.location.lng.toFixed(5)}` : 'none attached'}
                  />
                  <SystemRow label="Channel" value={open.source ?? 'unknown'} />
                  <SystemRow
                    label="Device risk indicator"
                    value={open.riskScore !== undefined ? `${open.riskScore} (heuristic, not a probability)` : 'not supplied'}
                  />
                </dl>

                {open.journeyId ? (
                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <p className="mb-2 text-xs font-semibold">Journey event timeline</p>
                    <JourneyTimelinePanel journeyId={open.journeyId} />
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    This report is not linked to a journey, so there is no journey timeline to show.
                  </p>
                )}

                <Textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="Reviewer note (stored with the verification decision; shown to the reporter for rejections)"
                  className="min-h-[70px]"
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="accent"
                    loading={reviewBusy}
                    onClick={() => void review(open, 'verified', true)}
                  >
                    <CheckCircle2 className="size-4" />
                    Verify &amp; publish
                  </Button>
                  <Button
                    variant="outline"
                    loading={reviewBusy}
                    onClick={() => void review(open, 'verified', false)}
                  >
                    <ShieldCheck className="size-4" />
                    Verify privately
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    loading={reviewBusy}
                    onClick={() => void review(open, 'rejected', false)}
                  >
                    <XCircle className="size-4" />
                    Reject
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Publishing places a redacted summary in the community feed. Reporter identity is stripped at the
                  server, and precise locations are included only when the reporter left them attached.
                </p>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This queue shows what devices managed to send, not everything that happened. Treat absence of an alert as
          “not reported yet”, never as “safe”. {DISCLAIMERS.noRescueGuarantee}
        </p>
      </div>
    </div>
  );
}

function SystemRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  );
}

function JourneyTimelinePanel({ journeyId }: { journeyId: string }) {
  const [events, setEvents] = useState<Array<{ id: string; type: string; message: string; severity: string; createdAt: string }> | undefined>();
  const [note, setNote] = useState('Loading journey events…');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<{ items: Array<{ id: string; type: string; message: string; severity: string; createdAt: string }> }>(
          `/journeys/${encodeURIComponent(journeyId)}/events`,
        );
        if (!cancelled) {
          setEvents(data.items ?? []);
          setNote((data.items ?? []).length === 0 ? 'No events recorded for this journey yet.' : '');
        }
      } catch {
        // Local mirror: the responder may be looking at a journey reported from a
        // device that has not synced every event yet.
        const { listEvents } = await import('@/services/events');
        // Server timeline unavailable: fall back to whatever this device has.
        // `listEvents` filters by journeyId alone, so the owner id is not used.
        const local = await listEvents({ ownerId: 'responder-console', journeyId, limit: 200 });
        if (!cancelled) {
          setEvents(local);
          setNote(
            local.length === 0
              ? 'No journey events are available from the server or this device.'
              : 'Server timeline unavailable — showing events cached on this device.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journeyId]);

  return (
    <div className="space-y-2">
      {note ? <p className="text-[10px] text-muted-foreground">{note}</p> : null}
      <TimelineList
        events={(events ?? []) as never}
        emptyLabel="Nothing recorded for this journey."
        collapsibleBeyond={8}
      />
    </div>
  );
}

export default AdminScreen;
