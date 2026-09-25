/**
 * Guardian-side surface for "I need help".
 *
 * The traveller could press I NEED HELP, and the guardian side showed nothing
 * at all — the request existed only as an event in the timeline. This is the
 * pop-up the guardian actually sees: who, where, the current state, and how
 * long is left before the request escalates on its own.
 *
 * It is a prompt to try to reach a human, never a claim that anyone is hurt.
 */

import type { ReactNode } from 'react';
import { CheckCircle2, HelpCircle, MapPin, MessageSquare, Phone, Timer, Users } from 'lucide-react';
import { Button, Modal, StatusPill } from '@/components/ui/primitives';
import { useAppState, useCircle, useNow, store } from '@/store/hooks';
import { describePosition } from '@/store/store';
import { formatCountdown } from '@/lib/format';
import { cn } from '@/lib/cn';

export function GuardianHelpAlert() {
  const { role, journey } = useAppState();
  const { primary } = useCircle();
  const now = useNow();

  /*
   * Only the guardian sees this, and only while a help request is open on a
   * journey that has not ended. `helpRequestedAt` is cleared the moment the
   * traveller confirms safety, so the pop-up stands itself down.
   */
  const open = Boolean(role === 'guardian' && journey?.helpRequestedAt && journey.status !== 'ENDED');

  if (!journey) return null;

  const remaining = journey.helpDeadlineAt ? Math.max(0, journey.helpDeadlineAt - now) : 0;
  const urgent = remaining <= 45_000;

  return (
    <Modal
      open={open}
      onClose={() => store.resolveHelpFollowUp('acknowledged')}
      size="md"
      tone="watch"
      title="Your traveller asked for help"
      description="They pressed I NEED HELP. Nothing has been confirmed — this is a request to try to reach them."
      footer={
        <Button variant="outline" onClick={() => store.resolveHelpFollowUp('acknowledged')}>
          Mark as handled
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill band={journey.risk.band} size="lg" />
          <span className="rounded-lg bg-ink-100 px-2.5 py-1 font-mono text-[13px] font-semibold text-ink-700">
            {journey.risk.score}
          </span>
          <span className="text-[12.5px] text-ink-500">risk score · {journey.risk.band}</span>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Fact
            icon={<HelpCircle size={15} />}
            label="Traveller"
            value={`${journey.travellerName} · ${journey.originLabel} → ${journey.destinationLabel}`}
          />
          <Fact
            icon={<MapPin size={15} />}
            label="Last known position"
            value={
              journey.locationAvailable
                ? describePosition(journey, now)
                : 'Location unavailable — last known position only'
            }
          />
          <Fact
            icon={<Users size={15} />}
            label="Escalation order"
            value={`${journey.escalationOrder.length} trusted contact(s)`}
          />
          <Fact
            icon={<Phone size={15} />}
            label="Primary guardian"
            value={primary ? `${primary.name} · ${primary.relationship}` : 'Not set for this journey'}
          />
        </dl>

        <div
          className={cn(
            'flex items-center justify-between rounded-xl border px-3.5 py-3',
            urgent ? 'border-alert-200 bg-alert-50' : 'border-ink-200 bg-ink-50',
          )}
        >
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
            <Timer size={15} className={urgent ? 'text-alert-600' : 'text-ink-500'} />
            Escalates to the whole circle in
          </span>
          <span className={cn('text-lg font-bold tabular', urgent ? 'text-alert-700' : 'text-ink-800')}>
            {formatCountdown(remaining)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Phone size={16} />}
            onClick={() => store.resolveHelpFollowUp('acknowledged')}
          >
            I am calling them now
          </Button>
          <Button variant="safe" icon={<CheckCircle2 size={16} />} onClick={() => store.confirmSafe('journey')}>
            Traveller is safe
          </Button>
        </div>

        <p className="flex gap-2 rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
          <MessageSquare size={14} className="mt-0.5 shrink-0 text-ink-400" />
          <span>
            SURAKSHA does not know whether anything is wrong, and it never dials emergency services for you. If you
            believe someone is in immediate danger, call your local emergency number yourself.
          </span>
        </p>
      </div>
    </Modal>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold leading-snug text-ink-800">{value}</dd>
    </div>
  );
}
