/**
 * Welcome — the landing/onboarding page.
 *
 * This page explains WHAT SURAKSHA does so the home screen doesn't have to.
 * Every card below describes a real, working feature and links to it —
 * nothing here is a placeholder.
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Compass,
  FileText,
  MapPin,
  PhoneCall,
  ShieldCheck,
  Siren,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { EMERGENCY_NUMBER } from '@/domain/types';

const FEATURES = [
  {
    to: '/traveller/start',
    icon: Compass,
    title: 'Guardian Mode journeys',
    body: 'Share your plan — from, to, and when — with the people you choose.',
  },
  {
    to: '/traveller/journey',
    icon: Clock,
    title: 'Check-ins with a grace period',
    body: 'SURAKSHA asks “Everything okay?” and gives you time to answer.',
  },
  {
    to: '/traveller/journey',
    icon: ShieldCheck,
    title: 'An honest risk state',
    body: 'A clear SAFE → CRITICAL state with every reason shown. Never a verdict about you.',
  },
  {
    to: '/traveller/circle',
    icon: Users,
    title: 'Trusted Circle escalation',
    body: 'Primary → backup → emergency workflow, in an order you control.',
  },
  {
    to: '/traveller/exit',
    icon: PhoneCall,
    title: 'Exit Mode',
    body: 'A believable simulated call that gives you a reason to leave.',
  },
  {
    to: '/traveller/incidents',
    icon: FileText,
    title: 'Incident records & evidence',
    body: 'Timelines and on-device evidence, hashed so nothing can be quietly changed.',
  },
];

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-4">
      {/* Hero */}
      <section className="flex flex-col items-center px-2 pb-2 pt-6 text-center sm:pt-10">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-raised">
          <ShieldCheck size={26} />
        </span>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
          Safety Before SOS
        </p>
        <h1 className="mt-1 text-[30px] font-bold tracking-tight text-ink-900 sm:text-[36px]">
          SURAKSHA
        </h1>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-500">
          A calm companion for your journeys — check-ins, trusted contacts, and help
          within one tap.
        </p>
        <div className="mt-5 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
          <Button size="lg" block icon={<Compass size={17} />} onClick={() => navigate('/traveller')}>
            Open SURAKSHA
          </Button>
          <Button
            size="lg"
            block
            variant="outline"
            icon={<Siren size={17} />}
            onClick={() => navigate('/traveller/start')}
          >
            Plan a journey
          </Button>
        </div>
      </section>

      {/* What it does — concise cards, each linking to the real feature */}
      <section>
        <h2 className="px-1 text-[15px] font-bold tracking-tight text-ink-900">
          What SURAKSHA does
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
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
        <Link
          to="/traveller/community"
          className="mt-3 flex items-center gap-2 rounded-card border border-dashed border-ink-300 px-4 py-3 text-[13px] font-semibold text-ink-600 transition-state hover:bg-white"
        >
          <MapPin size={16} className="text-ink-400" />
          Also inside: verified safe places and short safety lessons
          <ArrowRight size={14} className="ml-auto text-ink-300" />
        </Link>
      </section>

      {/* Honest limits */}
      <section className="rounded-xl2 border border-ink-200 bg-white p-5">
        <h2 className="text-[14px] font-bold text-ink-900">What SURAKSHA does not do</h2>
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
