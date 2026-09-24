/**
 * Exit Mode — a believable reason to leave.
 *
 * A simulated incoming call. No telephony, no network, no microphone: the call
 * screen is rendered locally and every surface is labelled "Simulated call".
 * Exit Mode is an escape aid, not an emergency action.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  ShieldQuestion,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/primitives';
import { useAppState, store } from '@/store/hooks';
import { formatCountdown } from '@/lib/format';
import { cn } from '@/lib/cn';

export const EXIT_CALLERS = [
  { id: 'ct-priya', label: 'Mom', kind: 'family' as const },
  { id: 'ct-rohan', label: 'Rohan Mehta', kind: 'friend' as const },
  { id: 'ct-campuss', label: 'Campus Security Desk', kind: 'security' as const },
  { id: 'generic-manager', label: 'Hostel Warden (Block C)', kind: 'generic' as const },
  { id: 'generic-delivery', label: 'Delivery Partner', kind: 'generic' as const },
];

const SCRIPT_LINES = [
  { speaker: 'Caller', text: "Hey, where are you? I'm waiting outside." },
  { speaker: 'Caller', text: 'I can see the auto at the corner — come now, it is booked.' },
  { speaker: 'Caller', text: 'Okay, two minutes. And yes, I will drop you at the gate.' },
];

/**
 * Global call overlay: renders the countdown chip while armed and the full
 * incoming-call screen once the simulated call rings.
 */
