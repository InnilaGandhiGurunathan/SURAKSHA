/**
 * Auto check-in prompt. "Everything okay?" — deliberately neutral language.
 * Both buttons are large touch targets; the safe option is the visually
 * dominant one so the calm path is the easy path.
 */

import { CheckCircle2, Clock, HelpCircle, ShieldQuestion, TimerOff } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';
import { useAppState, useNow, store } from '@/store/hooks';
import { formatClock, formatCountdown } from '@/lib/format';
import { cn } from '@/lib/cn';

export function CheckInPrompt() {
  const { journey, ui } = useAppState();
  const now = useNow();
  const open = Boolean(ui.checkInPromptOpen && journey && journey.checkIn.state === 'REQUESTED');

  if (!journey) return null;
  const remaining = journey.checkIn.expiresAt ? Math.max(0, journey.checkIn.expiresAt - now) : 0;
  const urgent = remaining <= 45_000;

  return (
    <Modal
      open={open}
      onClose={() => store.toggleUi('checkInPromptOpen', false)}
      size="sm"
      title="Everything okay?"
      description={`Routine check-in${journey.checkIn.requestedAt ? ` sent at ${formatClock(journey.checkIn.requestedAt)}` : ''} while you travel to ${journey.destinationLabel}.`}
      footer={
        <button
          type="button"
          onClick={() => store.toggleUi('checkInPromptOpen', false)}
          className="text-[12.5px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-700"
        >
          Remind me in a moment
        </button>
      }
    >
      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between rounded-xl border px-3.5 py-3 transition-state',
            urgent ? 'border-alert-200 bg-alert-50' : 'border-ink-200 bg-ink-50',
          )}
        >
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
            <Clock size={15} className={urgent ? 'text-alert-600' : 'text-ink-500'} />
            Grace period ends in
          </span>
          <span className={cn('text-lg font-bold tabular', urgent ? 'text-alert-700' : 'text-ink-800')}>
            {formatCountdown(remaining)}
          </span>
        </div>

        <Button
          variant="safe"
          size="xl"
          block
          icon={<CheckCircle2 size={20} />}
          onClick={() => {
            store.confirmSafe('checkin');
            store.toggleUi('checkInPromptOpen', false);
          }}
        >
          I&apos;M SAFE
        </Button>

        <Button
          variant="outline"
          size="xl"
          block
          className="border-alert-200 text-alert-700 hover:bg-alert-50"
          icon={<HelpCircle size={20} />}
          onClick={() => {
            store.requestHelp();
            store.toggleUi('checkInPromptOpen', false);
          }}
        >
          I NEED HELP
        </Button>

        <div className="flex gap-2 rounded-xl bg-ink-50 px-3 py-2.5 text-[12px] leading-relaxed text-ink-600">
          <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-ink-400" />
          <span>
            If you do not respond, SURAKSHA records <strong className="font-semibold">“safety check-in missed”</strong> and
            tells your guardian. That is not a claim that you are in danger — it is a prompt for a human to check on you.
          </span>
        </div>
      </div>
    </Modal>
  );
}

/** Banner shown when a check-in was missed but no modal is blocking the UI. */
export function MissedCheckInBanner() {
  const { journey } = useAppState();
  if (!journey || journey.checkIn.state !== 'MISSED' || journey.risk.band === 'CRITICAL') return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-alert-200 bg-alert-50 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-alert-100 text-alert-700">
          <TimerOff size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-alert-900">Safety check-in missed</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-alert-800">
            We could not reach you for one routine check. Your guardian has been told. This is not a claim that you are in
            danger.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="safe"
          icon={<CheckCircle2 size={15} />}
          onClick={() => store.confirmSafe('checkin')}
        >
          I&apos;M SAFE
        </Button>
        <Button size="sm" variant="outline" onClick={() => store.startExitMode({ delaySeconds: 10, contactId: 'ct-priya' })}>
          Exit Mode
        </Button>
      </div>
    </div>
  );
}
