import { AlertTriangle, Bell, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TONES, type Tone } from '@/lib/status';
import { useAppState, store } from '@/store/hooks';
import type { Toast } from '@/domain/types';

const TOAST_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  safe: CheckCircle2,
  watch: AlertTriangle,
  alert: ShieldAlert,
  critical: ShieldAlert,
  brand: Bell,
};

function toneForToast(tone: Toast['tone']): Tone {
  return tone;
}

export function Toaster() {
  const { toasts } = useAppState();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-3 sm:items-end sm:pr-4"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.slice(-3).map((toast) => {
        const tone = toneForToast(toast.tone);
        const tokens = TONES[tone];
        const Icon = TOAST_ICON[tone];
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto w-full max-w-sm animate-slide-in-right overflow-hidden rounded-2xl border bg-white shadow-overlay',
              tokens.border,
            )}
          >
            <div className="flex items-start gap-3 p-3.5">
              <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', tokens.chip)}>
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-ink-900">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-600">{toast.description}</p>
                ) : null}
                {toast.actionLabel && toast.onAction ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.onAction?.();
                      store.dismissToast(toast.id);
                    }}
                    className="mt-2 text-[12.5px] font-semibold text-brand-700 underline underline-offset-2"
                  >
                    {toast.actionLabel}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => store.dismissToast(toast.id)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-400 transition-state hover:bg-ink-100 hover:text-ink-600"
              >
                <X size={14} />
              </button>
            </div>
            <div className={cn('h-0.5 w-full', tokens.bar)} aria-hidden />
          </div>
        );
      })}
    </div>
  );
}
