import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/usePwa';
import { Button } from './ui/button';
import { InfoNote } from './StatusPieces';
import { toast } from 'sonner';

/**
 * Install nudge.
 *
 * Deliberately dismissed-by-default-after-one-ask: an install prompt must never
 * sit on top of the SOS button or a check-in. It explains the concrete benefit
 * (keeps offline data, opens full screen) rather than saying "install our app".
 */
export function InstallPrompt() {
  const { available, installed, prompt, dismiss, dismissed, platform, iosInstructions } = useInstallPrompt();
  const [asked, setAsked] = useState(false);

  if (installed || dismissed || !available || asked) return null;

  const start = async () => {
    if (platform === 'ios') {
      setAsked(true);
      return;
    }
    const outcome = await prompt();
    setAsked(true);
    if (outcome === 'accepted') toast.success('SURAKSHA installed to your home screen.');
    if (outcome === 'unavailable') {
      toast.message('Installation is not available in this browser. You can still use SURAKSHA in the tab.');
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-24 z-40 sm:left-auto sm:right-6 sm:w-80">
      <div className="rounded-2xl border border-border bg-popover p-3.5 shadow-[var(--shadow-float)]">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <Download className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Install SURAKSHA on this device</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Installed, the app opens full screen and its offline data is far less likely to be cleared by the
              browser — which matters for journey monitoring and queued reports.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {platform === 'ios' ? (
          <InfoNote tone="info" className="mt-2.5">
            <p className="flex items-start gap-1.5">
              <Share className="mt-0.5 size-3 shrink-0" aria-hidden />
              {iosInstructions}
            </p>
          </InfoNote>
        ) : (
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="accent" onClick={() => void start()}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
