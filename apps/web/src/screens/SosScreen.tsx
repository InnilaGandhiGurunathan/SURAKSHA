import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  EyeOff,
  MessageSquare,
  Phone,
  RefreshCw,
  ShieldOff,
  Siren,
  Users,
} from 'lucide-react';
import type { UserProfile } from '@suraksha/shared';
import { formatCoordinates } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/misc';
import { Field, Input } from '@/components/ui/field';
import { Disclaimer, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { useLocation } from '@/hooks/useLocation';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDateTime, formatRelative } from '@/lib/format';
import { DISCLAIMERS as COPY } from '@/lib/constants';
import { db } from '@/lib/db';
import { activeJourney } from '@/services/journeys';
import { copyAlertToClipboard, cancelSos, sosHistory, startSmsHandoff, triggerSos, type SosResult } from '@/services/sos';
import { callEmergency, dialLink } from '@/services/call';
import { listContacts } from '@/services/contacts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * SOS.
 *
 * Two-step activation on purpose: a single accidental tap must not send an alert,
 * but the confirmation window is short (5 seconds) and cancellable, and a
 * dedicated **silent** trigger is available for situations where making noise is
 * dangerous. After triggering, the screen's job changes: it reports exactly what
 * happened — which channels worked, which did not, and what the user can still do.
 */
