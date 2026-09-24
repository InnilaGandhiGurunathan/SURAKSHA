/**
 * Quick SOS — deliberate activation (2 s hold + optional confirm), then the
 * emergency *workflow* view. It shows exactly what happened, what did not, and
 * how to reach real emergency help.
 */

import { AlertOctagon, BellRing, FileText, MapPin, Phone, ShieldCheck, ShieldAlert, Siren, UserCheck } from 'lucide-react';
import { Button, Modal, StatusPill } from '@/components/ui/primitives';
import { HoldButton } from '@/components/ui/HoldButton';
import { useAppState, store } from '@/store/hooks';
import { formatClock, formatRelative } from '@/lib/format';
import { formatLatLng } from '@/domain/geo';
import { RiskWhyPanel } from './RiskWhyPanel';
import { cn } from '@/lib/cn';

export function SosPanel() {
  const { ui, journey, incidents, activeIncidentId, now } = useAppState();
  const open = ui.sosPanelOpen;
  const incident = incidents.find((i) => i.id === (activeIncidentId ?? journey?.incidentId)) ?? null;
  const activated = Boolean(incident) || journey?.risk.reasons.some((r) => r.code === 'explicit_sos');

  return (
    <Modal
      open={open}
      onClose={() => store.toggleUi('sosPanelOpen', false)}
      size="md"
      tone={activated ? 'critical' : undefined}
      title={activated ? 'Emergency workflow activated' : 'Quick SOS'}
      description={
        activated
          ? 'Your trusted circle has been alerted with your latest information. SURAKSHA does not contact emergency services for you.'
          : 'This alerts your trusted circle. It is not a call to the police or an ambulance.'
      }
      footer={
        activated ? (
          <>
            <Button variant="outline" onClick={() => store.toggleUi('sosPanelOpen', false)}>
              Close
            </Button>
            {incident ? (
              <Button variant="primary" onClick={() => store.toggleUi('sosPanelOpen', false)}>
                View incident
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => store.toggleUi('sosPanelOpen', false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              icon={<Phone size={16} />}
              onClick={() =>
                store.pushToast({
                  title: 'Call your local emergency number',
                  description: 'In this prototype we cannot place calls. Dial your local emergency service directly.',
                  tone: 'alert',
                })
              }
            >
              Emergency services
            </Button>
          </>
        )
      }
    >
      {activated && incident ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill band="CRITICAL" size="lg" />
            <span className="rounded-lg bg-critical-50 px-2.5 py-1 font-mono text-[13px] font-bold text-critical-800">
              {incident.code}
            </span>
            <span className="text-[12.5px] text-ink-500">Created {formatClock(incident.createdAt)}</span>
          </div>

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Fact icon={<MapPin size={15} />} label="Current location" value={incident.locationLabel} />
            <Fact icon={<ShieldAlert size={15} />} label="Risk score" value={`${incident.riskScore} · ${incident.severity}`} />
            <Fact
              icon={<BellRing size={15} />}
              label="Guardian notification"
              value={
                incident.guardianNotifiedAt
                  ? `Sent ${formatRelative(incident.guardianNotifiedAt, now)}`
                  : 'Sending…'
              }
            />
            <Fact
              icon={<UserCheck size={15} />}
              label="Acknowledgement"
              value={
                incident.guardianAcknowledgedAt
                  ? `${incident.acknowledgedBy ?? 'Guardian'} at ${formatClock(incident.guardianAcknowledgedAt)}`
                  : 'Awaiting acknowledgement'
              }
            />
            <Fact
              icon={<FileText size={15} />}
              label="Evidence status"
              value={incident.evidence.length ? `${incident.evidence.length} item(s) hashed on device` : 'Not captured yet'}
            />
            <Fact icon={<ShieldCheck size={15} />} label="Escalation" value={`${incident.escalationOrder.length} trusted contacts`} />
          </dl>

          <RiskWhyPanel assessment={journey?.risk ?? { score: incident.riskScore, band: 'CRITICAL', reasons: incident.riskReasons, headline: incident.summary, hasRecovery: false, computedAt: incident.createdAt }} />

          <div className="rounded-xl border border-critical-200 bg-critical-50 px-3.5 py-3">
            <p className="flex items-start gap-2 text-[12.5px] font-medium leading-relaxed text-critical-800">
              <Siren size={16} className="mt-0.5 shrink-0" />
              <span>
                Need immediate emergency assistance? Contact your local emergency service directly. SURAKSHA does not call,
                dispatch or replace them, and it never decides that you are in danger.
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              icon={<Phone size={16} />}
              onClick={() => store.pushToast({ title: 'Emergency services', description: 'Dial your local emergency number on your phone.', tone: 'alert' })}
            >
              How to call emergency services
            </Button>
            <Button
              variant="outline"
              icon={<ShieldCheck size={16} />}
              onClick={() => store.confirmSafe('incident')}
            >
              I&apos;m safe now
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 py-2">
          <HoldButton
            onComplete={() => {
              store.triggerSos('quick_sos');
            }}
            label="Quick SOS"
            sublabel="Hold 2 seconds"
            icon={<AlertOctagon size={30} />}
          />

          <div className="grid w-full gap-2 sm:grid-cols-2">
            <InfoTile
              title="What happens"
              body="A CRITICAL event is logged, an incident is created, and your primary + backup guardians are notified with your last known location."
            />
            <InfoTile
              title="What does not happen"
              body="No emergency service is contacted. No AI decides you are in danger. Nothing leaves your device in this prototype."
            />
          </div>

          <div className="w-full rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
            If you can reach a phone, dial your local emergency number. SURAKSHA works alongside those services — it does
            not stand in for them.
          </div>
        </div>
      )}
    </Modal>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
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

function InfoTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/70 px-3.5 py-3">
      <p className="text-[12.5px] font-semibold text-ink-800">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

/** The persistent Quick SOS control used in the shell + home screen. */
export function SosButton({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { journey } = useAppState();
  const disabled = !journey || journey.status === 'ENDED';
  return (
    <button
      type="button"
      onClick={() => store.toggleUi('sosPanelOpen', true)}
      aria-label="Quick SOS — opens the emergency workflow"
      className={cn(
        'group inline-flex items-center gap-2 rounded-xl bg-critical-600 font-bold text-white transition-state hover:bg-critical-700 active:scale-[0.98]',
        compact ? 'h-10 px-3 text-[12.5px]' : 'h-12 px-4 text-sm',
        className,
      )}
    >
      <span className="relative grid place-items-center">
        <Siren size={compact ? 16 : 18} />
        {!disabled ? <span className="absolute inset-0 rounded-full ring-2 ring-critical-300 animate-pulse-ring" aria-hidden /> : null}
      </span>
      QUICK SOS
    </button>
  );
}

export function formatSosLocation(journeyPosition: { x: number; y: number } | null): string {
  return journeyPosition ? formatLatLng(journeyPosition) : 'Location unavailable';
}
