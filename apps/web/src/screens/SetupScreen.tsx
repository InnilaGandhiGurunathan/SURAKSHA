import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Download,
  HardDrive,
  MapPin,
  Phone,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import type { EmergencyProfile, SafetyRules, TrustedContact, UserProfile } from '@suraksha/shared';
import { Shield as ShieldMark } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Input, Textarea } from '@/components/ui/field';
import { Progress, Switch } from '@/components/ui/misc';
import { InfoNote } from '@/components/StatusPieces';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { useSession } from '@/hooks/useSession';
import { db, requestPersistentStorage, storageEstimate, type StorageEstimate } from '@/lib/db';
import { DEFAULT_EMERGENCY_PROFILE, DEFAULT_SAFETY_RULES, DISCLAIMERS } from '@/lib/constants';
import { formatBytes } from '@/lib/format';
import { snapshotPermissions, type PermissionSnapshot } from '@/lib/permissions';
import { createContact, listContacts, validateContactInput } from '@/services/contacts';
import { downloadOfflineBundle, isSetupComplete, markSetupStep, offlineReadiness } from '@/services/offline';
import { requestWakeLock, releaseWakeLock } from '@/services/location';
import { notificationSupport, requestNotificationPermission } from '@/services/notifications';
import { appEnv, integrationSummary } from '@/lib/env';
import { recordEvent } from '@/services/events';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * First-run setup.
 *
 * This is the one place the brief allows the internet to be genuinely required.
 * It is therefore ordered so the essentials (rules, contacts, emergency profile)
 * are done locally, and the only network-dependent step — downloading the map
 * corridor — is optional, explained, and resumable.
 */
