import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  BellRing,
  CloudOff,
  Database,
  HardDrive,
  Info,
  LogOut,
  Map as MapIcon,
  Moon,
  Palette,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sun,
  Trash2,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import type { SafetyRules, UserProfile } from '@suraksha/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Disclaimer, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { useSession } from '@/hooks/useSession';
import { useTheme } from '@/hooks/useTheme';
import { useOnline } from '@/hooks/useConnectivity';
import { APP_VERSION, BUILD_TIME, DEFAULT_EMERGENCY_PROFILE, DEFAULT_SAFETY_RULES, DISCLAIMERS, SUPPORT_EMAIL } from '@/lib/constants';
import { appEnv, integrationSummary } from '@/lib/env';
import { clearTileCache, requestServiceWorkerTileClear, tileCacheStats } from '@/services/tiles';
import { offlineReadiness, precacheShell } from '@/services/offline';
import { syncNow, syncStatus } from '@/services/sync';
import { createDemoData, clearDemoData } from '@/services/demo';
import { clearNotifications } from '@/services/notifications';
import { db, storageEstimate } from '@/lib/db';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { formatDuration } from '@/lib/format';
import { toast } from 'sonner';

/**
 * Settings.
 *
 * One principle runs through this screen: whatever the app can do, the user can
 * inspect and change. Safety rules that shape escalation are plain numbers with
 * their consequence spelled out, the permissions actually detected by the
 * browser are shown rather than assumed, and the storage panel tells you exactly
 * how much of your trip is available without a signal.
 */
