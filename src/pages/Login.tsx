/**
 * Login — the signed-out gateway for SURAKSHA.
 *
 * The rescue SOS button in the shell leads here when no one is signed in, so
 * this page carries the whole first impression: the brand, the promise, and a
 * Supabase-backed sign-in (email + OTP, or Google/GitHub), with a graceful,
 * clearly-labelled local fallback so the demo works with zero configuration.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CloudOff,
  Compass,
  Eye,
  EyeOff,
  HeartHandshake,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  Route,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { useAuth, authStore as importedAuthStore } from '@/store/authStore';
import { isSupabaseConfigured, supabaseConfigReadout } from '@/services/supabase';
import { resolveAuthState } from '@/services/auth';
import { BrandLogo } from '@/components/brand/BrandLogo';

const authStore = importedAuthStore;

export function Login() {
  const navigate = useNavigate();
  const { user, signedIn } = useAuth();

  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState<'none' | 'email' | 'google' | 'github'>('none');
  const [error, setError] = useState<string | null>(null);

  // Connect card state
  const [connectOpen, setConnectOpen] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(supabaseConfigReadout().url);
  const [supabaseAnon, setSupabaseAnon] = useState('');
  const [showAnon, setShowAnon] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const configured = isSupabaseConfigured() || resolveAuthState().config.configured;

  // Redirect once signed in (e.g. after the OTP round-trip).
  useEffect(() => {
    if (signedIn) {
      const target = (window.location.hash.match(/#\/traveller/) ? '/traveller' : '') || '/traveller';
      navigate(target, { replace: true });
    }
  }, [signedIn, navigate]);

  // Supabase OTP redirect lands on a hash like #access_token=…&type=recovery.
  useEffect(() => {
    const hash = window.location.hash || '';
    if (hash.includes('access_token=') || hash.includes('type=recovery')) {
      void authStore.completeMagicLink();
    }
  }, []);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address to receive your sign-in link.');
      return;
    }
    setBusy('email');
    try {
      const status = await authStore.signIn(email.trim());
      if (status === 'supabase') setEmailSent(true);
      if (status === 'error') setError('Could not send the sign-in link. Is the Supabase project reachable?');
    } finally {
      setBusy('none');
    }
  };

  const social = async (provider: 'google' | 'github') => {
    setError(null);
    setBusy(provider);
    try {
      const status = await authStore.socialSignIn(provider);
      if (status === 'error') setError('Could not reach the identity provider. Try email instead.');
    } finally {
      setBusy('none');
    }
  };

  const saveConnect = () => {
    setConnectMsg(null);
    const url = supabaseUrl.trim().replace(/\/+$/, '');
    const anon = supabaseAnon.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(url)) {
      setConnectMsg('That does not look like a Supabase project URL (https://xxxx.supabase.co).');
      return;
    }
    if (!anon) {
      setConnectMsg('Paste the anon/public key from your project settings.');
      return;
    }
    authStore.saveConfig({
      ...resolveAuthState().config,
      url,
      anonKey: anon,
      configured: true,
      checkExplicit: true,
      statusMessage: 'Project linked — email OTP is now routed through Supabase.',
    });
    setConnectMsg('Project linked. Email sign-in will now run through Supabase Auth.');
    setConnectOpen(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 text-white">
      {/* Ambient background */}
      <Background />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        {/* Brand panel */}
        <section className="order-2 lg:order-1">
          <BrandLogo size="xl" variant="full" invert className="gap-3" />

          <h1 className="mt-8 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
            Help starts moving
            <br />
            <span className="bg-gradient-to-r from-brand-300 via-sky-300 to-safe-300 bg-clip-text text-transparent">
              before anyone has to call.
            </span>
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-300">
            SURAKSHA watches the journey with you — it checks in, notices route and time anomalies, offers
            a discreet way out, and escalates to the people you trust. A tool, not a promise.
          </p>

          <div className="mt-8 grid max-w-md gap-3 sm:grid-cols-2">
            {[
              { icon: <Waypoints size={16} />, title: 'Live journey watch', body: 'Corridor, route tabs and a live ETA.' },
              { icon: <BellRing size={16} />, title: 'Smart check-ins', body: 'Custom intervals, hits a trusted circle.' },
              { icon: <HeartHandshake size={16} />, title: 'Trusted circle', body: 'Primary + backup, escalation chain.' },
              { icon: <Route size={16} />, title: 'Maps-grade routing', body: 'Modes, traffic, avoid & times.' },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/20 text-brand-300">{f.icon}</span>
                <p className="mt-3 text-[13.5px] font-semibold">{f.title}</p>
                <p className="mt-1 text-[12px] leading-snug text-ink-300">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-[11.5px] text-ink-400">
            <span className="inline-flex items-center gap-1.5"><BadgeCheck size={14} className="text-safe-400" /> No AI judges you</span>
            <span className="inline-flex items-center gap-1.5"><LockKeyhole size={14} className="text-safe-400" /> Evidence hashed on-device</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-safe-400" /> Location shared only as agreed</span>
          </div>
        </section>

        {/* Sign-in card */}
        <section className="order-1 lg:order-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-9">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Welcome back</h2>
                <p className="mt-1 text-[13px] text-ink-300">
                  {user && !signedIn ? `A code went to ${user.email ?? 'your email'}.` : 'Sign in to start a journey.'}
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                <Compass size={18} className="text-brand-300" />
              </span>
            </div>

            <form onSubmit={submitEmail} className="mt-6 space-y-3">
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-300">
                Email address
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 px-3.5 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/20">
                <Mail size={16} className="shrink-0 text-ink-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="h-12 w-full bg-transparent text-sm text-white placeholder:text-ink-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={busy !== 'none'}
                className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-bold text-white transition-all hover:bg-brand-400 disabled:opacity-60"
              >
                {busy === 'email' ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <span className="relative grid place-items-center">
                    <Sparkles size={17} />
                  </span>
                )}
                {emailSent ? 'Link sent — check your inbox' : 'Continue with email'}
                {busy !== 'email' ? <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /> : null}
              </button>

              <p className="text-center text-[11.5px] leading-relaxed text-ink-400">
                We'll email you a magic link{configured ? ' via Supabase' : ''}. No password to remember.
                {!configured ? ' Demo mode signs you in instantly on this device.' : ''}
              </p>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">or continue with</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SocialButton label="Google" busy={busy === 'google'} onClick={() => social('google')}>
                <GoogleGlyph />
              </SocialButton>
              <SocialButton label="GitHub" busy={busy === 'github'} onClick={() => social('github')}>
                <GitHubGlyph />
              </SocialButton>
            </div>

            {error ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-critical-500/30 bg-critical-500/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-critical-200">
                <CloudOff size={15} className="mt-0.5 shrink-0" />
                {error}
              </p>
            ) : null}

            {emailSent ? (
              <div className="mt-4 rounded-xl border border-safe-500/30 bg-safe-500/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-safe-200">
                <p className="flex items-center gap-2 font-semibold">
                  <Mail size={14} /> Magic link sent to {email}
                </p>
                <p className="mt-1 text-[12px] text-safe-200/80">
                  Open the email and tap the link — this tab will finish the sign-in automatically.
                </p>
              </div>
            ) : null}

            {/* Connect Supabase */}
            <div className="mt-6 border-t border-white/10 pt-5">
              <button
                type="button"
                onClick={() => setConnectOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-300 hover:text-brand-200"
              >
                <KeyRound size={14} />
                {configured ? 'Supabase project linked' : 'Connect your Supabase project'}
                <span className="text-ink-500">{connectOpen ? '−' : '+'}</span>
              </button>
              <p className="mt-1 text-[11.5px] text-ink-400">
                {configured
                  ? `Linked to ${supabaseConfigReadout().url || 'a Supabase project'}. Sign-in runs through Supabase Auth.`
                  : 'Optional — without it, the demo keeps accounts on this device only.'}
              </p>

              {connectOpen ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-ink-900/50 p-4">
                  <label className="block text-[12px] font-semibold text-ink-200">Project URL</label>
                  <input
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                    placeholder="https://your-project.supabase.co"
                    className="h-11 w-full rounded-xl border border-white/10 bg-ink-950/60 px-3.5 text-sm text-white placeholder:text-ink-600 focus:border-brand-400 focus:outline-none"
                  />
                  <label className="block text-[12px] font-semibold text-ink-200">Anon / public key</label>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3.5 focus-within:border-brand-400">
                    <input
                      type={showAnon ? 'text' : 'password'}
                      value={supabaseAnon}
                      onChange={(e) => setSupabaseAnon(e.target.value)}
                      placeholder="eyJhbGciOi…"
                      className="h-11 w-full bg-transparent text-sm text-white placeholder:text-ink-600 focus:outline-none"
                    />
                    <button type="button" onClick={() => setShowAnon((v) => !v)} className="text-ink-400 hover:text-ink-200">
                      {showAnon ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-500">
                    Keys stay in this browser tab only. Use the <strong>anon/public</strong> key, never the
                    service_role secret.
                  </p>
                  <button
                    type="button"
                    onClick={saveConnect}
                    className="h-11 w-full rounded-xl bg-white/10 text-sm font-bold text-white transition-all hover:bg-white/15"
                  >
                    Link project
                  </button>
                  {connectMsg ? <p className="text-[12px] leading-relaxed text-brand-300">{connectMsg}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Background() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0">
        {/* Aurora blobs */}
        <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full bg-brand-600/30 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[420px] w-[420px] rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[380px] w-[380px] rounded-full bg-safe-500/15 blur-[120px]" />
        {/* Fine grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
      </div>
    </>
  );
}

function SocialButton({
  children,
  label,
  busy,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-white transition-all hover:bg-white/10 disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : children}
      {label}
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M12 5.04c1.7 0 3.22.58 4.42 1.73l3.29-3.29C17.63 1.36 15.03.25 12 .25 7.41.25 3.44 2.9 1.68 6.74l3.85 2.99C6.34 6.89 8.93 5.04 12 5.04z" />
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.28 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z" />
      <path fill="#FBBC05" d="M5.53 14.28a7.1 7.1 0 0 1 0-4.56L1.68 6.74a11.98 11.98 0 0 0 0 10.52l3.85-2.98z" />
      <path fill="#34A853" d="M12 23.75c3.04 0 5.6-1 7.46-2.73l-3.86-2.98c-1.06.71-2.42 1.13-3.6 1.13-3.07 0-5.66-1.85-6.47-4.47l-3.85 2.99c1.76 3.84 5.73 6.06 10.32 6.06z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
