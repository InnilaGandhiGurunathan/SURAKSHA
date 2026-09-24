import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, ShieldAlert, Siren } from 'lucide-react';
import { db, type CheckInRecord } from '@/lib/db';
import { useMonitor } from '@/store/monitor';
import { respondToCheckIn } from '@/services/monitor';
import { useCountdown } from '@/hooks/useConnectivity';
import { Dialog, SheetContent } from './ui/overlay';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { InfoNote } from './StatusPieces';
import { toast } from 'sonner';

/**
 * The discreet safety check-in.
 *
 * This dialog is the heart of the "never auto-trigger an emergency" rule: when
 * signals accumulate, the app asks a quiet question rather than calling anyone.
 * The copy is explicit that no contact has been notified, and the three answers
 * map to clearly different outcomes.
 */
export function CheckInDialog({
  ownerId,
  checkIn: provided,
}: {
  ownerId: string;
  checkIn?: CheckInRecord;
}) {
  const stored = useLiveQuery(
    async () =>
      (await db.checkIns.where('ownerId').equals(ownerId).toArray())
        .filter((item) => item.status === 'pending')
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0],
    [ownerId],
    undefined,
  );

  const checkIn = provided ?? stored;
  const journey = useMonitor((store) => store.journey);
  const assessment = useMonitor((store) => store.assessment);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | undefined>();
  const navigate = useNavigate();

  const countdown = useCountdown(
    checkIn ? Math.max(0, new Date(checkIn.dueAt).getTime() - new Date(checkIn.createdAt).getTime()) : 0,
    Boolean(checkIn),
  );

  useEffect(() => {
    if (checkIn) setDismissed(undefined);
  }, [checkIn?.id]);

  // When the window closes with no answer, record it honestly and stop nagging.
  const [expiredHandled, setExpiredHandled] = useState<string | undefined>();
  useEffect(() => {
    if (!checkIn) return;
    const overdue = new Date(checkIn.dueAt).getTime() <= Date.now();
    if (overdue && expiredHandled !== checkIn.id) {
      setExpiredHandled(checkIn.id);
      void respondToCheckIn(checkIn.id, 'timeout');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn?.id, countdown.expired]);

  if (!checkIn || dismissed === checkIn.id) return null;

  const answer = async (response: 'safe' | 'not_safe' | 'snoozed') => {
    setBusy(true);
    try {
      const outcome = await respondToCheckIn(checkIn.id, response, journey?.lastKnownLocation);
      setDismissed(checkIn.id);
      toast.success(outcome.message);
      if (response === 'not_safe') navigate('/app/sos');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seconds = countdown.remainingSeconds;

  return (
    <Dialog open>
      <SheetContent
        title="Quick safety check — are you okay?"
        description="This is a quiet on-device check. Nobody has been contacted."
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        hideClose
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {assessment ? (
              <Badge variant={assessment.band as 'low' | 'medium' | 'high' | 'critical'}>
                {assessment.score}/100 heuristic
              </Badge>
            ) : null}
            <Badge variant="outline">
              <Clock className="size-3" aria-hidden />
              {seconds > 0 ? `${seconds}s left` : 'window closed'}
            </Badge>
          </div>

          <p className="text-sm leading-relaxed">{checkIn.prompt || checkIn.reason}</p>

          {assessment && assessment.rationale.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {assessment.rationale.slice(0, 4).map((reason) => (
                <li key={reason} className="flex items-start gap-1.5">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current" aria-hidden />
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2">
            <Button variant="accent" size="lg" loading={busy} onClick={() => void answer('safe')}>
              <CheckCircle2 className="size-4" />
              I am safe — clear these signals
            </Button>
            <Button variant="outline" loading={busy} onClick={() => void answer('snoozed')}>
              <Clock className="size-4" />
              Ask me again in 10 minutes
            </Button>
            <Button variant="sos" size="lg" loading={busy} onClick={() => void answer('not_safe')}>
              <Siren className="size-4" />
              I am not safe — alert my contacts
            </Button>
          </div>

          <InfoNote tone="info" title="What each answer does">
            <ul className="list-inside list-disc space-y-0.5">
              <li>
                <strong>Safe</strong> clears accumulated signals. This is the point of asking — no contact is told.
              </li>
              <li>
                <strong>Ask again</strong> postpones the check without changing the risk traffic.
              </li>
              <li>
                <strong>Not safe</strong> opens the emergency workflow and alerts the trusted contacts you selected.
              </li>
            </ul>
          </InfoNote>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            If you cannot answer because you need help now, use the SOS button — a missed check-in on its own
            never contacts anyone automatically.
          </p>
        </div>
      </SheetContent>
    </Dialog>
  );
}
