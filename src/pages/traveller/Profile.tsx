/**
 * Profile & settings — minimum viable personal data, explicit privacy controls.
 */

import { useState } from 'react';
import {
  BellRing,
  Database,
  FlaskConical,
  Info,
  Lock,
  MapPin,
  ShieldCheck,
  Trash2,
  UserCircle2,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ChoiceGroup,
  Field,
  Input,
  Modal,
  Select,
  Toggle,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { useAppState, useCircle, store } from '@/store/hooks';
import { CHECK_IN_OPTIONS } from '@/domain/seed';
import { formatBytes } from '@/lib/format';

export function Profile() {
  const { travellerProfile, incidents, contacts, learning, durable } = useAppState();
  const { primary } = useCircle();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [interval, setIntervalMinutes] = useState(travellerProfile.preferredCheckInMinutes);

  const evidenceCount = incidents.reduce((sum, i) => sum + i.evidence.length, 0);
  const evidenceBytes = incidents.reduce(
    (sum, i) => sum + i.evidence.reduce((inner, e) => inner + e.sizeBytes, 0),
    0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · You"
        title="Profile & settings"
        description="SURAKSHA asks for the minimum. No address, no contacts upload, no unnecessary identifiers."
        actions={
          <>
            <Chip tone={durable ? 'safe' : 'watch'}>
              <Database size={12} />
              {durable ? 'Saved on this device' : 'Session-only storage'}
            </Chip>
            <Chip tone={travellerProfile.demoMode ? 'brand' : 'neutral'}>
              <FlaskConical size={12} />
              Demo mode {travellerProfile.demoMode ? 'on' : 'off'}
            </Chip>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" subtitle="Only what the monitoring workflow needs." icon={<UserCircle2 size={16} />} />
          <CardBody className="space-y-4">
            <Field label="Name" htmlFor="p-name" hint="Used on your own records and on guardian notifications.">
              <Input
                id="p-name"
                value={travellerProfile.name}
                onChange={(e) => store.updateTravellerProfile({ name: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Age (optional)" htmlFor="p-age">
                <Input
                  id="p-age"
                  type="number"
                  min={13}
                  max={120}
                  value={travellerProfile.age ?? ''}
                  onChange={(e) =>
                    store.updateTravellerProfile({ age: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </Field>
              <Field label="Pronouns (optional)" htmlFor="p-pronouns">
                <Input
                  id="p-pronouns"
                  value={travellerProfile.pronouns ?? ''}
                  onChange={(e) => store.updateTravellerProfile({ pronouns: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Home label" htmlFor="p-home" hint="A label, not an address.">
                <Input
                  id="p-home"
                  value={travellerProfile.homeLabel}
                  onChange={(e) => store.updateTravellerProfile({ homeLabel: e.target.value })}
                />
              </Field>
              <Field label="Starting point label" htmlFor="p-campus">
                <Input
                  id="p-campus"
                  value={travellerProfile.campusLabel}
                  onChange={(e) => store.updateTravellerProfile({ campusLabel: e.target.value })}
                />
              </Field>
            </div>
            <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
              <p className="flex gap-2">
                <Info size={14} className="mt-0.5 shrink-0 text-ink-400" />
                <span>
                  Emergency preferences live with your Trusted Circle: who is contacted first, and in what order. SURAKSHA
                  stores your emergency number as a label so you can dial it yourself — it never dials for you.
                </span>
              </p>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Safety settings" subtitle="Defaults used when you start a journey." icon={<ShieldCheck size={16} />} />
            <CardBody className="space-y-4">
              <Field label="Default check-in interval">
                <ChoiceGroup
                  name="default-interval"
                  columns={3}
                  size="sm"
                  value={interval}
                  onChange={(value) => {
                    setIntervalMinutes(value);
                    store.updateTravellerProfile({ preferredCheckInMinutes: value });
                  }}
                  options={CHECK_IN_OPTIONS.map((m) => ({ value: m as number, label: `${m} min` }))}
                />
              </Field>
              <Field label="Grace period" hint="Extra time before a check-in counts as missed.">
                <ChoiceGroup
                  name="default-grace"
                  columns={3}
                  size="sm"
                  value={travellerProfile.gracePeriodMinutes}
                  onChange={(value) => store.updateTravellerProfile({ gracePeriodMinutes: value })}
                  options={[1, 2, 5].map((m) => ({ value: m, label: `${m} min` }))}
                />
              </Field>
              <Field label="Default guardian" htmlFor="p-guardian">
                <Select
                  id="p-guardian"
                  value={primary?.id ?? ''}
                  onChange={(e) => store.setContactSlot(e.target.value, 'primary')}
                >
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name} — {contact.relationship}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="divide-y divide-ink-200">
                <Toggle
                  checked={travellerProfile.riskNotifications}
                  onChange={(next) => store.updateTravellerProfile({ riskNotifications: next })}
                  label="Risk state notifications"
                  description="Tell me whenever the Safety Risk Engine changes my state."
                />
                <Toggle
                  checked={travellerProfile.evidenceCaptureEnabled}
                  onChange={(next) => store.updateTravellerProfile({ evidenceCaptureEnabled: next })}
                  label="Allow evidence capture on incidents"
                  description="Files stay on this device and are hashed locally."
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Privacy" subtitle="Location, retention and deletion." icon={<Lock size={16} />} />
            <CardBody className="space-y-4">
              <div className="divide-y divide-ink-200">
                <Toggle
                  checked={travellerProfile.shareLiveLocation}
                  onChange={(next) => store.updateTravellerProfile({ shareLiveLocation: next })}
                  label="Share live location with guardians"
                  description="Applies while a journey is active only."
                />
              </div>
              <Field label="Location sharing scope">
                <ChoiceGroup
                  name="location-scope"
                  columns={2}
                  size="sm"
                  value={travellerProfile.shareLocationScope}
                  onChange={(value) => store.updateTravellerProfile({ shareLocationScope: value })}
                  options={[
                    { value: 'guardians_only', label: 'Guardians only', hint: 'Anyone in your circle' },
                    { value: 'incident_only', label: 'Incident only', hint: 'Shared when an incident opens' },
                  ]}
                />
              </Field>
              <Field label="Data retention" hint="Applies to incident records and their evidence.">
                <ChoiceGroup
                  name="retention"
                  columns={3}
                  size="sm"
                  value={travellerProfile.dataRetentionDays}
                  onChange={(value) => store.updateTravellerProfile({ dataRetentionDays: value })}
                  options={[
                    { value: 7, label: '7 days' },
                    { value: 30, label: '30 days' },
                    { value: 90, label: '90 days' },
                  ]}
                />
              </Field>

              <dl className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] text-ink-600">
                <div>
                  <dt className="font-semibold text-ink-500">Incident records</dt>
                  <dd className="text-[14px] font-bold text-ink-900">{incidents.length}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-500">Evidence on device</dt>
                  <dd className="text-[14px] font-bold text-ink-900">
                    {evidenceCount} · {formatBytes(evidenceBytes)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-500">Lessons completed</dt>
                  <dd className="text-[14px] font-bold text-ink-900">{learning.completed.length} / 7</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-500">Trusted contacts</dt>
                  <dd className="text-[14px] font-bold text-ink-900">{contacts.length}</dd>
                </div>
              </dl>

              <Button variant="outline" className="text-critical-700" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>
                Delete incident data
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Demo mode" subtitle="Controls for live walkthroughs." icon={<FlaskConical size={16} />} />
            <CardBody className="space-y-3">
              <div className="divide-y divide-ink-200">
                <Toggle
                  checked={travellerProfile.demoMode}
                  onChange={(next) => store.setDemoMode(next)}
                  label="Demo mode"
                  description="Shows the simulation controls, seeded scenario framing and the RESET DEMO button."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => store.toggleUi('demoPanelOpen', true)}>
                  Open demo panel
                </Button>
                <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} onClick={() => store.resetDemo()}>
                  RESET DEMO
                </Button>
              </div>
              <p className="flex gap-2 text-[12px] leading-relaxed text-ink-500">
                <BellRing size={13} className="mt-0.5 shrink-0 text-ink-400" />
                Resetting clears the journey, events, alerts and incidents on this device and restores the seeded scenario.
              </p>
            </CardBody>
          </Card>

          <Card tone="neutral">
            <CardBody className="space-y-2 text-[12px] leading-relaxed text-ink-600">
              <p className="flex items-center gap-2 text-[13px] font-bold text-ink-800">
                <MapPin size={15} className="text-ink-400" />
                About the data in this prototype
              </p>
              <p>
                Every person, contact and incident in SURAKSHA is fictional. The map is a simulated surface — no real GPS
                is used, and location strings are derived from map coordinates for demonstration only.
              </p>
              <p>
                SURAKSHA does not detect assault, does not predict criminal behaviour, cannot determine that someone is in
                danger, does not replace emergency services, and never dispatches police based on a prediction.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete incident data?"
        description="This removes every incident record, its timeline and its evidence metadata from this device."
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                incidents.forEach((incident) => store.deleteIncident(incident.id));
                setConfirmDelete(false);
              }}
            >
              Yes, delete all incidents
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep my data
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-600">
          Deletion cannot be undone. Your trusted contacts keep whatever was already delivered to them outside SURAKSHA.
          Consider exporting anything you need first — this prototype keeps everything local, so nothing is backed up.
        </p>
      </Modal>
    </div>
  );
}
