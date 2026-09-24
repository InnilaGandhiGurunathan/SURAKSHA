/** Guardian view of the trusted contacts + escalation chain. */

import { ArrowDown, Bell, Phone, ShieldAlert, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, Chip, Toggle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

export function GuardianContacts() {
  const { contacts, guardianProfile, receipts, now } = useAppState();
  const primary = contacts.find((c) => c.slots.includes('primary'));
  const backup = contacts.find((c) => c.slots.includes('backup'));
  const others = contacts.filter((c) => !c.slots.includes('primary') && !c.slots.includes('backup'));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · People"
        title="Trusted Contacts"
        description="Who is in the circle, who gets told what, and the order in which SURAKSHA reaches out. Only the traveller can change these contacts."
        actions={<Chip tone="neutral"><Users size={12} /> {contacts.length} contacts</Chip>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Circle members" subtitle="Availability is set by the traveller." icon={<Users size={16} />} />
            <CardBody className="space-y-2">
              {contacts.map((contact) => (
                <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink-900">{contact.name}</p>
                      {contact.slots.includes('primary') ? <Chip tone="brand">Primary</Chip> : null}
                      {contact.slots.includes('backup') ? <Chip tone="neutral">Backup</Chip> : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-500">{contact.relationship}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={contact.available ? 'safe' : 'watch'}>{contact.available ? 'Available' : 'Unavailable'}</Chip>
                      {contact.notifyBy.map((channel) => (
                        <Chip key={channel} tone="neutral">
                          <Bell size={11} /> {channel}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-700">
                    <Phone size={14} className="text-ink-400" />
                    {contact.phone}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Escalation chain" subtitle="The traveller's configured order." icon={<ArrowDown size={16} />} />
            <CardBody className="space-y-0">
              {[
                { step: 1, name: primary?.name ?? 'Not set', detail: primary?.relationship ?? 'Set by the traveller', tone: 'brand' as const },
                { step: 2, name: backup?.name ?? 'Not set', detail: backup?.relationship ?? 'Set by the traveller', tone: 'neutral' as const },
                { step: 3, name: 'Emergency workflow', detail: 'Local emergency service — called by the traveller, never by SURAKSHA', tone: 'critical' as const },
              ].map((row, index, all) => (
                <div key={row.step}>
                  <div
                    className={cn(
                      'flex items-start gap-3 rounded-xl border px-3.5 py-3',
                      row.tone === 'brand'
                        ? 'border-brand-200 bg-brand-50'
                        : row.tone === 'critical'
                          ? 'border-critical-200 bg-critical-50'
                          : 'border-ink-200 bg-white',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white',
                        row.tone === 'brand' ? 'bg-brand-600' : row.tone === 'critical' ? 'bg-critical-600' : 'bg-ink-500',
                      )}
                    >
                      {row.step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink-900">{row.name}</p>
                      <p className="text-[12px] text-ink-600">{row.detail}</p>
                    </div>
                  </div>
                  {index < all.length - 1 ? (
                    <div className="flex justify-center py-1">
                      <ArrowDown size={15} className="text-ink-300" />
                    </div>
                  ) : null}
                </div>
              ))}
            </CardBody>
          </Card>

          {others.length ? (
            <Card>
              <CardHeader title="Other escalation contacts" subtitle="Institutions the traveller added." />
              <CardBody className="space-y-2">
                {others.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-ink-800">{contact.name}</p>
                      <p className="text-[11.5px] text-ink-500">{contact.relationship}</p>
                    </div>
                    <span className="text-[12.5px] font-semibold text-ink-700">{contact.phone}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Your notification preferences" subtitle="How SURAKSHA reaches this guardian account." icon={<Bell size={16} />} />
            <CardBody className="divide-y divide-ink-200">
              <Toggle
                checked={guardianProfile.riskNotifications}
                onChange={(next) => store.updateGuardianProfile({ riskNotifications: next })}
                label="Risk state changes"
                description="Watch, Alert and Critical transitions, plus incidents."
              />
              <Toggle
                checked={guardianProfile.shareLiveLocation}
                onChange={(next) => store.updateGuardianProfile({ shareLiveLocation: next })}
                label="Show live location on the map"
                description="Simulated GPS. Turn off to see only the event timeline."
              />
              <Toggle
                checked={guardianProfile.demoMode}
                onChange={(next) => store.setDemoMode(next)}
                label="Demo mode"
                description="Shows the demo controls and the seeded scenario."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery log" subtitle="What was actually sent to whom." icon={<Bell size={16} />} />
            <CardBody className="space-y-2">
              {receipts.length ? (
                receipts.slice(0, 10).map((receipt) => (
                  <div key={receipt.id} className="rounded-xl border border-ink-200 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[12.5px] font-semibold text-ink-800">{receipt.title}</p>
                      <Chip tone={receipt.status === 'delivered' ? 'safe' : 'watch'}>{receipt.status}</Chip>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-500">
                      {receipt.contactName} · {receipt.channel} · {formatRelative(receipt.at, now)}
                    </p>
                    {receipt.reason ? <p className="mt-0.5 text-[11px] text-watch-700">{receipt.reason}</p> : null}
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-[12.5px] text-ink-500">
                  Nothing has been delivered yet.
                </p>
              )}
            </CardBody>
          </Card>

          <Card tone="watch" className="bg-watch-50">
            <CardBody className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-watch-700">
                <ShieldAlert size={16} />
              </span>
              <div>
                <p className="text-[13px] font-bold text-watch-900">Agree what an alert means</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-watch-900/80">
                  “Safety check-in missed” means nobody answered a routine prompt. Decide together what you do first — usually
                  a normal phone call, not an escalation.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
