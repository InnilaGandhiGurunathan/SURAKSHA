/**
 * "I need help" response options.
 * Proportionate choices first, escalation last — the traveller decides.
 */

import { Link } from 'react-router-dom';
import { CheckCircle2, MessageSquare, PhoneCall, ShieldAlert, Users } from 'lucide-react';
import { Button, Modal } from '@/components/ui/primitives';
import { useAppState, useCircle, store } from '@/store/hooks';

export function HelpPanel() {
  const { ui, journey } = useAppState();
  const { primary, backup } = useCircle();

  return (
    <Modal
      open={ui.helpPanelOpen}
      onClose={() => store.toggleUi('helpPanelOpen', false)}
      title="What would help right now?"
      description="Nothing here is irreversible, and you can change your mind. SURAKSHA will only do what you choose."
      size="md"
    >
      <div className="space-y-2.5">
        <OptionRow
          icon={<MessageSquare size={17} />}
          title={`Message ${primary?.name ?? 'your guardian'}`}
          body="Sends a short update with your last known location. No alarm — just a human who knows to check in."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                store.requestHelp();
                store.pushToast({
                  title: `Message sent to ${primary?.name ?? 'your guardian'}`,
                  description: 'They can see your last known position (simulated in this prototype).',
                  tone: 'brand',
                });
                store.toggleUi('helpPanelOpen', false);
              }}
            >
              Send
            </Button>
          }
        />
        <OptionRow
          icon={<PhoneCall size={17} />}
          title="Open Exit Mode"
          body="A simulated incoming call gives you a believable reason to leave. No one is contacted."
          action={
            <Link
              to="/traveller/exit"
              onClick={() => store.toggleUi('helpPanelOpen', false)}
              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-ink-200 bg-white px-3 text-[13px] font-semibold text-ink-800 hover:bg-ink-50"
            >
              Open
            </Link>
          }
        />
        <OptionRow
          icon={<Users size={17} />}
          title={`Escalate to ${backup?.name ?? 'backup contact'}`}
          body="Adds your backup guardian to this journey's notifications."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                store.pushToast({
                  title: `${backup?.name ?? 'Backup contact'} added to escalation`,
                  description: 'They will receive the next update for this journey.',
                  tone: 'alert',
                });
                store.toggleUi('helpPanelOpen', false);
              }}
            >
              Add
            </Button>
          }
        />
        <OptionRow
          icon={<ShieldAlert size={17} />}
          title="Quick SOS"
          body="Logs a CRITICAL event, creates an incident and alerts your whole circle. It does not call emergency services."
          action={
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                store.toggleUi('helpPanelOpen', false);
                store.toggleUi('sosPanelOpen', true);
              }}
            >
              Open SOS
            </Button>
          }
        />

        <div className="flex items-center justify-between gap-3 rounded-xl border border-safe-200 bg-safe-50 px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-safe-700" />
            <div>
              <p className="text-[13px] font-semibold text-safe-900">Actually fine now?</p>
              <p className="mt-0.5 text-[12px] text-safe-800">Confirm safety and SURAKSHA will stand down the escalation.</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="safe"
            onClick={() => {
              store.confirmSafe('journey');
              store.toggleUi('helpPanelOpen', false);
            }}
          >
            I&apos;M SAFE
          </Button>
        </div>
      </div>

      {journey?.primaryContactId ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
          Escalation order for this journey: primary guardian → backup guardian → emergency workflow. SURAKSHA never skips
          to contacting emergency services on your behalf.
        </p>
      ) : null}
    </Modal>
  );
}

function OptionRow({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-ink-200 bg-white px-3.5 py-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink-900">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
