import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Crown,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { TrustedContact, UserProfile } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/misc';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlay';
import { Disclaimer, EmptyState, InfoNote, SectionHeader } from '@/components/StatusPieces';
import { DISCLAIMERS } from '@/lib/constants';
import { createContact, deleteContact, listContacts, updateContact, validateContactInput } from '@/services/contacts';
import { callContact } from '@/services/call';
import { copyText, openSmsHandoff } from '@/services/sms';
import { toast } from 'sonner';

/**
 * Trusted contacts.
 *
 * Permissions are per contact and visible on the row, not buried: who receives
 * alerts, who can see journeys, who can see live location. Removing a contact
 * also revokes their guardian links, because a revoked relationship must not keep
 * a working link.
 */
export function ContactsScreen({ user }: { user: UserProfile }) {
  const contacts = useLiveQuery(async () => listContacts(user.id), [user.id], undefined);

  const [editing, setEditing] = useState<TrustedContact | undefined>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [form, setForm] = useState({
    name: '',
    relationship: '',
    phone: '',
    email: '',
    notes: '',
    canReceiveAlerts: true,
    canViewJourney: true,
    canSeeLiveLocation: false,
    isPrimary: false,
  });

  const reset = () => {
    setForm({
      name: '',
      relationship: '',
      phone: '',
      email: '',
      notes: '',
      canReceiveAlerts: true,
      canViewJourney: true,
      canSeeLiveLocation: false,
      isPrimary: (contacts ?? []).length === 0,
    });
    setError(undefined);
  };

  const startCreate = () => {
    reset();
    setEditing(undefined);
    setCreating(true);
  };

  const startEdit = (contact: TrustedContact) => {
    setForm({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email ?? '',
      notes: contact.notes ?? '',
      canReceiveAlerts: contact.canReceiveAlerts,
      canViewJourney: contact.canViewJourney,
      canSeeLiveLocation: contact.canSeeLiveLocation,
      isPrimary: contact.isPrimary,
    });
    setError(undefined);
    setEditing(contact);
    setCreating(true);
  };

  const save = async () => {
    const validation = validateContactInput(form);
    if (!validation.ok) {
      setError(Object.values(validation.errors)[0]);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await updateContact(editing.id, {
          name: form.name,
          relationship: form.relationship,
          phone: form.phone,
          email: form.email || undefined,
          notes: form.notes || undefined,
          canReceiveAlerts: form.canReceiveAlerts,
          canViewJourney: form.canViewJourney,
          canSeeLiveLocation: form.canSeeLiveLocation,
          isPrimary: form.isPrimary,
        });
        toast.success('Contact updated on this device.');
      } else {
        await createContact({
          ownerId: user.id,
          name: form.name,
          relationship: form.relationship,
          phone: form.phone,
          email: form.email || undefined,
          notes: form.notes || undefined,
          canReceiveAlerts: form.canReceiveAlerts,
          canViewJourney: form.canViewJourney,
          canSeeLiveLocation: form.canSeeLiveLocation,
          isPrimary: form.isPrimary,
        });
        toast.success('Contact added. They can be selected for a journey straight away.');
      }
      setCreating(false);
      setEditing(undefined);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="Trusted contacts"
        description="Stored on this device. Each permission is explicit and revocable."
        action={
          <Button size="sm" variant="accent" onClick={startCreate}>
            <UserPlus className="size-3.5" />
            Add
          </Button>
        }
      />

      {!contacts ? (
        <p className="text-xs text-muted-foreground">Loading contacts from this device…</p>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No trusted contacts yet"
          description="Contacts are who SURAKSHA tells when you escalate or trigger SOS. Nothing is shared with them until you choose it."
          action={
            <Button size="sm" variant="accent" onClick={startCreate}>
              Add your first contact
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Card>
                <CardContent className="space-y-2.5 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {contact.name}
                        {contact.isPrimary ? (
                          <Badge variant="accent" className="ml-2">
                            <Crown className="size-3" aria-hidden />
                            primary
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {contact.relationship} · {contact.phone}
                        {contact.email ? ` · ${contact.email}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline">priority {contact.priority}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={contact.canReceiveAlerts ? 'success' : 'muted'}>
                      {contact.canReceiveAlerts ? 'receives alerts' : 'no alerts'}
                    </Badge>
                    <Badge variant={contact.canViewJourney ? 'success' : 'muted'}>
                      {contact.canViewJourney ? 'can view journeys' : 'no journey access'}
                    </Badge>
                    <Badge variant={contact.canSeeLiveLocation ? 'warning' : 'muted'}>
                      {contact.canSeeLiveLocation ? 'live location' : 'no live location'}
                    </Badge>
                  </div>

                  {contact.notes ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{contact.notes}</p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void callContact(contact)}>
                      <Phone className="size-3.5" />
                      Call
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const result = openSmsHandoff({
                          recipients: [contact.phone],
                          body: `SURAKSHA: checking in with you. ${user.fullName}.`,
                        });
                        toast.message(result.message);
                      }}
                    >
                      <MessageSquare className="size-3.5" />
                      Message
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await copyText(`${contact.name} — ${contact.phone}`);
                        toast.message(ok ? 'Contact details copied.' : 'Could not copy on this browser.');
                      }}
                    >
                      Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(contact)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="ghost" className="text-destructive">
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      }
                      title={`Remove ${contact.name}?`}
                      description="They stop receiving alerts and any active guardian link for them is revoked immediately. This does not affect reports already delivered."
                      confirmLabel="Remove contact"
                      onConfirm={async () => {
                        await deleteContact(contact.id);
                        toast.success('Contact removed and any guardian link revoked.');
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <InfoNote tone="info" title="What guardians can see">
        <p>
          Guardian access is created per journey and per contact. The link is encrypted, expires, and can be
          revoked. {DISCLAIMERS.shareDisclaimer}
        </p>
      </InfoNote>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-teal-500" aria-hidden />
            Permissions in plain language
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">Receives alerts</strong> — they are included when SOS triggers or
            escalation criteria are met. Without this, they are never contacted automatically.
          </p>
          <p>
            <strong className="text-foreground">Can view journeys</strong> — their guardian links may include
            journey status, checkpoints and the recent event list.
          </p>
          <p>
            <strong className="text-foreground">Live location</strong> — their links include the most recent
            position from this device. Turn this off for anyone who only needs to know you arrived.
          </p>
          <Disclaimer className="pt-1">{DISCLAIMERS.noRescueGuarantee}</Disclaimer>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add a trusted contact'}</DialogTitle>
            <DialogDescription>
              Stored only on this device. Phone numbers are shared with the reporting server solely so an alert
              can be relayed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <FormError message={error} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="contact-name" required>
                <Input
                  id="contact-name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Priya"
                />
              </Field>
              <Field label="Relationship" htmlFor="contact-rel" required>
                <Input
                  id="contact-rel"
                  value={form.relationship}
                  onChange={(event) => setForm((prev) => ({ ...prev, relationship: event.target.value }))}
                  placeholder="Sister"
                />
              </Field>
              <Field label="Phone" htmlFor="contact-phone" required hint="Include the country code.">
                <Input
                  id="contact-phone"
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  inputMode="tel"
                  placeholder="+91 90000 00000"
                />
              </Field>
              <Field label="Email (optional)" htmlFor="contact-email">
                <Input
                  id="contact-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                />
              </Field>
            </div>

            <Field label="Notes (optional)" htmlFor="contact-notes" hint="Only you see these.">
              <Textarea
                id="contact-notes"
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Knows my itinerary and can ring the hotel."
                className="min-h-[72px]"
              />
            </Field>

            <ToggleLine
              label="Receives alerts"
              description="Included when SOS triggers or escalation criteria are met."
              checked={form.canReceiveAlerts}
              onChange={(value) => setForm((prev) => ({ ...prev, canReceiveAlerts: value }))}
            />
            <ToggleLine
              label="Can view journeys"
              description="Guardian links may include journey status and checkpoints."
              checked={form.canViewJourney}
              onChange={(value) => setForm((prev) => ({ ...prev, canViewJourney: value }))}
            />
            <ToggleLine
              label="Can see live location"
              description="Their links include your most recent position while a journey runs."
              checked={form.canSeeLiveLocation}
              onChange={(value) => setForm((prev) => ({ ...prev, canSeeLiveLocation: value }))}
            />
            <ToggleLine
              label="Primary contact"
              description="Shown first on the dashboard and used for quick dialling."
              checked={form.isPrimary}
              onChange={(value) => setForm((prev) => ({ ...prev, isPrimary: value }))}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="accent" loading={busy} onClick={() => void save()}>
              <Plus className="size-4" />
              {editing ? 'Save changes' : 'Add contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleLine({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/50 p-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export default ContactsScreen;
