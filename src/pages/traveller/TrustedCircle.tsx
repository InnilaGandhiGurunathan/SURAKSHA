/** Trusted Circle — contacts, roles, and the escalation chain. */

import { useState } from 'react';
import {
  ArrowDown,
  Bell,
  Pencil,
  Phone,
  Plus,
  ShieldAlert,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Field,
  Input,
  Modal,
  Toggle,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import type { TrustedContact } from '@/domain/types';
import { cn } from '@/lib/cn';

const NOTIFY_OPTIONS: Array<{ key: TrustedContact['notifyBy'][number]; label: string }> = [
  { key: 'push', label: 'Push' },
  { key: 'sms', label: 'SMS' },
  { key: 'call', label: 'Automated call' },
];

export function TrustedCircle() {
  const { contacts, travellerProfile } = useAppState();
  const [editing, setEditing] = useState<TrustedContact | null>(null);
  const [creating, setCreating] = useState(false);

  const primary = contacts.find((c) => c.slots.includes('primary')) ?? null;
  const backup = contacts.find((c) => c.slots.includes('backup')) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · People you trust"
        title="Trusted Circle"
        description="Two people who will actually pick up, and a clear order for escalation. SURAKSHA notifies these contacts — it never contacts emergency services for you."
        actions={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Add contact
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ContactCard slot="primary" contact={primary} onEdit={setEditing} />
            <ContactCard slot="backup" contact={backup} onEdit={setEditing} />
          </div>

          <Card>
            <CardHeader
              title="All contacts"
              subtitle="Everyone SURAKSHA can notify, and how."
              icon={<UserRound size={16} />}
            />
            <CardBody className="space-y-2">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink-900">{contact.name}</p>
                      {contact.slots.includes('primary') ? <Chip tone="brand">Primary</Chip> : null}
                      {contact.slots.includes('backup') ? <Chip tone="neutral">Backup</Chip> : null}
                      {contact.slots.length === 0 ? <Chip tone="neutral">Escalation only</Chip> : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-500">
                      {contact.relationship} · {contact.phone}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={contact.available ? 'safe' : 'watch'}>
                        {contact.available ? 'Available' : 'Marked unavailable'}
                      </Chip>
                      {contact.notifyBy.map((channel) => (
                        <Chip key={channel} tone="neutral">
                          <Bell size={11} />
                          {channel}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(contact)}>
                      Edit
                    </Button>
                    {!contact.slots.includes('primary') ? (
                      <Button size="sm" variant="ghost" icon={<Star size={14} />} onClick={() => store.setContactSlot(contact.id, 'primary')}>
                        Primary
                      </Button>
                    ) : null}
                    {!contact.slots.includes('backup') ? (
                      <Button size="sm" variant="ghost" onClick={() => store.setContactSlot(contact.id, 'backup')}>
                        Backup
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-critical-700 hover:bg-critical-50"
                      icon={<Trash2 size={14} />}
                      onClick={() => store.removeContact(contact.id)}
                      aria-label={`Remove ${contact.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {contacts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-[13px] text-ink-500">
                  No trusted contacts yet. Add one so escalation has somewhere to go.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Who sees what" subtitle="Notifications stay inside your circle." icon={<Phone size={16} />} />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-600">
              <p>
                Guardians receive: journey start and end, check-in misses, route deviations, Watch/Alert/Critical state
                changes, and incidents — each with the detail level you chose below.
              </p>
              <p>
                Guardians never receive: your full location history after a journey ends, your learning progress, or
                community reports you filed.
              </p>
              <Toggle
                checked={travellerProfile.shareLiveLocation}
                onChange={(next) => store.updateTravellerProfile({ shareLiveLocation: next })}
                label="Share live location while a journey is running"
                description="Turn off to share location only when an incident is created."
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Escalation order" subtitle="How SURAKSHA reaches out, in order." icon={<ArrowDown size={16} />} />
            <CardBody className="space-y-0">
              {[
                { step: 1, title: 'Primary guardian', detail: primary?.name ?? 'Not set', tone: 'brand' as const, meta: primary ? `${primary.relationship} · ${primary.notifyBy.join(' + ')}` : 'Set a primary contact' },
                { step: 2, title: 'Backup guardian', detail: backup?.name ?? 'Not set', tone: 'neutral' as const, meta: backup ? `${backup.relationship} · ${backup.notifyBy.join(' + ')}` : 'Set a backup contact' },
                { step: 3, title: 'Emergency workflow', detail: 'You + your local emergency number', tone: 'critical' as const, meta: 'SURAKSHA shows the number; you make the call' },
              ].map((row, index, all) => (
                <div key={row.step}>
                  <div className={cn('flex items-start gap-3 rounded-xl border px-3.5 py-3', row.tone === 'brand' ? 'border-brand-200 bg-brand-50' : row.tone === 'critical' ? 'border-critical-200 bg-critical-50' : 'border-ink-200 bg-white')}>
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white', row.tone === 'brand' ? 'bg-brand-600' : row.tone === 'critical' ? 'bg-critical-600' : 'bg-ink-500')}>
                      {row.step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink-900">{row.title}</p>
                      <p className="truncate text-[12.5px] font-medium text-ink-700">{row.detail}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-500">{row.meta}</p>
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

          <Card tone="watch" className="bg-watch-50">
            <CardBody className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-watch-700">
                <ShieldAlert size={16} />
              </span>
              <div>
                <p className="text-[13px] font-bold text-watch-900">Agree the meaning of an alert</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-watch-900/80">
                  Tell your guardian what a missed check-in actually means to you (“flat battery”, “no signal on the metro”)
                  and what you want them to do first. A shared threshold prevents both over- and under-reacting.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <ContactDialog
        open={creating || Boolean(editing)}
        contact={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ContactCard({
  slot,
  contact,
  onEdit,
}: {
  slot: 'primary' | 'backup';
  contact: TrustedContact | null;
  onEdit: (contact: TrustedContact) => void;
}) {
  return (
    <Card tone={slot === 'primary' ? 'brand' : undefined} className={slot === 'primary' ? 'bg-brand-50' : ''}>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="sr-label">{slot} contact</span>
          <Chip tone={contact?.available ? 'safe' : 'watch'}>{contact ? (contact.available ? 'Available' : 'Unavailable') : 'Missing'}</Chip>
        </div>
        {contact ? (
          <>
            <div>
              <p className="text-[17px] font-bold text-ink-900">{contact.name}</p>
              <p className="text-[12.5px] text-ink-600">{contact.relationship}</p>
            </div>
            <dl className="space-y-1 text-[12.5px] text-ink-600">
              <div className="flex justify-between gap-2">
                <dt className="font-medium text-ink-500">Phone</dt>
                <dd className="font-semibold text-ink-800">{contact.phone}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-medium text-ink-500">Notify by</dt>
                <dd className="font-semibold text-ink-800">{contact.notifyBy.join(' + ')}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" icon={<Pencil size={14} />} onClick={() => onEdit(contact)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => store.clearContactSlot(slot)}
                className="text-ink-500"
              >
                Clear slot
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-500">
            No {slot} contact set. Escalation will skip straight to the next step.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ContactDialog({
  open,
  contact,
  onClose,
}: {
  open: boolean;
  contact: TrustedContact | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [notifyBy, setNotifyBy] = useState<TrustedContact['notifyBy']>(contact?.notifyBy ?? ['push']);
  const [available, setAvailable] = useState(contact?.available ?? true);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a different contact is opened.
  const key = contact?.id ?? 'new';
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setName(contact?.name ?? '');
    setRelationship(contact?.relationship ?? '');
    setPhone(contact?.phone ?? '');
    setNotifyBy(contact?.notifyBy ?? ['push']);
    setAvailable(contact?.available ?? true);
    setError(null);
  }

  const submit = () => {
    if (!name.trim()) return setError('Add a name.');
    if (!phone.trim()) return setError('Add a phone number.');
    if (!notifyBy.length) return setError('Choose at least one notification channel.');
    if (contact) {
      store.updateContact(contact.id, { name: name.trim(), relationship: relationship.trim(), phone: phone.trim(), notifyBy, available });
      store.pushToast({ title: 'Contact updated', description: `${name.trim()} saved.`, tone: 'brand' });
    } else {
      store.addContact({ name: name.trim(), relationship: relationship.trim() || 'Trusted contact', phone: phone.trim(), notifyBy, slots: [], available });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? `Edit ${contact.name}` : 'Add a trusted contact'}
      description="Use fictional details for the demo. SURAKSHA stores this on your device only."
      footer={
        <>
          <Button onClick={submit}>{contact ? 'Save changes' : 'Add contact'}</Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name">
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rohan Mehta" />
          </Field>
          <Field label="Relationship" htmlFor="c-rel">
            <Input id="c-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Friend · Guardian" />
          </Field>
        </div>
        <Field label="Phone" htmlFor="c-phone" hint="Simulated in this prototype — nothing is dialled.">
          <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" inputMode="tel" />
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-800">How should we reach them?</p>
          <div className="flex flex-wrap gap-2">
            {NOTIFY_OPTIONS.map((option) => {
              const active = notifyBy.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setNotifyBy((current) =>
                      active ? current.filter((c) => c !== option.key) : [...current, option.key],
                    )
                  }
                  className={cn(
                    'rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-state',
                    active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <Toggle checked={available} onChange={setAvailable} label="Currently available" description="Unavailable contacts still get queued messages." />
        {error ? <p className="text-[12.5px] font-semibold text-critical-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
