import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Clock,
  Lock,
  MapPin,
  RefreshCw,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { GuardianSnapshot } from '@suraksha/shared';
import { formatCoordinates } from '@suraksha/shared';
import { Shield as ShieldMark } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { Badge, RiskBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock, InfoNote } from '@/components/StatusPieces';
import { MapView } from '@/components/MapView';
import { EVENT_PRESENTATION } from '@/services/events';
import { openShare } from '@/services/guardian';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDateTime, formatRelative, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Public guardian dashboard (`/g/:token`).
 *
 * No account and no app required. The decryption key is in the URL *fragment*
 * (`#k=…`), which browsers never send to a server, so the server only ever holds
 * ciphertext. The page is explicit about two things a guardian must not
 * misunderstand: updates are only as fresh as the traveller's last connection,
 * and this page is not an emergency service.
 */
export function PublicGuardianScreen() {
  const { token = '' } = useParams();

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; snapshot: GuardianSnapshot; expiresAt: string; encrypted: boolean; fromCache: boolean }
    | { status: 'error'; message: string; missingKey: boolean }
  >({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const key = useMemo(() => {
    // The fragment is the only place the key lives; it is never sent upstream.
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('k') ?? params.get('key') ?? '';
  }, []);

  const load = useCallback(async () => {
    if (!key) {
      setState({
        status: 'error',
        missingKey: true,
        message:
          'This link is missing its decryption key. Open the exact link you were sent — the key is the part after the # symbol, and SURAKSHA never sees it.',
      });
      return;
    }

    const result = await openShare(token, key);
    if ('error' in result) {
      setState({ status: 'error', missingKey: false, message: result.error });
      return;
    }

    setState({
      status: 'ready',
      snapshot: result.snapshot,
      expiresAt: result.expiresAt,
      encrypted: result.encrypted,
      fromCache: result.fromCache,
    });
  }, [token, key]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className="app-shell grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-sm space-y-4">
          <ShieldMark animated className="mx-auto size-14" />
          <LoadingBlock label="Decrypting the shared journey on this device…" rows={3} />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="app-shell grid min-h-dvh place-items-center px-5 py-10">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-amber-500/15">
              <Lock className="size-5 text-amber-500" aria-hidden />
            </span>
            <div>
              <h1 className="text-lg font-semibold">This guardian link cannot be opened</h1>
              <p className="text-xs text-muted-foreground">SURAKSHA guardian access</p>
            </div>
          </div>

          <InfoNote tone="warning" title="Why">
            <p>{state.message}</p>
          </InfoNote>

          {state.missingKey ? (
            <InfoNote tone="info" title="What to do">
              <p>
                Ask the traveller to open the journey in SURAKSHA and use “Share with guardian” again, then open the
                new link in a single tap without trimming it.
              </p>
            </InfoNote>
          ) : null}

          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>

          <p className="text-[11px] text-muted-foreground">{DISCLAIMERS.shareDisclaimer}</p>
        </div>
      </div>
    );
  }

  const { snapshot, expiresAt, encrypted, fromCache } = state;
  const stale = snapshot.lastLocationAt
    ? Date.now() - new Date(snapshot.lastLocationAt).getTime() > 15 * 60_000
    : true;

  return (
    <div className="min-h-dvh bg-background pb-10">
      <header className="border-b border-border/70 bg-navy-900 px-5 py-6 text-white safe-top">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Shield className="size-9" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-teal-300">Guardian access</p>
            <h1 className="truncate text-lg font-bold">{snapshot.travellerName}</h1>
          </div>
          <Badge variant={encrypted ? 'success' : 'warning'} className="gap-1">
            <Lock aria-hidden />
            {encrypted ? 'encrypted' : 'unencrypted'}
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-5 pt-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-teal-500" aria-hidden />
                {snapshot.journeyTitle}
              </span>
              <RiskBadge band={snapshot.riskBand} score={snapshot.riskScore} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline">{snapshot.status}</Badge>
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden />
                {snapshot.originLabel} → {snapshot.destinationLabel}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                ETA {formatTime(snapshot.expectedArrivalAt)}
              </span>
            </div>

            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-teal-500" style={{ width: `${snapshot.progress.percent}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                About {snapshot.progress.percent}% of the way — {Math.round(snapshot.progress.remainingMeters / 1000)}{' '}
                km to go (estimate from the traveller’s device).
              </p>
            </div>

            {snapshot.lastKnownLocation ? (
              <>
                <MapView
                  markers={[
                    {
                      id: 'traveller',
                      point: snapshot.lastKnownLocation,
                      label: 'Last known position',
                      kind: 'user',
                    },
                  ]}
                  className="border-0"
                />
                <p className="text-[11px] text-muted-foreground">
                  Last known location {formatCoordinates(snapshot.lastKnownLocation)} ·{' '}
                  {snapshot.lastLocationAt ? formatRelative(snapshot.lastLocationAt) : 'time unknown'}
                  {stale ? ' (may be out of date)' : ''}
                </p>
              </>
            ) : (
              <InfoNote tone="warning" title="No location shared yet">
                <p>
                  The traveller’s device has not sent a position for this journey, or location sharing is off for
                  this link. That does not mean anything is wrong — devices are frequently offline.
                </p>
              </InfoNote>
            )}

            {fromCache ? (
              <InfoNote tone="warning" title="Showing a cached copy">
                <p>
                  The server could not be reached, so this is the last snapshot stored on this device. It may be
                  out of date.
                </p>
              </InfoNote>
            ) : null}

            <Button
              variant="outline"
              full
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {snapshot.checkpoints.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Checkpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {snapshot.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-2.5">
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                        checkpoint.status === 'reached'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : checkpoint.status === 'missed'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {checkpoint.status === 'reached' ? '✓' : checkpoint.status === 'missed' ? '!' : '·'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs">{checkpoint.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        expected {checkpoint.expectedOffsetMinutes} min after departure
                        {checkpoint.reachedAt ? ` · reached ${formatTime(checkpoint.reachedAt)}` : ''}
                      </p>
                    </div>
                    <Badge
                      variant={
                        checkpoint.status === 'reached' ? 'success' : checkpoint.status === 'missed' ? 'warning' : 'muted'
                      }
                    >
                      {checkpoint.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {snapshot.recentEvents.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-sky-500" aria-hidden />
                Recent events shared with you
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {snapshot.recentEvents.map((event) => (
                  <li key={event.id} className="flex items-start gap-2.5 rounded-xl border border-border bg-card/60 p-2.5">
                    <span
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        event.severity === 'critical'
                          ? 'bg-red-500'
                          : event.severity === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-sky-500',
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium">{EVENT_PRESENTATION[event.type]?.label ?? event.type}</p>
                      <p className="text-[11px] text-muted-foreground">{event.message}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <InfoNote tone="info" title="What to do with this page">
          <ul className="list-inside list-disc space-y-0.5">
            <li>If they are overdue, call or message them first — most delays have an ordinary explanation.</li>
            <li>If you cannot reach them and something looks wrong, contact local emergency services yourself.</li>
            <li>Quote the journey details above; this page is not an emergency service and cannot dispatch help.</li>
          </ul>
        </InfoNote>

        <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-100">
            {DISCLAIMERS.noRescueGuarantee} {snapshot.disclaimer}
          </p>
        </div>

        <p className="text-center text-[10px] text-muted-foreground">
          Access expires {formatDateTime(expiresAt)} · the traveller can revoke this link at any time · decrypted
          locally in your browser
        </p>
      </div>
    </div>
  );
}

export default PublicGuardianScreen;