export function ExitModeOverlay() {
  const { exitMode, now } = useAppState();
  const [live, setLive] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);

  const answered = exitMode?.answered ?? false;

  useEffect(() => {
    if (!answered) {
      setLive(0);
      return;
    }
    const id = setInterval(() => setLive((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [answered]);

  if (!exitMode?.active) return null;

  if (exitMode.answered) {
    return <ActiveCallScreen live={live} muted={muted} speaker={speaker} setMuted={setMuted} setSpeaker={setSpeaker} />;
  }

  if (!exitMode.ringing) {
    const remaining = Math.max(0, exitMode.ringsAt - now);
    return (
      <div className="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0">
        <div className="animate-fade-in-up rounded-2xl border border-ink-200 bg-white p-4 shadow-overlay">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700">
                <Sparkles size={12} /> Exit Mode armed
              </p>
              <p className="mt-1 truncate text-[13.5px] font-semibold text-ink-900">
                Simulated call from {exitMode.contactLabel}
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-ink-100 px-2.5 py-1 text-[15px] font-bold tabular text-ink-800">
              {formatCountdown(remaining)}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => store.endExitMode()}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" className="flex-1" icon={<Phone size={15} />} onClick={() => store.answerExitCall()}>
              Ring now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <IncomingCallScreen />;
}

function IncomingCallScreen() {
  const { exitMode } = useAppState();
  if (!exitMode) return null;
  const caller = EXIT_CALLERS.find((c) => c.label === exitMode.contactLabel) ?? {
    id: exitMode.contactId,
    label: exitMode.contactLabel,
    kind: 'generic' as const,
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-ink-950 px-6 py-10 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Simulated incoming call from ${caller.label}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-ink-700/60 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 pt-6 text-center">
        <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
          Simulated call — SURAKSHA Exit Mode
        </span>
        <p className="text-[13px] text-white/60">No telephony is used. This screen is generated on your device.</p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="relative grid place-items-center">
          <span className="absolute h-28 w-28 animate-pulse-ring rounded-full bg-safe-500/40" aria-hidden />
          <span className="absolute h-28 w-28 animate-pulse-ring rounded-full bg-safe-500/30 [animation-delay:600ms]" aria-hidden />
          <Avatar name={caller.label} size="lg" tone="brand" className="relative h-24 w-24 text-2xl" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">{caller.label}</h2>
          <p className="mt-1 text-sm text-white/70">
            {caller.kind === 'security' ? 'Campus Security · mobile' : caller.kind === 'family' ? 'Mobile' : 'Incoming call'}
          </p>
        </div>
        <p className="animate-soft-pulse text-[13px] font-medium text-white/60">Incoming call…</p>
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => store.declineExitCall()}
            className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-white/15 bg-white/5 py-4 text-[13px] font-semibold text-white/80 transition-state hover:bg-white/10"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-critical-600 text-white">
              <PhoneOff size={24} />
            </span>
            Decline
          </button>
          <button
            type="button"
            onClick={() => store.answerExitCall()}
            className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-white/15 bg-white/5 py-4 text-[13px] font-semibold text-white transition-state hover:bg-white/10"
          >
            <span className="grid h-14 w-14 animate-soft-pulse place-items-center rounded-full bg-safe-500 text-white">
              <PhoneCall size={24} />
            </span>
            Accept
          </button>
        </div>
        <button
          type="button"
          onClick={() => store.endExitMode()}
          className="mx-auto block text-[12.5px] font-medium text-white/50 underline underline-offset-2 hover:text-white/80"
        >
          Not now — close Exit Mode
        </button>
      </div>
    </div>
  );
}

function ActiveCallScreen({
  live,
  muted,
  speaker,
  setMuted,
  setSpeaker,
}: {
  live: number;
  muted: boolean;
  speaker: boolean;
  setMuted: (v: boolean) => void;
  setSpeaker: (v: boolean) => void;
}) {
  const { exitMode } = useAppState();
  const caller = useMemo(
    () => EXIT_CALLERS.find((c) => c.label === exitMode?.contactLabel) ?? { label: exitMode?.contactLabel ?? 'Incoming call', kind: 'generic' as const },
    [exitMode?.contactLabel],
  );
  const visibleLines = SCRIPT_LINES.slice(0, Math.min(SCRIPT_LINES.length, Math.floor(live / 4) + 1));

  const mm = String(Math.floor(live / 60)).padStart(2, '0');
  const ss = String(live % 60).padStart(2, '0');

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-ink-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Simulated call in progress with ${caller.label}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-700/50 blur-3xl" />
      </div>

      <div className="relative z-10 flex items-center justify-between px-5 py-4">
        <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/80">
          Simulated call
        </span>
        <span className="font-mono text-[13px] text-white/70 tabular">{`${mm}:${ss}`}</span>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-start gap-4 px-5">
        <Avatar name={caller.label} size="lg" tone="brand" className="h-20 w-20 text-xl" />
        <div className="text-center">
          <h2 className="text-xl font-bold">{caller.label}</h2>
          <p className="mt-0.5 text-[12.5px] text-white/60">Connected · simulated audio</p>
        </div>

        <div className="mt-2 w-full max-w-md space-y-2.5">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
            Call transcript (scripted — nothing is heard or recorded)
          </p>
          {visibleLines.map((line, index) => (
            <div
              key={index}
              className={cn(
                'animate-fade-in-up rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white/90',
              )}
            >
              <span className="mr-2 text-[11px] font-bold uppercase tracking-wide text-white/45">{line.speaker}</span>
              {line.text}
            </div>
          ))}
        </div>

        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-center">
          <p className="text-[12.5px] font-semibold text-white/85">Ready to leave? Say: “I&apos;m coming out now.”</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/60">
            Keep the phone to your ear, walk toward the exit you chose earlier, and stay on this screen as long as it is
            useful.
          </p>
        </div>
      </div>

      <div className="relative z-10 space-y-3 px-5 pb-8 pt-4">
        <div className="grid grid-cols-3 gap-3">
          <CallControl active={muted} onClick={() => setMuted(!muted)} label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </CallControl>
          <CallControl active={speaker} onClick={() => setSpeaker(!speaker)} label={speaker ? 'Speaker on' : 'Speaker off'}>
            {speaker ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </CallControl>
          <CallControl active={false} onClick={() => store.toggleUi('sosPanelOpen', true)} label="Quick SOS" danger>
            <ShieldQuestion size={18} />
          </CallControl>
        </div>
        <button
          type="button"
          onClick={() => store.endExitMode()}
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-critical-600 text-white transition-state hover:bg-critical-700"
          aria-label="End simulated call"
        >
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}

function CallControl({
  children,
  active,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex h-12 items-center justify-center gap-2 rounded-2xl border text-[12.5px] font-semibold transition-state',
        active ? 'border-white/25 bg-white/15 text-white' : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
        danger && 'border-critical-500/40 text-critical-200',
      )}
    >
      {children}
    </button>
  );
}

/** Setup screen for Exit Mode (used by the Exit Mode page). */
export function ExitModeSetup() {
  const [delay, setDelay] = useState(10);
  const [caller, setCaller] = useState('ct-priya');
  const { exitMode } = useAppState();

  return (
    <div className="space-y-5">
      <div>
        <p className="sr-label">Call me in</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[10, 120, 300].map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => setDelay(seconds)}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition-state',
                delay === seconds
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-ink-200 bg-white hover:bg-ink-50',
              )}
            >
              <span className={cn('block text-sm font-bold', delay === seconds ? 'text-brand-800' : 'text-ink-800')}>
                {seconds === 10 ? '10 seconds' : seconds === 120 ? '2 minutes' : 'After my safety sequence'}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-ink-500">
                {seconds === 10 ? 'Quick exit' : seconds === 120 ? 'Natural pacing' : '5 minutes from now'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="sr-label">Caller identity</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EXIT_CALLERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCaller(option.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-state',
                caller === option.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 bg-white hover:bg-ink-50',
              )}
            >
              <Avatar name={option.label} size="sm" tone={caller === option.id ? 'brand' : 'neutral'} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-ink-800">{option.label}</span>
                <span className="block text-[11.5px] text-ink-500">
                  {option.kind === 'security' ? 'Institution' : option.kind === 'family' ? 'Family' : option.kind === 'friend' ? 'Friend' : 'Generic incoming call'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <Button
        size="xl"
        block
        icon={<Phone size={19} />}
        onClick={() => store.startExitMode({ delaySeconds: delay, contactId: caller })}
        disabled={exitMode?.active && !exitMode.answered}
      >
        {exitMode?.active && !exitMode.answered ? 'Exit Mode already armed' : 'START EXIT'}
      </Button>

      <p className="flex gap-2 rounded-xl bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-ink-600">
        <X size={14} className="mt-0.5 shrink-0 text-ink-400" />
        <span>
          Exit Mode is an escape aid, not an emergency action. It does not call anyone, record audio or notify your circle.
          If you are in immediate danger, use Quick SOS and call your local emergency number.
        </span>
      </p>
    </div>
  );
}
