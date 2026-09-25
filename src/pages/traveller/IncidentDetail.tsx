/**
 * Incident detail — the record of what happened, what SURAKSHA did, and what
 * it deliberately did not do. Includes evidence integrity hashing.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Fingerprint,
  Hash,
  Info,
  MapPin,
  Phone,
  ShieldCheck,
  Siren,
  Trash2,
  Upload,
  UserCheck,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Modal,
  StatusPill,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { useAppState, store } from '@/store/hooks';
import { formatBytes, formatClock, formatDateTime, shortHash } from '@/lib/format';
import { createEvidenceRecord, syntheticVoiceNoteBuffer, readEvidenceFile, EVIDENCE_MIME_TYPES } from '@/services/evidence';
import { describePosition } from '@/store/store';
import { toneForSeverity } from '@/lib/status';
import { cn } from '@/lib/cn';

export function IncidentDetail({ role }: { role: 'traveller' | 'guardian' }) {
  const { incidentId } = useParams<{ incidentId: string }>();
  const { incidents, events, now, contacts, journey } = useAppState();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  const reportError = (error: unknown) => setFeedback({ error: true, message: error instanceof Error ? error.message : 'Could not save evidence. Please try again.' });

  const incident = incidents.find((i) => i.id === incidentId);

  if (!incident) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Incident" title="Incident not found" />
        <EmptyState
          icon={<FileText size={20} />}
          title="No incident with that ID"
          description="It may have been deleted as part of your data-retention settings."
          action={
            <Link
              to={role === 'guardian' ? '/guardian/incidents' : '/traveller/incidents'}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white"
            >
              Back to incidents
            </Link>
          }
        />
      </div>
    );
  }

  const timeline = events.filter(
    (e) => e.incidentId === incident.id || (incident.journeyId && e.journeyId === incident.journeyId),
  );
  const tone = toneForSeverity(incident.severity);
  const primary = contacts.find((c) => c.id === incident.escalationOrder[0]);
  const backup = contacts.find((c) => c.id === incident.escalationOrder[1]);
  const positives = incident.riskReasons.filter((r) => r.delta > 0);

  const attachDemoEvidence = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const buffer = syntheticVoiceNoteBuffer(3);
      const record = await createEvidenceRecord({
        fileName: `srk-${incident.code.replace('SRK-', '')}-voice-note.wav`,
        mimeType: 'audio/wav',
        buffer,
        kind: 'voice_note',
        description: 'Three-second tone generated on this device to demonstrate integrity hashing.',
        // Stamped on the simulator's clock so it matches the incident timeline.
        at: now,
      });
      await store.saveEvidence(incident.id, record, buffer);
      setFeedback({ error: false, message: 'Evidence attached and saved on this device.' });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const attachFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const buffer = await readEvidenceFile(file);
      const record = await createEvidenceRecord({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        buffer,
        kind: 'note',
        description: 'Attached locally. Nothing is uploaded in this prototype.',
        at: now,
      });
      await store.saveEvidence(incident.id, { ...record, simulated: false }, buffer);
      setFeedback({ error: false, message: 'Evidence attached and saved on this device.' });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={role === 'guardian' ? 'Guardian · Incident' : 'Traveller · Incident'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">🔴 INCIDENT #{incident.code}</span>
            <StatusPill band={incident.severity} size="sm" showEmoji={false} />
          </span>
        }
        description={incident.summary}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={15} />}
            onClick={() => window.history.back()}
          >
            Back
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="space-y-4">
          <Card tone={tone} className={cn('bg-white')}>
            <CardHeader
              title="Incident summary"
              subtitle={`Created ${formatDateTime(incident.createdAt)} · updated ${formatClock(incident.updatedAt)}`}
              icon={<Siren size={16} />}
              action={<Badge tone={incident.status === 'RESOLVED' ? 'safe' : role === 'guardian' ? 'critical' : 'brand'}>{incident.status}</Badge>}
            />
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact icon={<Clock size={14} />} label="Created" value={formatClock(incident.createdAt)} />
              <Fact icon={<ShieldCheck size={14} />} label="Risk score" value={`${incident.riskScore} / 100`} />
              <Fact icon={<UserCheck size={14} />} label="Traveller" value={incident.travellerName} />
              <Fact
                icon={<MapPin size={14} />}
                label="Location"
                value={incident.locationAvailable ? incident.locationLabel : 'Location unavailable — last known position'}
              />
              <Fact
                icon={<Phone size={14} />}
                label="Guardian notified"
                value={incident.guardianNotifiedAt ? `${formatClock(incident.guardianNotifiedAt)} · ${primary?.name ?? 'primary'}` : 'Not yet'}
              />
              <Fact
                icon={<CheckCircle2 size={14} />}
                label="Acknowledged"
                value={
                  incident.guardianAcknowledgedAt
                    ? `${formatClock(incident.guardianAcknowledgedAt)} · ${incident.acknowledgedBy ?? 'guardian'}`
                    : 'Awaiting acknowledgement'
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Why this risk score" subtitle="Every point, explained. No unexplained number." icon={<Info size={16} />} />
            <CardBody className="space-y-2">
              <ul className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200">
                {positives.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5">
                    <span className="min-w-0 text-[13px] font-medium text-ink-800">{reason.label}</span>
                    <span className="shrink-0 rounded-lg bg-ink-100 px-2 py-0.5 text-[12.5px] font-bold text-ink-800 tabular">
                      +{reason.delta}
                    </span>
                  </li>
                ))}
                {incident.riskReasons.filter((r) => r.delta < 0).map((reason, index) => (
                  <li key={`neg-${index}`} className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5">
                    <span className="min-w-0 text-[13px] font-medium text-ink-800">{reason.label}</span>
                    <span className="shrink-0 rounded-lg bg-safe-100 px-2 py-0.5 text-[12.5px] font-bold text-safe-800 tabular">
                      −{Math.abs(reason.delta)}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-ink-50 px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold text-ink-700">Total</span>
                  <span className="text-[13px] font-bold text-ink-900 tabular">{incident.riskScore} / 100</span>
                </li>
              </ul>
              <p className="text-[12.5px] leading-relaxed text-ink-500">
                “Safety Risk Engine detected multiple safety signals.” The score does not determine that anyone is in
                danger, and SURAKSHA never claims to detect an attacker or predict an assault.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Timeline"
              subtitle="Recorded automatically as the journey progressed."
              icon={<Clock size={16} />}
              action={<Chip tone="neutral">{timeline.length} events</Chip>}
            />
            <CardBody className="pt-2">
              {timeline.length ? (
                <EventTimeline events={timeline} now={now} emptyLabel="No events recorded." />
              ) : (
                <EventTimeline
                  events={journey ? [] : []}
                  now={now}
                  emptyLabel="This is a seeded historical record — its original events were archived."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Evidence"
              subtitle="Stored on this device only. Hashed for integrity, never uploaded."
              icon={<Fingerprint size={16} />}
              action={
                role === 'traveller' ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" icon={<Upload size={14} />} disabled={busy} onClick={attachDemoEvidence}>
                      Add demo note
                    </Button>
                    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-ink-900 px-3 text-[13px] font-semibold text-white hover:bg-ink-800">
                      <Upload size={14} />
                      Attach file
                      <input
                        type="file"
                        aria-label="Attach evidence file"
                        accept={EVIDENCE_MIME_TYPES.join(',')}
                        disabled={busy}
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void attachFile(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                ) : null
              }
            />
            <CardBody className="space-y-3">
              {feedback ? <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-sm text-critical-700' : 'text-sm text-safe-700'}>{feedback.message}</p> : null}
              <p className="text-[11.5px] text-ink-500">Images, PDF, text, audio and video · up to 10 MB per file.</p>
              {incident.evidence.length ? (
                <ul className="space-y-2">
                  {incident.evidence.map((item) => (
                    <li key={item.id} className="rounded-xl border border-ink-200 bg-white px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                          <FileText size={15} className="text-ink-400" />
                          {item.fileName}
                        </span>
                        {role === 'traveller' ? (
                          <button
                            type="button"
                            onClick={() => { void store.removeEvidence(item.id, incident.id).catch(reportError); }}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-critical-700 hover:underline"
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        ) : null}
                      </div>
                      {item.blobId ? <button type="button" className="mt-2 text-[12px] font-semibold text-brand-700 hover:underline"
                        onClick={async () => {
                          try {
                            const blob = await store.readEvidence(incident.id, item.id);
                            const url = URL.createObjectURL(blob);
                            urls.current.push(url);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = item.fileName;
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                          } catch (error) { reportError(error); }
                        }}>Download {item.fileName}</button> : <p className="mt-2 text-[11.5px] text-ink-500">Legacy metadata only — original file unavailable.</p>}
                      <dl className="mt-2 grid gap-1 text-[11.5px] text-ink-500 sm:grid-cols-2">
                        <div className="flex items-center gap-1.5">
                          <Hash size={11} />
                          <span className="font-mono">{shortHash(item.sha256)}</span>
                        </div>
                        <div>Added {formatClock(item.createdAt)} · {formatBytes(item.sizeBytes)}</div>
                      </dl>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-safe-700">
                        <CheckCircle2 size={12} />
                        Integrity hash generated ({item.hashMethod === 'sha256-webcrypto' ? 'SHA-256' : 'fallback digest'})
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{item.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Fingerprint size={20} />}
                  title="No evidence captured"
                  description="Evidence is optional. If you add it, a SHA-256 integrity hash is generated locally so you can later check the file has not changed."
                  className="border-0 py-6"
                />
              )}

              <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
                The integrity hash verifies that the stored file has not changed after hashing. It does not prove what
                happened.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Escalation" subtitle="Who was contacted, in order." icon={<Phone size={16} />} />
            <CardBody className="space-y-2">
              {[
                { label: 'Primary guardian', contact: primary },
                { label: 'Backup guardian', contact: backup },
              ].map(({ label, contact }) => (
                <div key={label} className="rounded-xl border border-ink-200 px-3.5 py-2.5">
                  <p className="sr-label">{label}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink-800">{contact?.name ?? 'Not configured'}</p>
                  {contact ? (
                    <p className="text-[11.5px] text-ink-500">
                      {contact.relationship} · {contact.notifyBy.join(' + ')}
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="rounded-xl border border-critical-200 bg-critical-50 px-3.5 py-3">
                <p className="sr-label text-critical-700">Emergency workflow</p>
                <p className="mt-0.5 text-[13px] font-semibold text-critical-900">
                  {incident.handoff.localEmergencyNumberLabel}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-critical-800">
                  {incident.handoff.note} In this prototype no call is placed. Set your local emergency number in Profile
                  so it is one tap away.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Position at creation" icon={<MapPin size={16} />} />
            <CardBody className="space-y-2 text-[12.5px] text-ink-600">
              <p className="font-semibold text-ink-800">{incident.locationLabel}</p>
              <p>
                {journey
                  ? `Live position at incident time: ${describePosition(journey, now)}.`
                  : 'This historical record has no live position attached.'}
              </p>
              <p className="text-[11.5px] text-ink-500">
                Coordinates are simulated and fictional. No live location is visible to anyone outside your trusted
                circle.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Actions" icon={<ShieldCheck size={16} />} />
            <CardBody className="space-y-2">
              {role === 'guardian' && incident.status !== 'RESOLVED' ? (
                <Button
                  block
                  variant="primary"
                  icon={<CheckCircle2 size={16} />}
                  onClick={() => {
                    const alert = store.getState().alerts.find((a) => a.incidentId === incident.id && !a.acknowledgedAt);
                    if (alert) store.acknowledgeAlert(alert.id);
                    else store.pushToast({ title: 'Already acknowledged', tone: 'brand' });
                  }}
                >
                  ACKNOWLEDGE
                </Button>
              ) : null}
              {role === 'traveller' ? (
                <>
                  <Button block variant="safe" icon={<CheckCircle2 size={16} />} onClick={() => store.confirmSafe('incident')}>
                    I&apos;m safe now
                  </Button>
                  <Button block variant="outline" icon={<CheckCircle2 size={16} />} onClick={() => store.resolveIncident(incident.id)}>
                    Mark resolved
                  </Button>
                </>
              ) : null}
              <Button block variant="outline" icon={<Phone size={16} />} onClick={() => store.toggleUi('sosPanelOpen', true)}>
                Emergency handoff
              </Button>
              {role === 'traveller' ? (
                <Button block variant="ghost" className="text-critical-700" onClick={() => setPrivacyOpen(true)}>
                  Privacy &amp; delete controls
                </Button>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        title="Privacy and deletion"
        description="You decide how long this record exists."
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                store.deleteIncident(incident.id);
                setPrivacyOpen(false);
                window.history.back();
              }}
            >
              Delete incident
            </Button>
            <Button variant="ghost" onClick={() => setPrivacyOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-[13px] leading-relaxed text-ink-600">
          <li>• This incident, its timeline and its evidence are stored on this device only.</li>
          <li>• Deleting removes the record, the evidence files, metadata and its timeline events.</li>
          <li>• Your guardian keeps a copy only of what was already delivered to them outside SURAKSHA.</li>
          <li>• Retention is configurable in Profile → Privacy (currently 30 days by default).</li>
        </ul>
      </Modal>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold leading-snug text-ink-800">{value}</dd>
    </div>
  );
}
