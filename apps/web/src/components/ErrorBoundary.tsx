import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/**
 * Error boundary.
 *
 * A crash must never leave the user stuck with no way out, and it must never
 * imply that monitoring is still running when it is not. The recovery path keeps
 * a direct SOS link and offers the emergency number.
 */
interface State {
  error?: Error;
  info?: ErrorInfo;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error('[suraksha] unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app-shell grid min-h-dvh place-items-center px-5 py-10">
        <Card className="w-full max-w-md" tone="danger">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" aria-hidden />
              Something went wrong in the interface
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your data is safe: journeys, checkpoints, reports and events are stored on this device and are
              unaffected by a screen error. Reload to continue.
            </p>
            <p className="rounded-xl border border-border bg-muted/40 p-2.5 text-[11px] font-mono leading-relaxed">
              {this.state.error.message}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="accent" onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" />
                Reload SURAKSHA
              </Button>
              <Button variant="sos" asChild>
                <a href="tel:112">Call emergency services (112)</a>
              </Button>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              If monitoring was running, it stops while this screen is shown. Tell your trusted contacts
              directly if you were relying on it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
}