const STEPS = [
  { id: 'account', label: 'Your details', icon: Shield },
  { id: 'permissions', label: 'Permissions', icon: BellRing },
  { id: 'contacts', label: 'Trusted contacts', icon: Users },
  { id: 'emergency', label: 'Emergency', icon: Phone },
  { id: 'rules', label: 'Safety rules', icon: SlidersHorizontal },
  { id: 'offline', label: 'Offline data', icon: Download },
  { id: 'done', label: 'Ready', icon: CheckCircle2 },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function SetupScreen() {
  const navigate = useNavigate();
  const { user, update } = useSession();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const [permissions, setPermissions] = useState<PermissionSnapshot | undefined>();
  const [storage, setStorage] = useState<StorageEstimate | undefined>();

  const [contact, setContact] = useState({ name: '', relationship: '', phone: '', email: '' });
  const [contacts, setContacts] = useState<TrustedContact[]>([]);

  const [emergency, setEmergency] = useState<EmergencyProfile>(DEFAULT_EMERGENCY_PROFILE);
  const [rules, setRules] = useState<SafetyRules>(DEFAULT_SAFETY_RULES);

  const [offlineSteps, setOfflineSteps] = useState<Array<{ id: string; label: string; status: string; detail: string }>>([]);
  const [offlineRunning, setOfflineRunning] = useState(false);
  const [readiness, setReadiness] = useState<string | undefined>();

  const step = STEPS[stepIndex];
  const stepId = step.id as StepId;

  useEffect(() => {
    void (async () => {
      if (user) {
        setEmergency(user.emergency);
        setRules({ ...DEFAULT_SAFETY_RULES, ...(user.rules ?? {}) });
        setContacts(await listContacts(user.id));
      }
      setPermissions(await snapshotPermissions());
      setStorage(await storageEstimate());
    })();
  }, [user?.id]);

  const stepComplete = useMemo(() => {
    switch (stepId) {
      case 'account':
        return true;
      case 'contacts':
        return contacts.length > 0;
      case 'permissions':
        return Boolean(permissions);
      case 'emergency':
        return Boolean(emergency.emergencyNumber);
      case 'rules':
        return true;
      case 'offline':
        return offlineSteps.some((entry) => entry.id === 'tiles' && entry.status === 'done');
      default:
        return true;
    }
  }, [stepId, contacts.length, permissions, emergency.emergencyNumber, offlineSteps]);

  const advance = async () => {
    setError(undefined);
    if (!user) return;

    try {
      if (stepId === 'account') {
        await markSetupStep('account', 'Profile confirmed.');
      }
      if (stepId === 'permissions') {
        await markSetupStep('permissions', 'Permissions reviewed.');
      }
      if (stepId === 'contacts') {
        if (contacts.length === 0) {
          setError('Add at least one trusted contact — otherwise nobody can be told when something goes wrong.');
          return;
        }
        await markSetupStep('contacts', `${contacts.length} contact(s).`);
      }
      if (stepId === 'emergency') {
        await update({ emergency: { ...emergency, updatedAt: new Date().toISOString() } });
        await markSetupStep('emergency', `Emergency number ${emergency.emergencyNumber}.`);
      }
      if (stepId === 'rules') {
        await update({ rules });
        await markSetupStep('rules', 'Safety rules saved.');
      }
      if (stepId === 'offline') {
        const { readiness: state } = await offlineReadinessSafe(user.id);
        if (state) setReadiness(state.note);
      }

      setStepIndex((value) => Math.min(STEPS.length - 1, value + 1));
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const finish = async () => {
    if (!user) return;
    await markSetupStep('complete', 'Setup finished.', true);
    if (rules.vibrationAlerts) {
      // A small confirmation the user can actually feel.
      try {
        navigator.vibrate?.([80, 40, 80]);
      } catch {
        /* ignore */
      }
    }
    await recordEvent({
      ownerId: user.id,
      type: 'offline_ready',
      message: 'First-time setup finished. SURAKSHA now opens and works without a connection.',
    });
    toast.success('Setup complete. SURAKSHA works offline from here.');
    navigate('/app', { replace: true });
  };

  const addContact = async () => {
    if (!user) return;
    const validation = validateContactInput(contact);
    if (!validation.ok) {
      setError(Object.values(validation.errors)[0]);
      return;
    }
    setError(undefined);
    await createContact({
      ownerId: user.id,
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email || undefined,
    });
    setContacts(await listContacts(user.id));
    setContact({ name: '', relationship: '', phone: '', email: '' });
    toast.success('Trusted contact added on this device.');
  };

  const enableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPermissions(await snapshotPermissions());
    toast.message(result.message);
  };

  const secureStorage = async () => {
    const persisted = await requestPersistentStorage();
    setStorage(await storageEstimate());
    toast.message(
      persisted
        ? 'The browser will keep SURAKSHA data instead of evicting it.'
        : 'Persistent storage was not granted. Keep the app installed and some free space available.',
    );
  };

  const runOfflineDownload = async () => {
    if (!user) return;
    setOfflineRunning(true);
    setOfflineSteps([{ id: 'start', label: 'Preparing', status: 'running', detail: 'Reading your journeys.' }]);

    const journeys = await db.journeys.where('ownerId').equals(user.id).toArray();
    const planned = journeys
      .filter((journey) => journey.status === 'planned' || journey.status === 'active')
      .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime())[0];

    if (!planned) {
      // Nothing to draw a corridor around yet: cache the shell only and say so.
      const { readiness: state } = await offlineReadinessSafe(user.id);
      setOfflineSteps((prev) => [
        ...prev.filter((entry) => entry.id !== 'start'),
        { id: 'shell', label: 'App shell', status: 'done', detail: 'Cached for offline use.' },
        {
          id: 'tiles',
          label: 'Map corridor',
          status: 'failed',
          detail: 'No upcoming journey yet, so there is no corridor to download. Prepare it later from the journey screen.',
        },
      ]);
      setReadiness(state?.note);
      await markSetupStep('offline_bundle', 'Shell cached; map corridor pending a journey.', false);
      setOfflineRunning(false);
      return;
    }

    const result = await downloadOfflineBundle({
      ownerId: user.id,
      journeyId: planned.id,
      label: `${planned.originLabel} → ${planned.destinationLabel}`,
      origin: planned.origin,
      destination: planned.destination,
      paddingPoints: planned.checkpoints.map((checkpoint) => checkpoint.location),
      radiusKm: 3.5,
      onStep: (entry) =>
        setOfflineSteps((prev) => {
          const others = prev.filter((item) => item.id !== entry.id);
          return [...others, entry];
        }),
    });

    setOfflineSteps((prev) => [
      ...prev,
      {
        id: 'result',
        label: 'Offline bundle',
        status: result.ok ? 'done' : 'failed',
        detail: result.messages.join(' '),
      },
    ]);

    const { readiness: state } = await offlineReadinessSafe(user.id);
    setReadiness(state?.note);
    setOfflineRunning(false);
    toast.message(result.ok ? 'Offline bundle ready.' : 'Offline bundle partly ready — see the details.');
  };

  if (!user) return null;

  return (
    <div className="app-shell min-h-dvh pb-10">
      <header className="shell px-4 pt-6">
        <div className="flex items-center gap-2.5">
          <ShieldMark className="size-9" />
          <div>
            <p className="text-sm font-bold tracking-[0.18em]">SURAKSHA SETUP</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-teal-600 dark:text-teal-300">
              Internet needed for this once
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} label="Setup progress" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STEPS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] transition-colors',
                  index === stepIndex
                    ? 'bg-accent text-accent-foreground'
                    : index < stepIndex
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {index + 1}. {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="shell mt-5 space-y-4 px-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <step.icon className="size-4 text-teal-500" aria-hidden />
              {step.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormError message={error} />

            {stepId === 'account' ? (
              <div className="space-y-3 text-sm">
                <p>
                  Signed in as <strong>{user.fullName}</strong>
                  {user.email ? ` (${user.email})` : ''} · role {user.role}.
                </p>
                <InfoNote tone="info" title="What happens in setup">
                  <p>
                    Setup prepares the offline bundle: your safety rules, your trusted contacts and the map
                    corridor for your next journey. After this, SURAKSHA opens and runs without a connection.
                  </p>
                </InfoNote>
                <InfoNote tone="muted" title="Integrations on this deployment">
                  <ul className="space-y-1">
                    {integrationSummary().map((item) => (
                      <li key={item.name}>
                        <strong>{item.name}</strong>{' '}
                        <span className={item.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                          {item.configured ? 'configured' : 'not configured'}
                        </span>{' '}
                        — {item.note}
                      </li>
                    ))}
                  </ul>
                </InfoNote>
              </div>
            ) : null}

            {stepId === 'permissions' && permissions ? (
              <div className="space-y-3">
                <PermissionRow
                  label="Location"
                  state={permissions.geolocation}
                  detail="Needed for checkpoints, deviation checks and SOS positions. Journeys still start without it, and the app says so."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await new Promise((resolve, reject) =>
                            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12_000 }),
                          );
                          toast.success('Location permission granted.');
                        } catch {
                          toast.error('Location was not granted. You can enable it in browser settings later.');
                        }
                        setPermissions(await snapshotPermissions());
                      }}
                    >
                      Request
                    </Button>
                  }
                />
                <PermissionRow
                  label="Notifications"
                  state={permissions.notifications}
                  detail={notificationSupport().remedy}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void enableNotifications()}>
                      Enable
                    </Button>
                  }
                />
                <PermissionRow
                  label="Persistent storage"
                  state={permissions.persistentStorage}
                  detail="Asks the browser to keep your safety data instead of evicting it when space runs low."
                  action={
                    <Button size="sm" variant="outline" onClick={() => void secureStorage()}>
                      Request
                    </Button>
                  }
                />
                <PermissionRow
                  label="Screen wake lock"
                  state={permissions.wakeLock}
                  detail="Keeps the screen on while monitoring so GPS keeps updating."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const result = await requestWakeLock();
                        toast.message(result.message);
                        await releaseWakeLock();
                        setPermissions(await snapshotPermissions());
                      }}
                    >
                      Test
                    </Button>
                  }
                />
                <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <HardDrive className="size-3.5" aria-hidden />
                    Storage on this device
                  </p>
                  <p className="mt-1">
                    {storage
                      ? `${formatBytes(storage.usageBytes)} used of about ${formatBytes(storage.quotaBytes)} available${storage.persisted ? ' · marked persistent' : ''}.`
                      : 'Measuring storage…'}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Secure context: {permissions.secureContext ? 'yes' : 'no — location and encryption need HTTPS or localhost'} ·
                  service worker: {permissions.serviceWorker ? 'available' : 'unavailable'} · platform: {permissions.platform}
                </p>
              </div>
            ) : null}

            {stepId === 'contacts' ? (
              <div className="space-y-3">
                {contacts.length === 0 ? (
                  <InfoNote tone="warning" title="You need at least one trusted contact">
                    <p>A contact is only told something when you escalate — SOS, or an escalation that meets the criteria.</p>
                  </InfoNote>
                ) : (
                  <ul className="space-y-2">
                    {contacts.map((item) => (
                      <li key={item.id} className="flex items-center justify-between rounded-xl border border-border bg-card/60 p-3 text-sm">
                        <span>
                          {item.name}
                          <span className="ml-2 text-[11px] text-muted-foreground">{item.relationship}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">{item.phone}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" htmlFor="setup-contact-name" required>
                    <Input
                      id="setup-contact-name"
                      value={contact.name}
                      onChange={(event) => setContact((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Priya (sister)"
                    />
                  </Field>
                  <Field label="Relationship" htmlFor="setup-contact-rel">
                    <Input
                      id="setup-contact-rel"
                      value={contact.relationship}
                      onChange={(event) => setContact((prev) => ({ ...prev, relationship: event.target.value }))}
                      placeholder="Sister"
                    />
                  </Field>
                  <Field label="Phone" htmlFor="setup-contact-phone" required hint="Include the country code.">
                    <Input
                      id="setup-contact-phone"
                      value={contact.phone}
                      onChange={(event) => setContact((prev) => ({ ...prev, phone: event.target.value }))}
                      inputMode="tel"
                      placeholder="+91 90000 00000"
                    />
                  </Field>
                  <Field label="Email (optional)" htmlFor="setup-contact-email">
                    <Input
                      id="setup-contact-email"
                      value={contact.email}
                      onChange={(event) => setContact((prev) => ({ ...prev, email: event.target.value }))}
                      type="email"
                      placeholder="priya@example.com"
                    />
                  </Field>
                </div>

                <Button variant="outline" onClick={() => void addContact()}>
                  <UserPlus className="size-4" />
                  Add contact
                </Button>
              </div>
            ) : null}

            {stepId === 'emergency' ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Local emergency number" htmlFor="setup-emergency" required hint="Default 112 works in most countries; change it if yours differs.">
                    <Input
                      id="setup-emergency"
                      value={emergency.emergencyNumber}
                      onChange={(event) => setEmergency((prev) => ({ ...prev, emergencyNumber: event.target.value }))}
                      inputMode="tel"
                    />
                  </Field>
                  <Field label="Blood group" htmlFor="setup-blood">
                    <Input
                      id="setup-blood"
                      value={emergency.bloodGroup}
                      onChange={(event) => setEmergency((prev) => ({ ...prev, bloodGroup: event.target.value }))}
                      placeholder="O+"
                    />
                  </Field>
                </div>
                <Field label="Medical notes" htmlFor="setup-medical" hint="Shown to you and included in an alert you send. Never published to the community feed.">
                  <Textarea
                    id="setup-medical"
                    value={emergency.medicalNotes}
                    onChange={(event) => setEmergency((prev) => ({ ...prev, medicalNotes: event.target.value }))}
                    placeholder="Asthma — carries an inhaler in the side pocket."
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Allergies" htmlFor="setup-allergies">
                    <Input
                      id="setup-allergies"
                      value={emergency.allergies}
                      onChange={(event) => setEmergency((prev) => ({ ...prev, allergies: event.target.value }))}
                    />
                  </Field>
                  <Field label="Accommodation" htmlFor="setup-stay">
                    <Input
                      id="setup-stay"
                      value={emergency.accommodation}
                      onChange={(event) => setEmergency((prev) => ({ ...prev, accommodation: event.target.value }))}
                      placeholder="Hotel name and area"
                    />
                  </Field>
                </div>
                <Field label="Local emergency contact (optional)" htmlFor="setup-local">
                  <Input
                    id="setup-local"
                    value={emergency.localEmergencyContact}
                    onChange={(event) => setEmergency((prev) => ({ ...prev, localEmergencyContact: event.target.value }))}
                    placeholder="Local host or colleague"
                  />
                </Field>
                <InfoNote tone="muted">
                  <p>{DISCLAIMERS.emergencyDial}</p>
                </InfoNote>
              </div>
            ) : null}

            {stepId === 'rules' ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Prototype weights. Change them freely — the app is transparent about the fact that these are
                  heuristics, and the risk panel always shows which rule fired.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberRule
                    label="Missed checkpoint"
                    value={rules.missedCheckpointWeight}
                    onChange={(value) => setRules((prev) => ({ ...prev, missedCheckpointWeight: value }))}
                    hint="Never alerts anyone on its own."
                  />
                  <NumberRule
                    label="Deviation (contextual)"
                    value={rules.deviationContextWeight}
                    onChange={(value) => setRules((prev) => ({ ...prev, deviationContextWeight: value }))}
                    hint="Deviation at night or with a big delay."
                  />
                  <NumberRule
                    label="Manual SOS"
                    value={rules.manualSosWeight}
                    onChange={(value) => setRules((prev) => ({ ...prev, manualSosWeight: value }))}
                    hint="Opens the emergency workflow immediately."
                  />
                  <NumberRule
                    label="Check-in window (minutes)"
                    value={rules.checkInGraceMinutes}
                    onChange={(value) => setRules((prev) => ({ ...prev, checkInGraceMinutes: value }))}
                    hint="How long you have to answer."
                  />
                </div>

                <div className="space-y-2">
                  <ToggleRow
                    label="Silent SOS by default"
                    description="Pressing SOS does not vibrate or play a sound, for situations where attention is dangerous."
                    checked={rules.silentSos}
                    onChange={(value) => setRules((prev) => ({ ...prev, silentSos: value }))}
                  />
                  <ToggleRow
                    label="Vibrate for escalations"
                    description="A short buzz when a check-in is offered or escalation happens."
                    checked={rules.vibrationAlerts}
                    onChange={(value) => setRules((prev) => ({ ...prev, vibrationAlerts: value }))}
                  />
                  <ToggleRow
                    label="Let selected contacts see my location"
                    description="Guardian links include the last known position when this is on. Revocable at any time."
                    checked={rules.shareLocationWithGuardians}
                    onChange={(value) => setRules((prev) => ({ ...prev, shareLocationWithGuardians: value }))}
                  />
                </div>
                <InfoNote tone="warning" title="Escalation rule">
                  <p>
                    A single missed checkpoint can never trigger an emergency. Escalation needs{' '}
                    {rules.autoEscalateMinSignals} independent signals, an SOS, or an answer of “not safe”.
                  </p>
                </InfoNote>
              </div>
            ) : null}

            {stepId === 'offline' ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This caches the app shell, your safety rules, your contacts and the map corridor for your next
                  journey. It is the only part of setup that uses the network, and it can be repeated later.
                </p>

                <Button variant="accent" full loading={offlineRunning} onClick={() => void runOfflineDownload()}>
                  <Download className="size-4" />
                  Prepare offline bundle
                </Button>

                {offlineSteps.length > 0 ? (
                  <ul className="space-y-1.5">
                    {offlineSteps.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2 rounded-xl border border-border bg-card/60 p-2.5">
                        <span
                          className={cn(
                            'mt-1 size-2 shrink-0 rounded-full',
                            entry.status === 'done' ? 'bg-emerald-500' : entry.status === 'failed' ? 'bg-amber-500' : 'bg-sky-500 animate-pulse',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 text-[11px] leading-relaxed">
                          <strong className="block text-xs">{entry.label}</strong>
                          {entry.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {readiness ? <InfoNote tone="info" title="Readiness">{readiness}</InfoNote> : null}

                <InfoNote tone="muted">
                  <p>
                    Tiles come from {appEnv.tileUrlTemplate.includes('openstreetmap') ? 'the public OpenStreetMap server' : 'the configured tile host'}.
                    Attribution: {appEnv.tileAttribution}.
                  </p>
                </InfoNote>
              </div>
            ) : null}

            {stepId === 'done' ? (
              <div className="space-y-3">
                <p className="text-sm">
                  You are set up. SURAKSHA now opens, remembers your data and keeps monitoring without a
                  connection.
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden />
                    {contacts.length} trusted contact(s) stored on this device
                  </li>
                  <li className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-emerald-500" aria-hidden />
                    Emergency number {emergency.emergencyNumber || '112'}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Download className="size-3.5 text-emerald-500" aria-hidden />
                    Offline steps completed: {offlineSteps.filter((entry) => entry.status === 'done').map((entry) => entry.label).join(', ') || 'shell only'}
                  </li>
                </ul>
                <InfoNote tone="warning" title="Before you rely on it">
                  <p>{DISCLAIMERS.noRescueGuarantee}</p>
                  <p className="mt-1">{DISCLAIMERS.monitoring}</p>
                </InfoNote>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="ghost"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>

              {stepId === 'done' ? (
                <Button variant="accent" onClick={() => void finish()}>
                  Finish setup
                  <CheckCircle2 className="size-4" />
                </Button>
              ) : (
                <Button variant="accent" onClick={() => void advance()} disabled={!stepComplete && stepId === 'contacts'}>
                  Continue
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={async () => {
            const done = await isSetupComplete();
            if (done) navigate('/app', { replace: true });
            else toast.message('Finish the steps above so SURAKSHA is ready to work offline.');
          }}
        >
          I will finish setup later
        </Button>
      </main>
    </div>
  );
}

function PermissionRow({
  label,
  state,
  detail,
  action,
}: {
  label: string;
  state: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const tone =
    state === 'granted' ? 'text-emerald-600 dark:text-emerald-400' : state === 'denied' || state === 'unsupported' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/60 p-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {label} <span className={cn('font-normal', tone)}>· {state}</span>
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function NumberRule({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={`rule-${label}`} hint={hint}>
      <Input
        id={`rule-${label}`}
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/60 p-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

async function offlineReadinessSafe(ownerId: string) {
  const { offlineReadiness } = await import('@/services/offline');
  return offlineReadiness(ownerId);
}

export default SetupScreen;
