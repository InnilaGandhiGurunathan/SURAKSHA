import { RefreshCw, X } from 'lucide-react';
import { useServiceWorkerUpdate } from '@/hooks/usePwa';
import { Button } from './ui/button';

/**
 * Service-worker update banner.
 *
 * Updates are never applied automatically while monitoring is running: a reload
 * mid-journey is exactly the kind of surprise a safety app must not deliver.
 */
export function UpdatePrompt() {
  const { ready, apply, dismiss, dismissed, note } = useServiceWorkerUpdate();

  if (!ready || dismissed) return null;

  return (
    <div className="fixed inset-x-3 top-16 z-40 sm:left-auto sm:right-6 sm:w-80">
      <div className="flex items-start gap-2.5 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 shadow-[var(--shadow-float)]">
        <RefreshCw className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Update available</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={apply}>
              Update now
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Later
            </Button>
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss update notice" className="text-muted-foreground">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