export function SettingsScreen({ user }: { user: UserProfile }) {
  const { update, signOut } = useSession();
  const theme = useTheme();
  const { usable } = useOnline();

  const [form, setForm] = useState(() => ({
    fullName: user.fullName,
    phone: user.phone ?? '',
    email: user.email ?? '',
    language: (user as { language?: string }).language ?? 'en',
    emergency: { ...DEFAULT_EMERGENCY_PROFILE, ...(user.emergency ?? {}) },
  }));
  const [rules, setRules] = useState<SafetyRules>(() => ({ ...DEFAULT_SAFETY_RULES, ...(user.rules ?? {}) }));
  const [saving, setSaving] = useState(false);
  const [precaching, setPrecaching] = useState(false);

  const readiness = useLiveQuery(async () => offlineReadiness(user.id), [user.id], undefined);
  const tiles = useLiveQuery(async () => tileCacheStats(), [], undefined);
  const sync = useLiveQuery(async () => syncStatus(user.id), [user.id], undefined);
  const storage = useLiveQuery(async () => storageEstimate(), [], undefined);
  const counts = useLiveQuery(
    async () => ({
      journeys: await db.journeys.where('ownerId').equals(user.id).count(),
      reports: await db.reports.where('ownerId').equals(user.id).count(),
      events: await db.events.where('ownerId').equals(user.id).count(),
      locations: await db.locations.where('ownerId').equals(user.id).count(),
    }),
    [user.id],
    undefined,
  );

  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRefreshTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    await update({
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      emergency: { ...form.emergency, updatedAt: new Date().toISOString() },
    });
    setSaving(false);
    toast.success('Profile saved on this device.');
  };

  const saveRules = async (next: SafetyRules) => {
    setRules(next);
    await update({ rules: next });
  };

  return (
    <div className="space-y-4 pb-8">
      <SectionHeader title="Settings" description="Your profile, your rules, your data — all stored on this device." />

      {/* ---------------------------------------------------------------- account */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="size-4 text-teal-500" aria-hidden />
            Traveller profile
          </CardTitle>
          <CardDescription>
            {appEnv.supabaseConfigured
              ? 'Synced to your Supabase account when a connection is available.'
              : 'Device-only account: the profile lives in this browser and never leaves it.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="set-name" required>
              <Input id="set-name" value={form.fullName} onChange={(event) => setForm((p) => ({ ...p, fullName: event.target.value }))} />
            </Field>
            <Field label="Phone (used in SMS handoffs)" htmlFor="set-phone">
              <Input id="set-phone" value={form.phone} onChange={(event) => setForm((p) => ({ ...p, phone: event.target.value }))} inputMode="tel" />
            </Field>
            <Field label="Email" htmlFor="set-email" hint="Only used for account recovery and, if configured, Supabase sign-in.">
              <Input id="set-email" type="email" value={form.email} onChange={(event) => setForm((p) => ({ ...p, email: event.target.value }))} />
            </Field>
            <Field label="Language" htmlFor="set-language">
              <Select
                id="set-language"
                value={form.language}
                onChange={(event) => setForm((p) => ({ ...p, language: event.target.value }))}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'hi', label: 'हिन्दी (Hindi)' },
                  { value: 'ta', label: 'தமிழ் (Tamil)' },
                  { value: 'es', label: 'Español' },
                ]}
              />
            </Field>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Role <Badge variant="muted">{user.role}</Badge> · member since {formatDateTime(user.createdAt)} ·{' '}
            {user.deviceOnly ? 'device-only account' : 'Supabase account'}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" loading={saving} onClick={() => void saveProfile()}>
              Save profile
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/app/contacts">Manage trusted contacts</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- emergency profile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4 text-red-500" aria-hidden />
            Emergency profile
          </CardTitle>
          <CardDescription>
            Shown to you at the moment of an SOS so it can be read out to a dispatcher, and included in alerts you
            send to guardians. Never transmitted anywhere without your action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Local emergency number" htmlFor="set-emergency-number" hint="Prefilled with 112 — change it for your country.">
              <Input
                id="set-emergency-number"
                value={form.emergency.emergencyNumber}
                onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, emergencyNumber: event.target.value } }))}
                inputMode="tel"
              />
            </Field>
            <Field label="Blood group" htmlFor="set-blood">
              <Input id="set-blood" value={form.emergency.bloodGroup} onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, bloodGroup: event.target.value } }))} />
            </Field>
            <Field label="Allergies" htmlFor="set-allergies">
              <Input id="set-allergies" value={form.emergency.allergies} onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, allergies: event.target.value } }))} />
            </Field>
            <Field label="Local emergency contact" htmlFor="set-local-contact" hint="A hotel, host or colleague near your destination.">
              <Input
                id="set-local-contact"
                value={form.emergency.localEmergencyContact}
                onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, localEmergencyContact: event.target.value } }))}
              />
            </Field>
          </div>
          <Field label="Medical notes" htmlFor="set-medical">
            <Textarea
              id="set-medical"
              value={form.emergency.medicalNotes}
              onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, medicalNotes: event.target.value } }))}
              className="min-h-[70px]"
            />
          </Field>
          <Field label="Accommodation / vehicle" htmlFor="set-accommodation">
            <Input
              id="set-accommodation"
              value={form.emergency.accommodation}
              onChange={(event) => setForm((p) => ({ ...p, emergency: { ...p.emergency, accommodation: event.target.value } }))}
            />
          </Field>
          <Button variant="outline" loading={saving} onClick={() => void saveProfile()}>
            Save emergency profile
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- appearance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-4 text-teal-500" aria-hidden />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {([
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Smartphone },
            ] as const).map((option) => (
              <Button
                key={option.value}
                variant={theme.mode === option.value ? 'accent' : 'outline'}
                size="sm"
                onClick={() => theme.setMode(option.value)}
              >
                <option.icon className="size-3.5" />
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Currently showing the {theme.resolved} theme.</p>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ safety rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Sliders className="size-4 text-teal-500" aria-hidden />
            Safety rules
          </CardTitle>
          <CardDescription>
            These numbers drive the on-device risk rules. Prototype weights: a missed checkpoint adds{' '}
            {rules.missedCheckpointWeight}, a contextual deviation {rules.deviationContextWeight}, a manual SOS{' '}
            {rules.manualSosWeight}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberRule
              id="rule-grace"
              label="Check-in grace period"
              unit="minutes"
              hint="How long after a missed checkpoint (or a deviation) the discreet check-in appears."
              value={rules.checkInGraceMinutes}
              min={1}
              max={120}
              onChange={(value) => void saveRules({ ...rules, checkInGraceMinutes: value })}
            />
            <NumberRule
              id="rule-deviation"
              label="Route deviation tolerance"
              unit="metres"
              hint="Distance from the planned corridor before a deviation is recorded at all."
              value={rules.deviationThresholdMeters}
              min={50}
              max={5000}
              step={50}
              onChange={(value) => void saveRules({ ...rules, deviationThresholdMeters: value })}
            />
            <NumberRule
              id="rule-delay"
              label="Delay threshold"
              unit="minutes"
              hint="Behind the expected progression by this much before delay counts as a signal."
              value={rules.delayThresholdMinutes}
              min={5}
              max={180}
              step={5}
              onChange={(value) => void saveRules({ ...rules, delayThresholdMinutes: value })}
            />
            <NumberRule
              id="rule-interval"
              label="Monitoring interval"
              unit="seconds"
              hint="How often the device re-evaluates the journey. Shorter uses more battery."
              value={rules.monitoringIntervalSeconds}
              min={15}
              max={300}
              step={15}
              onChange={(value) => void saveRules({ ...rules, monitoringIntervalSeconds: value })}
            />
            <NumberRule
              id="rule-escalate"
              label="Signals before contacting guardians"
              unit="signals"
              hint="Escalation needs at least this many distinct signals. 1 is not allowed: one missed checkpoint must never alert anyone."
              value={rules.autoEscalateMinSignals}
              min={2}
              max={6}
              onChange={(value) => void saveRules({ ...rules, autoEscalateMinSignals: value })}
            />
            <NumberRule
              id="rule-night-start"
              label="Unusual hours start"
              unit="hour (0–23)"
              hint="Deviations between this hour and the end hour count as contextual."
              value={rules.nightTimeStartHour}
              min={0}
              max={23}
              onChange={(value) => void saveRules({ ...rules, nightTimeStartHour: value })}
            />
          </div>

          <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3">
            <ToggleRow
              id="rule-silent-sos"
              label="Discreet SOS by default"
              hint="SOS screen opens without sound or a visible alert on the device."
              checked={rules.silentSos}
              onChange={(checked) => void saveRules({ ...rules, silentSos: checked })}
            />
            <ToggleRow
              id="rule-auto-notify"
              label="Notify trusted contacts during an SOS"
              hint="Contacts with alert permission are contacted as soon as SOS is triggered."
              checked={rules.sosAutoNotifyContacts}
              onChange={(checked) => void saveRules({ ...rules, sosAutoNotifyContacts: checked })}
            />
            <ToggleRow
              id="rule-share-guardians"
              label="Share live location with guardian links"
              hint="Turn off to share route progress without position updates."
              checked={rules.shareLocationWithGuardians}
              onChange={(checked) => void saveRules({ ...rules, shareLocationWithGuardians: checked })}
            />
            <ToggleRow
              id="rule-vibrate"
              label="Vibrate for check-ins and escalations"
              checked={rules.vibrationAlerts}
              onChange={(checked) => void saveRules({ ...rules, vibrationAlerts: checked })}
            />
            <ToggleRow
              id="rule-sound"
              label="Sound alerts"
              hint="Off by default so the app stays discreet in public."
              checked={rules.soundAlerts}
              onChange={(checked) => void saveRules({ ...rules, soundAlerts: checked })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void saveRules({ ...DEFAULT_SAFETY_RULES })}>
              Reset to defaults
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/journeys/new">Use these rules on a journey</Link>
            </Button>
          </div>

          <InfoNote tone="warning" title="What a single missed checkpoint does">
            <p>
              With the defaults, one missed checkpoint adds {rules.missedCheckpointWeight} to the indicator and opens a
              discreet safety check-in. Nobody is contacted. If you confirm you are safe, the indicator is cleared; if
              you do not answer, more signals accumulate before any contact is attempted.
            </p>
          </InfoNote>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- offline kit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-4 text-teal-500" aria-hidden />
            Offline readiness
          </CardTitle>
          <CardDescription>What is already stored on this device if you lose signal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatusTile
              label="App shell"
              value={readiness?.readiness.shell ? 'cached' : 'not cached'}
              tone={readiness?.readiness.shell ? 'ok' : 'warn'}
              hint="Service worker"
            />
            <StatusTile
              label="Trusted contacts"
              value={readiness?.readiness.contacts ? 'stored' : 'none'}
              tone={readiness?.readiness.contacts ? 'ok' : 'bad'}
              hint="Nobody can be alerted without one"
            />
            <StatusTile
              label="Map tiles"
              value={tiles ? String(tiles.tiles) : '—'}
              tone={readiness?.readiness.tiles ? 'ok' : 'warn'}
              hint={tiles ? formatBytes(tiles.bytes) : 'corridor downloads'}
            />
            <StatusTile
              label="Persistent storage"
              value={readiness?.readiness.storage ? 'granted' : 'best effort'}
              tone={readiness?.readiness.storage ? 'ok' : 'warn'}
              hint="Browsers may evict best-effort data"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">{readiness?.readiness.note}</p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={precaching}
              onClick={async () => {
                setPrecaching(true);
                const result = await precacheShell(12_000);
                setPrecaching(false);
                toast.message(result.message);
                setRefreshTick((value) => value + 1);
              }}
            >
              Cache the app shell now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const cleared = await clearTileCache();
                const told = await requestServiceWorkerTileClear();
                toast.message(
                  `Cleared ${cleared} cached tile(s) from the page store${told ? ' and asked the service worker to clear its cache' : ''}.`,
                );
              }}
            >
              Clear cached map tiles
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/app/journeys/new">Download a journey corridor</Link>
            </Button>
          </div>

          <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
            <p>
              Storage used: <strong>{storage?.usageBytes !== undefined ? formatBytes(storage.usageBytes) : '—'}</strong>
              {storage?.quotaBytes ? ` of about ${formatBytes(storage.quotaBytes)} available` : ''}
            </p>
            <p>
              Journey data: <strong>{counts?.journeys ?? 0}</strong> journeys · <strong>{counts?.locations ?? 0}</strong>{' '}
              track points
            </p>
            <p>
              Reports: <strong>{counts?.reports ?? 0}</strong> · events: <strong>{counts?.events ?? 0}</strong>
            </p>
          </div>

          <Disclaimer>{DISCLAIMERS.offlineTiles}</Disclaimer>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ sync */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            {usable ? <Activity className="size-4 text-emerald-500" aria-hidden /> : <CloudOff className="size-4 text-amber-500" aria-hidden />}
            Sync and connectivity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatusTile label="Connection" value={usable ? 'usable' : 'queued locally'} tone={usable ? 'ok' : 'warn'} />
            <StatusTile label="Waiting to send" value={String(sync?.pending ?? 0)} tone={(sync?.pending ?? 0) ? 'warn' : 'ok'} />
            <StatusTile
              label="Failed"
              value={String(sync?.failed ?? 0)}
              tone={(sync?.failed ?? 0) ? 'bad' : 'ok'}
              hint="Retried with backoff"
            />
            <StatusTile label="Last sync" value={sync?.lastSyncAt ? formatRelative(sync.lastSyncAt) : 'never'} />
          </div>
          <p className="text-[11px] text-muted-foreground">{sync?.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const result = await syncNow(user.id);
                toast.message(result.message);
                setRefreshTick((value) => value + 1);
              }}
            >
              Sync now
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/app/report">See queued reports</Link>
            </Button>
          </div>
          {refreshTick >= 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Status refreshes automatically every 30 seconds. Server: {appEnv.apiBaseUrl}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- permissions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-teal-500" aria-hidden />
            Permissions
          </CardTitle>
          <CardDescription>What this browser has actually granted, checked live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PermissionRow
            name="Location"
            state={
              typeof navigator !== 'undefined' && 'permissions' in navigator ? 'checked on the Home screen' : 'unsupported'
            }
            explanation="Location is required for tracking, deviations and SOS coordinates. Denying it is handled gracefully: you can still record journeys and file reports manually."
          />
          <PermissionRow
            name="Notifications"
            state={'Notification' in window ? Notification.permission : 'unsupported'}
            explanation="Used for check-in and escalation alerts when the app is backgrounded. The in-app inbox always works."
          />
          <PermissionRow
            name="Persistent storage"
            state={readiness?.readiness.storage ? 'granted' : 'prompt'}
            explanation="Keeps journey data and cached tiles from being evicted by the browser."
          />
          <PermissionRow
            name="Wake lock"
            state={'wakeLock' in navigator ? 'available' : 'unsupported'}
            explanation="Keeps the screen awake while monitoring if the battery allows."
          />
          <PermissionRow
            name="Vibration"
            state={'vibrate' in navigator ? 'available' : 'unsupported'}
            explanation="Used for discreet check-in nudges when sound is off."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).catch(() => undefined)}>
              Re-check location permission
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!('Notification' in window)) {
                  toast.error('This browser has no notification support.');
                  return;
                }
                const result = await Notification.requestPermission();
                toast.message(`Notification permission: ${result}.`);
              }}
            >
              Request notifications
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- integrations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-teal-500" aria-hidden />
            External services
          </CardTitle>
          <CardDescription>
            SURAKSHA runs fully offline. These integrations are optional and configured through environment variables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <ul className="space-y-2">
            {integrationSummary().map((integration) => (
              <li key={integration.name} className="rounded-xl border border-border bg-muted/20 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{integration.name}</span>
                  <Badge variant={integration.configured ? 'success' : 'warning'} className="ml-auto">
                    {integration.configured ? 'configured' : 'not configured'}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{integration.note}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Support: <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- demo mode */}
      {appEnv.enableDemoMode ? (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Info className="size-4 text-sky-500" aria-hidden />
              Demonstration mode
            </CardTitle>
            <CardDescription>
              Creates clearly-labelled sample journeys, contacts and reports so the app can be explored without
              travelling. Everything created here carries a “demo” tag and can be removed in one action.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const created = await createDemoData(user.id);
                toast.success(`Created ${created.journeys} demo journey(s) and ${created.contacts} demo contact(s).`);
              }}
            >
              Create demo data
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-destructive">
                  Remove demo data
                </Button>
              }
              title="Remove all demonstration data?"
              description="Only records tagged as demo are deleted. Your real journeys, reports and contacts are untouched."
              confirmLabel="Remove demo data"
              onConfirm={async () => {
                await clearDemoData(user.id);
                toast.success('Demonstration data removed.');
              }}
            />
            <p className="w-full text-[11px] text-muted-foreground">
              Demo records are always marked and are never counted as real incidents or sent to the reporting server.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------- data */}
      <Card className="border-destructive/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" aria-hidden />
            Your data
          </CardTitle>
          <CardDescription>Everything is on this device and under your control.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/app/history">Export history as JSON</Link>
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-destructive">
                  Clear notifications
                </Button>
              }
              title="Clear the notification inbox?"
              description="The in-app inbox is emptied on this device."
              confirmLabel="Clear"
              onConfirm={async () => {
                await clearNotifications(user.id);
                toast.success('Inbox cleared.');
              }}
            />
          </div>

          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive">
                <Trash2 className="size-3.5" />
                Delete all local data
              </Button>
            }
            title="Delete all SURAKSHA data on this device?"
            description={
              'This removes journeys, track points, events, reports, notifications and cached tiles from this browser. ' +
              'Reports already acknowledged by the server keep their server copy. This cannot be undone.'
            }
            confirmLabel="Delete everything"
            onConfirm={async () => {
              await db.transaction(
                'rw',
                [db.journeys, db.events, db.locations, db.reports, db.notifications, db.checkIns, db.mapPacks, db.outbox, db.shares, db.riskSnapshots],
                async () => {
                  await db.locations.clear();
                  await db.events.clear();
                  await db.checkIns.clear();
                  await db.mapPacks.clear();
                  await db.outbox.clear();
                  await db.shares.clear();
                  await db.riskSnapshots.clear();
                  await db.reports.clear();
                  await db.notifications.clear();
                  await db.journeys.clear();
                },
              );
              await clearTileCache();
              await requestServiceWorkerTileClear();
              toast.success('Local data deleted. Trusted contacts and your profile were kept — remove them individually.');
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" asChild>
              <Link to="/app/contacts">
                <UserIcon className="size-3.5" />
                Manage contacts
              </Link>
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/app/journeys">
                <MapIcon className="size-3.5" />
                Manage journeys
              </Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await signOut();
                toast.success('Signed out on this device.');
              }}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------- about */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-4 text-teal-500" aria-hidden />
            About SURAKSHA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Version {APP_VERSION} · built {formatDateTime(BUILD_TIME)} · uptime on this screen:{' '}
            {formatDuration(refreshTick / 2)}
          </p>
          <p>
            SURAKSHA is an offline-first personal safety companion. It keeps a journey timeline on your device, raises
            an indicator when signals accumulate, checks in with you discreetly, and — only when you or the rules
            genuinely require it — contacts the people you trust.
          </p>
          <Disclaimer>{DISCLAIMERS.monitoring}</Disclaimer>
          <Disclaimer>{DISCLAIMERS.riskHeuristic}</Disclaimer>
          <Disclaimer>{DISCLAIMERS.noRescueGuarantee}</Disclaimer>
        </CardContent>
      </Card>
    </div>
  );
}

function NumberRule({
  id,
  label,
  unit,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={`${label} (${unit})`} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className="w-24"
        />
        <input
          type="range"
          aria-label={`${label} slider`}
          className="h-1.5 flex-1 accent-teal-500"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </Field>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 text-xs">
        <span className="font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function PermissionRow({
  name,
  state,
  explanation,
}: {
  name: string;
  state: string;
  explanation: string;
}) {
  const tone =
    state === 'granted' || state === 'available'
      ? 'success'
      : state === 'denied' || state === 'unsupported'
        ? 'danger'
        : 'warning';
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">{name}</span>
        <Badge variant={tone} className="ml-auto">
          {state}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{explanation}</p>
    </div>
  );
}

export default SettingsScreen;
