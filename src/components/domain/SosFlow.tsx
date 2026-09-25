/**
 * Quick SOS — the emergency *workflow* view.
 *
 * The quick path is a single tap. It used to require a two-second hold, which
 * put a deliberate-activation gesture on the one control whose whole point is
 * speed; hold-to-confirm is the wrong trade-off when the traveller is the one
 * asking for help. Once activated, this shows exactly what happened, what did
 * not, and how to reach real emergency help.
 */

import { AlertOctagon, BellRing, FileText, LogIn, MapPin, Phone, ShieldCheck, ShieldAlert, Siren, UserCheck } from 'lucide-react';
import { Button, Modal, StatusPill } from '@/components/ui/primitives';
import { useNavigate } from 'react-router-dom';
import { useAppState, store } from '@/store/hooks';
import { useAuth } from '@/store/authStore';
import { formatClock, formatRelative } from '@/lib/format';
import { formatLatLng } from '@/domain/geo';
import { EMERGENCY_NUMBER, originMayDial } from '@/domain/types';
import { RiskWhyPanel } from './RiskWhyPanel';
import { cn } from '@/lib/cn';

export function SosPanel() {
  const { ui, journey, incidents, activeIncidentId, now } = useAppState();
  const open = ui.sosPanelOpen;
  const incident = incidents.find((i) => i.id === (activeIncidentId ?? journey?.incidentId)) ?? null;
  const activated = Boolean(incident) || journey?.risk.reasons.some((r) => r.code === 'explicit_sos');
  /*
   * The dialable number is offered only on a record the traveller themselves
   * started, and the gate lives in the domain layer so no passive signal can
   * reach it. Persisted records with no recorded origin fail closed.
   */
  const canDial = Boolean(incident && originMayDial(incident.origin));

  return (
    <Modal
      open={open}
      onClose={() => store.toggleUi('sosPanelOpen', false)}
      size="md"
      tone={activated ? 'critical' : undefined}
      title={activated ? 'Emergency workflow activated' : 'Quick SOS'}
      description={
        activated
          ? 'Your trusted circle has been alerted with your latest information. SURAKSHA never dials emergency services for you.'
          : 'One tap alerts your trusted circle. It is not a call to the police or an ambulance.'
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
              variant="danger"
              icon={<AlertOctagon size={16} />}
              onClick={() => store.triggerSos('quick_sos')}
            >
              Activate now
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

          <RiskWhyPanel assessment={journey?.risk ?? { score: incident.riskScore, band: 'CRITICAL', reasons: incident.riskReasons, headline: incident.summary, hasRecovery: false }} />

          <div className="rounded-xl border border-critical-200 bg-critical-50 px-3.5 py-3">
            <p className="flex items-start gap-2 text-[12.5px] font-medium leading-relaxed text-critical-800">
              <Siren size={16} className="mt-0.5 shrink-0" />
              <span>
                Need immediate emergency assistance? Contact your local emergency service directly. SURAKSHA never dials
                for you, never dispatches them, and never decides that you are in danger.
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canDial ? (
              /*
               * A real tel: link the traveller presses themselves. SURAKSHA
               * never places the call, and only ever offers this on a record
               * the traveller started — no passive signal can reach it.
               */
              <a
                href={`tel:${EMERGENCY_NUMBER}`}
                onClick={() => store.recordEmergencyDialAttempt(incident?.id)}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-critical-600 px-4 text-sm font-bold text-white transition-state hover:bg-critical-700"
              >
                <Phone size={17} />
                Call {EMERGENCY_NUMBER} now
              </a>
            ) : (
              <Button
                variant="danger"
                icon={<Phone size={16} />}
                onClick={() =>
                  store.pushToast({
                    title: `Call ${EMERGENCY_NUMBER} yourself`,
                    description:
                      'This record came from passively detected signals, so SURAKSHA will not put a dialable number on it. Dial your local emergency number directly if you are in danger.',
                    tone: 'alert',
                  })
                }
              >
                How to call emergency services
              </Button>
            )}
            <Button
              variant="outline"
              icon={<ShieldCheck size={16} />}
              onClick={() => store.confirmSafe('incident')}
            >
              I&apos;m safe now
            </Button>
          </div>

          {canDial && incident?.handoff.emergencyNumberDialledAt ? (
            <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600">
              You opened the dialler at {formatClock(incident.handoff.emergencyNumberDialledAt)}. SURAKSHA did not place
              the call and cannot tell whether it connected.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 py-2">
          {/* Single tap: the quick path exists precisely when speed matters. */}
          <button
            type="button"
            onClick={() => store.triggerSos('quick_sos')}
            aria-label="Activate the emergency workflow now"
            className="group flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl bg-critical-600 px-6 py-7 text-white transition-state hover:bg-critical-700 active:scale-[0.98]"
          >
            <span className="relative grid place-items-center">
              <span className="absolute h-16 w-16 rounded-full ring-2 ring-critical-300/70 animate-pulse-ring" aria-hidden />
              <AlertOctagon size={38} />
            </span>
            <span className="text-[17px] font-bold uppercase tracking-[0.08em]">Activate Quick SOS</span>
            <span className="text-[12px] font-medium opacity-90">One tap — no hold required</span>
          </button>

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
            Neither SURAKSHA nor any automatic rule dials for you. If you can reach a phone, dial {EMERGENCY_NUMBER}{' '}
            yourself — SURAKSHA works alongside those services, it does not stand in for them.
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

/**
 * The persistent Quick SOS control used in the shell + home screen.
 *
 * Lifecycle is auth-gated: before the traveller is signed in this control —
 * and the corresponding tab in the mobile bottom bar — becomes the
 * **Sign In** affordance, so there is exactly one obvious way into the app.
 */
export function SosButton({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { journey } = useAppState();
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const icon = signedIn ? <Siren size={compact ? 16 : 18} /> : <LogIn size={compact ? 16 : 18} />;

  return (
    <button
      type="button"
      onClick={() => (signedIn ? store.toggleUi('sosPanelOpen', true) : navigate('/login'))}
      aria-label={signedIn ? 'Quick SOS — opens the emergency workflow' : 'Sign in to SURAKSHA'}
      className={cn(
        'group inline-flex items-center gap-2 rounded-xl bg-critical-600 font-bold text-white transition-state hover:bg-critical-700 active:scale-[0.98]',
        compact ? 'h-10 px-3 text-[12.5px]' : 'h-12 px-4 text-sm',
        className,
      )}
    >
      <span className="relative grid place-items-center">
        {icon}
        {signedIn && !journey ? <span className="absolute inset-0 rounded-full ring-2 ring-critical-300 animate-pulse-ring" aria-hidden /> : null}
      </span>
      {signedIn ? 'QUICK SOS' : 'SIGN IN'}
    </button>
  );
}

export function formatSosLocation(journeyPosition: { x: number; y: number } | null): string {
  return journeyPosition ? formatLatLng(journeyPosition) : 'Location unavailable';
}
