import { Link } from 'react-router-dom';
import { Compass, Home, LifeBuoy } from 'lucide-react';
import { Shield } from '@/components/Shield';
import { Button } from '@/components/ui/button';

/** 404 — offers the safety-critical routes rather than a dead end. */
export function NotFoundScreen() {
  return (
    <div className="app-shell grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-md space-y-5 text-center">
        <Shield className="mx-auto size-14" />
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold">That screen does not exist</h1>
          <p className="text-sm text-muted-foreground">
            The link may be old, or the screen may have moved. Your journeys, reports and recordings are unaffected.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="accent" asChild>
            <Link to="/app">
              <Home className="size-4" />
              Back to the dashboard
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/app/sos">
              <LifeBuoy className="size-4" />
              Emergency SOS
            </Link>
          </Button>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Compass className="size-3.5" aria-hidden />
          If you are in danger, call your local emergency number directly.
        </p>
      </div>
    </div>
  );
}

export default NotFoundScreen;
