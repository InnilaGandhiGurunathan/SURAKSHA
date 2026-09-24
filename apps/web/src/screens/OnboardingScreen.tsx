import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BatteryCharging,
  CloudOff,
  Lock,
  MapPinned,
  MessageSquare,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { Shield } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { InfoNote } from '@/components/StatusPieces';
import { DISCLAIMERS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Onboarding.
 *
 * Sets expectations before asking for anything. The order is deliberate: what the
 * app does offline first, then what it cannot do, then permissions, then account.
 * A safety product that over-promises in onboarding is worse than useless.
 */
const SLIDES = [
  {
    id: 'offline',
    icon: CloudOff,
    title: 'Works with no signal',
    body: 'The app, your journeys, your checkpoints, the risk rules and your contacts are stored on this device. Aeroplane mode, tunnels, dead zones — monitoring keeps running.',
    tone: 'accent' as const,
  },
  {
    id: 'journeys',
    icon: MapPinned,
    title: 'Journeys you can actually rely on',
    body: 'Plan a route, set checkpoints, download the map corridor, pick who should be told. SURAKSHA watches timing, position and deviation on the device.',
    tone: 'accent' as const,
  },
  {
    id: 'honest',
    icon: ShieldAlert,
    title: 'No fake promises',
    body: 'Risk numbers are heuristics, not probabilities. A missed checkpoint never calls anyone. Delivery status shows what actually happened, and nothing claims a rescue is coming.',
    tone: 'warning' as const,
  },
  {
    id: 'people',
    icon: Users,
    title: 'Your people, your permissions',
    body: 'Trusted contacts only see what you explicitly share, through an encrypted link you can revoke. Guardians see the journey, never your private notes.',
    tone: 'accent' as const,
  },
  {
    id: 'report',
    icon: MessageSquare,
    title: 'Reports that survive bad networks',
    body: 'Write it once, on the device, first. The app waits 30 seconds for a server acknowledgement, then hands the same details to the reporting website — deduplicated by a unique report ID.',
    tone: 'accent' as const,
  },
  {
    id: 'privacy',
    icon: Lock,
    title: 'Consent and control',
    body: 'Location is only shared when you turn it on for a journey. You can export or erase everything on this device at any time, and revoke guardian access instantly.',
    tone: 'accent' as const,
  },
];

export function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  const finish = () => {
    localStorage.setItem('suraksha.onboarded', '1');
    navigate('/auth', { replace: true });
  };

  return (
    <div className="app-shell flex min-h-dvh flex-col">
      <header className="shell flex items-center justify-between px-4 pt-6">
        <div className="flex items-center gap-2">
          <Shield className="size-8" />
          <span className="text-sm font-bold tracking-[0.2em]">SURAKSHA</span>
        </div>
        <Button variant="ghost" size="sm" onClick={finish}>
          Skip
        </Button>
      </header>

      <main className="shell flex flex-1 flex-col justify-center px-4 py-8">
        <div className="mb-6">
          <Progress value={((index + 1) / SLIDES.length) * 100} label="Onboarding progress" />
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Step {index + 1} of {SLIDES.length}
          </p>
        </div>

        <Card className={cn('animate-rise', slide.tone === 'warning' && 'border-amber-500/40')}>
          <CardContent className="space-y-4 pt-6">
            <span
              className={cn(
                'grid size-12 place-items-center rounded-2xl',
                slide.tone === 'warning' ? 'bg-amber-500/15 text-amber-500' : 'bg-accent/15 text-accent',
              )}
            >
              <slide.icon className="size-6" aria-hidden />
            </span>
            <h1 className="text-xl font-bold leading-snug" key={slide.id}>
              {slide.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground" key={`${slide.id}-body`}>
              {slide.body}
            </p>

            {slide.id === 'honest' ? (
              <InfoNote tone="warning" title="What SURAKSHA cannot do">
                <ul className="list-inside list-disc space-y-1">
                  <li>{DISCLAIMERS.noRescueGuarantee}</li>
                  <li>{DISCLAIMERS.monitoring}</li>
                  <li>{DISCLAIMERS.riskHeuristic}</li>
                </ul>
              </InfoNote>
            ) : null}

            {slide.id === 'report' ? (
              <InfoNote tone="info" title="The 30-second rule">
                <p>
                  A report is only ever shown as delivered when the server acknowledged it. If it does not answer
                  within 30 seconds, SURAKSHA opens the reporting website with your details instead of pretending
                  it was sent.
                </p>
              </InfoNote>
            ) : null}

            {slide.id === 'offline' ? (
              <InfoNote tone="muted" title="At a glance">
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  <li className="flex items-center gap-1.5">
                    <ShieldAlert className="size-3" aria-hidden />
                    SOS works offline
                  </li>
                  <li className="flex items-center gap-1.5">
                    <BatteryCharging className="size-3" aria-hidden />
                    Wake lock while monitoring
                  </li>
                  <li className="flex items-center gap-1.5">
                    <MapPinned className="size-3" aria-hidden />
                    Offline map corridor
                  </li>
                </ul>
              </InfoNote>
            ) : null}
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" role="tablist" aria-label="Onboarding slides">
            {SLIDES.map((item, itemIndex) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={itemIndex === index}
                aria-label={`Go to slide ${itemIndex + 1}: ${item.title}`}
                onClick={() => setIndex(itemIndex)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  itemIndex === index ? 'w-6 bg-accent' : 'w-1.5 bg-muted-foreground/40',
                )}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {index > 0 ? (
              <Button variant="ghost" onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                Back
              </Button>
            ) : null}
            <Button
              variant="accent"
              onClick={() => (last ? finish() : setIndex((value) => value + 1))}
            >
              {last ? 'Get started' : 'Next'}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </main>

      <footer className="shell px-4 pb-8">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          By continuing you agree that SURAKSHA is a personal safety aid you use at your own discretion. It is not
          a substitute for emergency services, and it does not monitor you from anywhere except your own device.
        </p>
      </footer>
    </div>
  );
}

export default OnboardingScreen;
