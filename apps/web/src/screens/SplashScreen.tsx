import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserProfile } from '@suraksha/shared';
import { Shield } from '@/components/Shield';
import { Button } from '@/components/ui/button';
import { isSetupComplete } from '@/services/offline';
import { APP_VERSION } from '@/lib/constants';

/**
 * Splash.
 *
 * This is not decoration: it is where the app decides where to go, and it is the
 * screen a user sees when offline. It therefore reports the offline state
 * plainly and always offers a way to continue even if a redirect never happens.
 */
export function SplashScreen({ user }: { user?: UserProfile }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<string | undefined>();
  const [waitingLong, setWaitingLong] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const decide = async () => {
      const onboarded = localStorage.getItem('suraksha.onboarded') === '1';
      if (!onboarded) return '/onboarding';
      if (!user) return '/auth';

      const ready = await isSetupComplete();
      return ready ? '/app' : '/setup';
    };

    const run = async () => {
      const [destination] = await Promise.all([
        decide(),
        new Promise((resolve) => setTimeout(resolve, 1400)),
      ]);
      if (cancelled) return;
      setTarget(destination);
      navigate(destination, { replace: true });
    };

    void run();

    const slow = setTimeout(() => setWaitingLong(true), 3500);
    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, [navigate, user?.id]);

  const offline = !navigator.onLine;

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-gradient-to-b from-navy-900 via-navy-950 to-[#03101f] px-6 text-white">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Shield animated className="size-24" />

        <h1 className="mt-6 text-2xl font-bold tracking-[0.32em] text-white">SURAKSHA</h1>
        <p className="mt-1.5 text-[11px] uppercase tracking-[0.3em] text-teal-300">Your Safety, Our Priority</p>

        <div className="mt-7 h-1 w-40 overflow-hidden rounded-full bg-white/12" aria-hidden>
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-teal-500 to-teal-300" />
        </div>

        <p className="mt-4 text-xs text-white/70" role="status" aria-live="polite">
          {offline
            ? 'Opening your offline safety data…'
            : 'Starting your device-local safety data…'}
        </p>

        <div className="mt-8 space-y-2 text-[11px] leading-relaxed text-white/55">
          <p>
            Journeys, checkpoints, risk scoring, SOS and incident reports all live on this device. The internet
            is only needed for first-time setup and for sending reports.
          </p>
          <p className="text-white/45">
            SURAKSHA is a safety aid, not an emergency service. It cannot guarantee a rescue — call your local
            emergency number when you need help.
          </p>
        </div>

        {waitingLong ? (
          <div className="mt-6 w-full space-y-2">
            <p className="text-[11px] text-amber-200">
              This is taking longer than usual. Your data is on the device — you can continue manually.
            </p>
            <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10" onClick={() => navigate(target ?? '/auth', { replace: true })}>
              Continue
            </Button>
          </div>
        ) : null}

        <p className="mt-8 text-[10px] text-white/35">Version {APP_VERSION}</p>
      </div>
    </div>
  );
}

export default SplashScreen;