export function SosScreen({ user }: { user: UserProfile }) {
  const location = useLocation({ watch: true, minDistanceMeters: 10 });
  const [armed, setArmed] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [silent, setSilent] = useState(user.rules?.silentSos ?? false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SosResult | undefined>();
  const [journeyTitle, setJourneyTitle] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const history = useLiveQuery(async () => sosHistory(user.id, 6), [user.id], []);
  const contacts = useLiveQuery(async () => listContacts(user.id), [user.id], []);

  useEffect(() => {
    void activeJourney(user.id).then((journey) => setJourneyTitle(journey?.title));
  }, [user.id]);

  // The arming countdown: short, visible, and cancellable.
  useEffect(() => {
    if (!armed) {
      clearInterval(timerRef.current);
      setCountdown(5);
      return undefined;
    }
    timerRef.current = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          clearInterval(timerRef.current);
          void fire();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  const fire = async () => {
    setArmed(false);
    setBusy(true);
    try {
      const outcome = await triggerSos({
        user,
        silent,
        note: note || undefined,
        location: location.point,
        source: 'button',
      });
      setResult(outcome);
      toast.success(
        outcome.deliveryStatus === 'server_acknowledged'
          ? 'Alert acknowledged by the reporting server.'
          : 'Alert stored on this device. It will be sent when a connection is available.',
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const alertingContacts = (contacts ?? []).filter((contact) => contact.canReceiveAlerts);
  const emergencyNumber = user.emergency.emergencyNumber || '112';

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="Emergency SOS"
        description="Works offline. Nothing here claims help is on the way — it tells your contacts and records everything."
      />

      {result ? (
        <Card tone={result.deliveryStatus === 'server_acknowledged' ? 'warning' : 'danger'}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              {result.deliveryStatus === 'server_acknowledged' ? (
                <CheckCircle2 className="size-4 text-amber-500" aria-hidden />
              ) : (
                <AlertTriangle className="size-4 text-red-500" aria-hidden />
              )}
              SOS is active
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={result.deliveryStatus === 'server_acknowledged' ? 'warning' : 'danger'}>
              {result.deliveryStatus === 'server_acknowledged'
                ? 'Alert acknowledged by the reporting server'
                : result.deliveryStatus === 'queued_on_device'
                  ? 'Queued on this device — not delivered anywhere yet'
                  : 'Delivery failed — stored on this device'}
            </Badge>

            <p className="text-xs leading-relaxed">{result.deliveryMessage}</p>

            {result.notify ? (
              <p className="text-xs leading-relaxed">
                Contacts selected: {result.notify.attempted}. {result.notify.message}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatusTile label="Triggered" value={formatRelative(result.triggeredAt)} hint={formatDateTime(result.triggeredAt)} />
              <StatusTile
                label="Location captured"
                value={result.location ? 'yes' : 'no'}
                tone={result.location ? 'ok' : 'warn'}
                hint={result.location ? formatCoordinates(result.location, 5) : 'no GPS fix at trigger time'}
              />
              <StatusTile label="Journey" value={result.journey ? 'linked' : 'none active'} hint={result.journey?.title ?? 'no journey running'} />
              <StatusTile label="Silent" value={result.silent ? 'yes' : 'no'} hint={result.silent ? 'no sound or vibration' : 'vibrated'} />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="sos" onClick={() => void callEmergency(user)}>
                <Phone className="size-4" />
                Call {emergencyNumber} now
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const outcome = await startSmsHandoff({ user, journey: result.journey, note });
                  toast.message(outcome.message);
                }}
              >
                <MessageSquare className="size-4" />
                Open SMS handoff
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyAlertToClipboard({ user, journey: result.journey, note });
                  toast.message(ok ? 'Alert text copied. Paste it into any messaging app.' : 'Could not access the clipboard — read the details on this screen.',);
                }}
              >
                <Copy className="size-4" />
                Copy alert text
              </Button>
              <Button
                variant="outline"
                loading={busy}
                onClick={async () => {
                  const outcome = await triggerSos({ user, silent, note, location: location.point, source: 'button' });
                  setResult(outcome);
                  toast.message('Alert re-attempted with the latest position.');
                }}
              >
                <RefreshCw className="size-4" />
                Re-send with current position
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={async () => {
                  await cancelSos({ user, alertId: result.alertId, reason: 'Cancelled from the SOS screen.' });
                  setResult(undefined);
                  toast.message('SOS cancelled. Tell your contacts directly if they were already alerted.');
                }}
              >
                <ShieldOff className="size-4" />
                I am safe — cancel SOS
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/app/journeys">Back to journeys</Link>
              </Button>
            </div>

            <InfoNote tone="warning" title="Be explicit with your contacts">
              <p>
                SURAKSHA cannot recall an alert that has already left the device, and it cannot tell whether your
                contacts saw it. If you are safe, message them yourself.
              </p>
            </InfoNote>
          </CardContent>
        </Card>
      ) : (
        <Card tone="danger">
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <button
                type="button"
                onClick={() => setArmed(true)}
                disabled={busy || armed}
                className={cn(
                  'relative grid size-40 place-items-center rounded-full bg-sos text-sos-foreground shadow-[var(--shadow-sos)] transition-transform active:scale-95 disabled:opacity-90',
                  !armed && 'animate-sos-pulse',
                )}
                aria-label={armed ? 'SOS arming, tap cancel to stop' : 'Activate emergency SOS'}
              >
                {armed ? (
                  <span className="text-5xl font-black tabular-nums">{countdown}</span>
                ) : (
                  <>
                    <span className="absolute inset-0 rounded-full bg-sos/30 animate-sos-ring" aria-hidden />
                    <Siren className="relative size-12" />
                  </>
                )}
              </button>

              {armed ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Sending in {countdown}s…</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setArmed(false);
                      toast.message('SOS stopped before it was sent.');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold">Tap to activate</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    You get 5 seconds to cancel. Your location, journey state and recent events are captured on this
                    device first.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <EyeOff className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="text-xs font-semibold">Silent activation</p>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      No vibration and no system notification, for when drawing attention is dangerous.
                    </p>
                  </div>
                </div>
                <Switch checked={silent} onCheckedChange={setSilent} aria-label="Silent SOS" />
              </div>
            </div>

            <Field label="Add a note for your contacts (optional)" htmlFor="sos-note">
              <Input
                id="sos-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Being followed near the station exit"
              />
            </Field>

            <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground">What will happen</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>An event is written on this device immediately (no network needed).</li>
                <li>
                  {alertingContacts.length} contact(s) with alerts enabled are selected
                  {journeyTitle ? ` for “${journeyTitle}”` : ''}, plus any guardian links you created.
                </li>
                <li>The alert is posted to the reporting server, or queued at highest priority if offline.</li>
                <li>Guardian snapshots are refreshed so watchers see the latest position.</li>
              </ul>
            </div>

            <InfoNote tone="warning" title="Before you rely on this">
              <p>{COPY.noRescueGuarantee}</p>
              <p className="mt-1">{COPY.sms}</p>
            </InfoNote>

            <Button variant="outline" full asChild>
              <a href={dialLink(emergencyNumber)}>
                <Phone className="size-4" />
                Call {emergencyNumber} (opens your dialler)
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-teal-500" aria-hidden />
            Who will be told
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alertingContacts.length === 0 ? (
            <InfoNote tone="warning" title="Nobody has alerts enabled">
              <p>
                Add a trusted contact with alerts enabled, or SOS will only be recorded on this device and queued to
                the reporting server.{' '}
                <Link to="/app/contacts" className="underline">
                  Manage contacts
                </Link>
                .
              </p>
            </InfoNote>
          ) : (
            <ul className="space-y-1.5">
              {alertingContacts.map((contact) => (
                <li key={contact.id} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-2">
                  <span className="text-xs">
                    {contact.name}
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {contact.canSeeLiveLocation ? 'location shared' : 'no location'}, priority {contact.priority}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" asChild>
                    <a href={dialLink(contact.phone)}>
                      <Phone className="size-3.5" />
                      Call
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Disclaimer className="mt-3">{DISCLAIMERS.emergencyDial}</Disclaimer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-teal-500" aria-hidden />
            Recent SOS records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No SOS has ever been triggered on this device.</p>
          ) : (
            <ul className="space-y-2">
              {(history ?? []).map((event) => (
                <li key={event.id} className="rounded-xl border border-border bg-card/60 p-2.5">
                  <p className="text-[11px] font-semibold">{event.message}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatDateTime(event.createdAt)} · {event.syncedAt ? 'mirrored to the server' : 'on this device only'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SosScreen;
