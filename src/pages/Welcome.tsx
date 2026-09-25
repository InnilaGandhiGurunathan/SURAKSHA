/**
 * Welcome — the landing page: "What is SURAKSHA?"
 *
 * Home answers "what can I do right now"; this page tells the story.
 * Every section links to a real, working feature — nothing is a placeholder,
 * and no feature is described that the app doesn't have.
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  Clock,
  Compass,
  FileText,
  MapPin,
  PhoneCall,
  RouteOff,
  ShieldCheck,
  Siren,
  TimerOff,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { store } from '@/store/hooks';
import { EMERGENCY_NUMBER } from '@/domain/types';

const FLOW = [
  {
    to: '/traveller/start',
    icon: Compass,
    title: 'Journey',
    body: 'You share the plan — from, to, and when.',
  },
  {
    to: '/traveller/journey',
    icon: ShieldCheck,
    title: 'Detect',
    body: 'Timing, route, check-ins and zones become one honest state.',
  },
  {
    to: '/traveller/journey',
    icon: Clock,
    title: 'Check-in',
    body: '“Everything okay?” — with a grace period to answer.',
  },
  {
    to: '/traveller/circle',
    icon: Users,
    title: 'Escalate',
    body: 'Primary → backup, in the order you chose.',
  },
  {
    to: '/traveller/incidents',
    icon: Siren,
    title: 'Respond',
    body: 'Records and evidence your circle can act on.',
  },
];

const FEATURES = [
  {
    to: '/traveller/start',
    icon: Compass,
    title: 'Guardian Mode',
    body: 'Journeys watched with you, from start to arrival.',
  },
  {
    to: '/traveller/journey',
    icon: ShieldCheck,
    title: 'Risk detection',
    body: 'Context-aware signals with every reason shown.',
  },
  {
    to: '/traveller/circle',
    icon: Users,
    title: 'Trusted Circle',
    body: 'The people you chose, alerted in your order.',
  },
  {
    to: '/traveller/exit',
    icon: PhoneCall,
    title: 'Exit Mode',
    body: 'A believable simulated call when you need a reason to leave.',
  },
  {
    to: '/traveller/incidents',
    icon: FileText,
    title: 'Evidence preservation',
    body: 'Timelines and on-device evidence, integrity-hashed.',
  },
  {
    to: '/traveller/community',
    icon: MapPin,
    title: 'Safe places',
    body: 'Verified spots nearby you can walk into and wait.',
  },
];

const SCENARIO = [
  {
    icon: RouteOff,
    title: 'Unexpected route deviation',
    body: 'You leave the expected corridor. SURAKSHA notices — an observation, not a verdict.',
  },
  {
    icon: BellRing,
    title: 'Check-in requested',
    body: '“Everything okay?” appears, with a grace period to answer.',
  },
  {
    icon: TimerOff,
    title: 'No response',
    body: 'The grace period passes. The state rises; your guardian is told what happened.',
  },
  {
    icon: Users,
    title: 'Trusted contact alerted',
    body: 'Your primary guardian gets the facts — and acknowledges a human is responding.',
  },
];

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-6">
      {/* Hero */}
      <section className="flex flex-col items-center px-2 pt-6 text-center sm:pt-10">
        <span className="flex items-center gap-2.5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 text-white shadow-raised">
            <ShieldCheck size={22} />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-ink-900">SURAKSHA</span>
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
          Safety Before SOS
        </p>
        <h1 className="mt-2 max-w-md text-[30px] font-bold leading-[1.1] tracking-tight text-ink-900 sm:text-[38px]">
          Safety shouldn&apos;t begin with SOS.
        </h1>
        <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink-500">
          SURAKSHA walks each journey with you — noticing early, checking in, and
          looping in your people before a moment becomes an emergency.
        </p>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
          <Button
            size="lg"
            block
            icon={<Compass size={17} />}
            trailing={<ArrowRight size={16} />}
            onClick={() => navigate('/traveller/start')}
          >
            Start your journey
          </Button>
          <Button size="lg" block variant="outline" onClick={() => navigate('/traveller')}>
            Open SURAKSHA
          </Button>
        </div>
      </section>

      {/* Core idea */}
      <section>
        <SectionHead
          eyebrow="How it protects you"
          title="One journey. Multiple layers of protection."
        />
        <ol className="mt-4 space-y-0">
          {FLOW.map((step, index) => (
            <li key={step.title}>
              <Link
                to={step.to}
                className="group flex items-start gap-4 rounded-2xl px-3 py-3 transition-state hover:bg-white"
              >
                <span className="flex flex-col items-center">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 transition-state group-hover:bg-brand-100">
                    <step.icon size={18} />
                  </span>
                  {index < FLOW.length - 1 ? (
                    <span className="mt-1.5 w-px flex-1 bg-ink-200" aria-hidden />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 pb-1 pt-0.5">
                  <span className="flex items-center gap-1.5 text-[14.5px] font-bold text-ink-900">
                    <span className="text-[12px] font-bold tabular text-ink-300">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {step.title}
                    <ArrowRight
                      size={13}
                      className="text-ink-300 transition-state group-hover:translate-x-0.5 group-hover:text-brand-500"
                    />
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                    {step.body}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* Scenario */}
      <section className="rounded-xl2 border border-ink-200 bg-white p-5 sm:p-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">
          A realistic evening
        </p>
        <h2 className="mt-1.5 text-[22px] font-bold tracking-tight text-ink-900">
          9:30 PM. You&apos;re heading home.
        </h2>
        <ol className="mt-5 space-y-4">
          {SCENARIO.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">
                <step.icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-ink-900">
                  <span className="mr-1.5 text-[12px] tabular text-ink-300">{index + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button
          className="mt-6"
          variant="secondary"
          icon={<Compass size={16} />}
          onClick={() => navigate('/traveller/start')}
        >
          Try it yourself — plan a journey
        </Button>
      </section>

      {/* Features */}
      <section>
        <SectionHead eyebrow="Inside the app" title="Concise by design." />
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <Link
                to={feature.to}
                className="sr-card flex h-full items-start gap-3 p-4 transition-state hover:border-ink-300 hover:shadow-raised"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <feature.icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[14px] font-bold text-ink-900">
                    {feature.title}
                    <ArrowRight size={13} className="text-ink-300" />
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-500">
                    {feature.body}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Quick SOS opens the real emergency workflow — the same one Home uses. */}
        <button
          type="button"
          onClick={() => store.toggleUi('sosPanelOpen', true)}
          className="mt-3 flex w-full items-center gap-3 rounded-card border border-critical-200 bg-critical-50 px-4 py-3.5 text-left transition-state hover:bg-critical-100/60 active:scale-[0.99]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-critical-600 text-white">
            <Siren size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-critical-900">
              Quick SOS — one tap, no hold
            </span>
            <span className="block text-[12.5px] leading-snug text-critical-800/80">
              Alerts your trusted circle with your last known location. Try it here.
            </span>
          </span>
          <ArrowRight size={14} className="ml-auto shrink-0 text-critical-400" />
        </button>
      </section>

      {/* Honest limits */}
      <section className="rounded-xl2 border border-ink-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-ink-900">What SURAKSHA does not do</h2>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-600">
          <li>· Never dials emergency services for you — you always make the call yourself.</li>
          <li>· Never decides you are in danger — it shows signals, not verdicts.</li>
          <li>· Never replaces real help. In an emergency, call {EMERGENCY_NUMBER} directly.</li>
        </ul>
      </section>

      <p className="px-1 text-center text-[11.5px] leading-relaxed text-ink-400">
        SURAKSHA is a tool, not a promise. Your data in this prototype stays on this device.
      </p>
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="px-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{eyebrow}</p>
      <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-ink-900">{title}</h2>
    </div>
  );
}
