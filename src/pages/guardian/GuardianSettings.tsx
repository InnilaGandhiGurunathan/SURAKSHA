/** Guardian settings — access, notifications, demo controls, data statements. */

import { useState } from 'react';
import { BellRing, Database, Eye, FlaskConical, Lock, ShieldCheck, Trash2, UserCircle2 } from 'lucide-react';
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
  Toggle,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';

export function GuardianSettings() {
  const { guardianProfile, travellerProfile, incidents, alerts, durable } = useAppState();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · Settings"
        title="Guardian settings"
        description="What this monitoring account can see, and what it can never do."
        actions={
          <Chip tone={durable ? 'safe' : 'watch'}>
            <Database size={12} /> {durable ? 'Saved on this device' : 'Session-only storage'}
          </Chip>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Guardian profile" icon={<UserCircle2 size={16} />} />
          <CardBody className="space-y-4">
            <Field label="Name" htmlFor="g-name" hint="Shown to the traveller when you acknowledge an alert.">
              <Input
                id="g-name"
                value={guardianProfile.name}
                onChange={(e) => store.updateGuardianProfile({ name: e.target.value })}
              />
            </Field>
            <Field label="How you want to be reached" hint="Notification channels for this account.">
              <ChoiceGroup
                name="guardian-channels"
                columns={2}
                size="sm"
                value={guardianProfile.shareLocationScope}
                onChange={(value) => store.updateGuardianProfile({ shareLocationScope: value })}
                options={[
                  { value: 'guardians_only', label: 'Push + SMS', hint: 'Default' },
                  { value: 'incident_only', label: 'Incident escalations only', hint: 'Quieter' },
                ]}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Monitoring preferences" icon={<BellRing size={16} />} />
          <CardBody className="divide-y divide-ink-200">
            <Toggle
              checked={guardianProfile.riskNotifications}
              onChange={(next) => store.updateGuardianProfile({ riskNotifications: next })}
              label="Risk state notifications"
              description="Watch, Alert and Critical transitions, plus new incidents."
            />
            <Toggle
              checked={guardianProfile.shareLiveLocation}
              onChange={(next) => store.updateGuardianProfile({ shareLiveLocation: next })}
              label="Live map updates"
              description="Simulated GPS positions while a journey is active."
            />
            <Toggle
              checked={travellerProfile.riskNotifications}
              onChange={(next) => store.updateTravellerProfile({ riskNotifications: next })}
              label="Traveller risk notifications"
              description="Also notify the traveller's own device when the state changes."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What you can do as a guardian" icon={<ShieldCheck size={16} />} />
          <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-600">
            <p>✅ See the journey timeline, live simulated position and risk explanation.</p>
            <p>✅ Acknowledge alerts, which is recorded on the incident.</p>
            <p>✅ Read incident records and view evidence metadata (file name, time, integrity hash).</p>
            <p>🚫 You cannot start, pause or end a journey for the traveller.</p>
            <p>🚫 You cannot change their trusted circle, settings or evidence.</p>
            <p>🚫 You cannot trigger SOS on their behalf — SURAKSHA only escalates what the traveller signals.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Demo & data" icon={<FlaskConical size={16} />} />
          <CardBody className="space-y-4">
            <div className="divide-y divide-ink-200">
              <Toggle
                checked={guardianProfile.demoMode}
                onChange={(next) => store.setDemoMode(next)}
                label="Demo mode"
                description="Shows the demo panel, the seeded scenario and the reset button."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon={<Eye size={14} />} onClick={() => store.toggleUi('demoPanelOpen', true)}>
                Open demo panel
              </Button>
              <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} onClick={() => store.resetDemo()}>
                RESET DEMO
              </Button>
              <Button size="sm" variant="ghost" className="text-critical-700" onClick={() => setConfirmClear(true)}>
                Clear demo incidents
              </Button>
            </div>
            <dl className="grid grid-cols-3 gap-3 rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] text-ink-600">
              <div>
                <dt className="font-semibold text-ink-500">Incidents</dt>
                <dd className="text-[15px] font-bold text-ink-900">{incidents.length}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-500">Alerts</dt>
                <dd className="text-[15px] font-bold text-ink-900">{alerts.length}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-500">Retention</dt>
                <dd className="text-[15px] font-bold text-ink-900">{guardianProfile.dataRetentionDays} d</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Privacy statement" icon={<Lock size={16} />} />
          <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-600">
            <p>
              Guardian access is scoped to journeys the traveller started on this device. There is no historical location
              trail after a journey ends, and community reports are never attributed to a person.
            </p>
            <p>
              Evidence files never leave the device: only a file name, timestamp and integrity hash are shown here. The
              hash verifies that a stored file has not changed after hashing — it does not prove what happened.
            </p>
            <p className="font-semibold text-ink-700">
              SURAKSHA is a coordination tool. It does not detect assault, predict behaviour, decide that anyone is in
              danger, or replace emergency services.
            </p>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear demo incidents?"
        description="Removes every incident record created in this session and its timeline."
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                incidents.forEach((incident) => store.deleteIncident(incident.id));
                setConfirmClear(false);
              }}
            >
              Clear incidents
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-600">
          Journey events stay in the log. The seeded historical records are also removed until you press RESET DEMO.
        </p>
      </Modal>
    </div>
  );
}
