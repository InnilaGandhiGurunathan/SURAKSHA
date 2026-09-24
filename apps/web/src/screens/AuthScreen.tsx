import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, HardDrive, Info, KeyRound, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import type { UserRole } from '@suraksha/shared';
import { Shield } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Input, Select } from '@/components/ui/field';
import { InfoNote } from '@/components/StatusPieces';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import {
  AuthError,
  registerWithDevice,
  registerWithSupabase,
  signInWithDevice,
  signInWithSupabase,
} from '@/services/auth';
import { supabaseStatus } from '@/services/supabase';
import { isSetupComplete } from '@/services/offline';
import { useSession } from '@/hooks/useSession';
import { recordEvent } from '@/services/events';
import { toast } from 'sonner';

/**
 * Authentication.
 *
 * The default path is a **device account**, because the brief is explicit that
 * the internet is needed for first-time setup only — and a traveller may well be
 * setting up on a train. A Supabase account is offered alongside it for people who
 * want cross-device sync, and the difference is stated in the UI rather than
 * hidden behind a single "sign in" button.
 */
export function AuthScreen() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [mode, setMode] = useState<'signin' | 'register'>('register');
  const [store, setStore] = useState<'device' | 'supabase'>(
    supabaseStatus().configured && navigator.onLine ? 'supabase' : 'device',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'traveller' as UserRole,
  });
  const [consent, setConsent] = useState({ location: false, share: false });

  const supabase = supabaseStatus();

  const next = async (userId: string) => {
    await recordEvent({
      ownerId: userId,
      type: 'session_started',
      message: `Signed in on this device (${store === 'device' ? 'device account' : 'SURAKSHA account'}).`,
    });
    const ready = await isSetupComplete();
    navigate(ready ? '/app' : '/setup', { replace: true });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setBusy(true);

    try {
      if (mode === 'register') {
        if (form.fullName.trim().length < 2) throw new Error('Enter your name so contacts know who the alert is about.');
        if (!consent.location || !consent.share) {
          throw new Error(
            'Both consent boxes are needed: location sharing for journeys, and letting selected contacts see those journeys.',
          );
        }

        if (store === 'supabase') {
          const result = await registerWithSupabase({
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
            password: form.password,
            role: form.role,
          });
          await refresh();
          if (result.needsEmailConfirmation) {
            setNotice(
              'Your SURAKSHA account was created. Check your email to confirm it — until then you can keep using the app offline on this device.',
            );
            if (navigator.onLine) toast.message('Confirm your email when you can; nothing else is blocked.');
          }
          await next(result.user.id);
        } else {
          const result = await registerWithDevice({
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
            password: form.password,
            role: form.role,
          });
          await refresh();
          toast.success('Device account created. It works with no internet.');
          await next(result.user.id);
        }
      } else {
        if (store === 'supabase') {
          const result = await signInWithSupabase(form.email, form.password);
          await refresh();
          await next(result.user.id);
        } else {
          const result = await signInWithDevice(form.email, form.password);
          await refresh();
          await next(result.user.id);
        }
        toast.success('Signed in.');
      }
    } catch (caught) {
      const message =
        caught instanceof AuthError
          ? caught.message
          : (caught as Error)?.message ?? 'That did not work. Check your details and try again.';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center">
          <Shield animated className="size-16" />
          <h1 className="mt-4 text-xl font-bold tracking-[0.24em]">SURAKSHA</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
            Your Safety, Our Priority
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>{mode === 'register' ? 'Create your account' : 'Welcome back'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <TabsList>
                <TabsTrigger value="register">
                  <UserPlus className="mr-1.5 size-3.5" aria-hidden />
                  Register
                </TabsTrigger>
                <TabsTrigger value="signin">
                  <LogIn className="mr-1.5 size-3.5" aria-hidden />
                  Sign in
                </TabsTrigger>
              </TabsList>

              <TabsContent value="register" />
              <TabsContent value="signin" />
            </Tabs>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setStore('device')}
                aria-pressed={store === 'device'}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  store === 'device' ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/40'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <HardDrive className="size-3.5" aria-hidden />
                  On this device
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                  No internet needed. Password is hashed with PBKDF2 on the device; we cannot recover it.
                </span>
              </button>

              <button
                type="button"
                disabled={!supabase.configured}
                onClick={() => setStore('supabase')}
                aria-pressed={store === 'supabase'}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  store === 'supabase' ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/40'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Cloud className="size-3.5" aria-hidden />
                  SURAKSHA account
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                  {supabase.configured
                    ? 'Syncs across devices through Supabase and enables the admin console.'
                    : 'Not available: no Supabase project is configured for this deployment.'}
                </span>
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <FormError message={error} />

              {mode === 'register' ? (
                <>
                  <Field label="Full name" htmlFor="auth-name" required>
                    <Input
                      id="auth-name"
                      value={form.fullName}
                      onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      autoComplete="name"
                      placeholder="Asha Menon"
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Phone (optional)" htmlFor="auth-phone">
                      <Input
                        id="auth-phone"
                        value={form.phone}
                        onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="+91 90000 00000"
                      />
                    </Field>
                    <Field label="Your role" htmlFor="auth-role" hint="Responder and admin unlock the dashboards.">
                      <Select
                        id="auth-role"
                        value={form.role}
                        onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))}
                        options={[
                          { value: 'traveller', label: 'Traveller' },
                          { value: 'guardian', label: 'Guardian' },
                          { value: 'responder', label: 'Responder' },
                          { value: 'admin', label: 'Administrator' },
                        ]}
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              <Field label="Email" htmlFor="auth-email" required>
                <Input
                  id="auth-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </Field>

              <Field
                label="Password"
                htmlFor="auth-password"
                required
                hint={mode === 'register' ? 'At least 8 characters. Stored only as a hash on this device.' : undefined}
              >
                <Input
                  id="auth-password"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </Field>

              {mode === 'register' ? (
                <div className="space-y-2">
                  <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={consent.location}
                      onChange={(event) => setConsent((prev) => ({ ...prev, location: event.target.checked }))}
                    />
                    <span>
                      I agree that SURAKSHA may use this device’s location during journeys I start.
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Location is read on the device and only sent when a journey is active and sharing is on.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={consent.share}
                      onChange={(event) => setConsent((prev) => ({ ...prev, share: event.target.checked }))}
                    />
                    <span>
                      I agree that the contacts I choose may see my journey and, when I allow it, my location.
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Each share is a link with permissions I pick, and I can revoke it at any time.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              <Button type="submit" variant="accent" size="lg" full loading={busy} loadingText="Please wait…">
                <KeyRound className="size-4" />
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <InfoNote tone="info" title="Why an account at all?">
          <p>
            The account is what lets your device own its safety data. Everything except cross-device sync works
            offline with a device account, and you can add a Supabase account later in Settings without losing
            anything.
          </p>
        </InfoNote>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <Link to="/onboarding" className="flex items-center gap-1.5 hover:text-foreground">
            <Info className="size-3.5" aria-hidden />
            How SURAKSHA works
          </Link>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            Data stays on your device
          </span>
        </div>
      </div>
    </div>
  );
}

export default AuthScreen;
