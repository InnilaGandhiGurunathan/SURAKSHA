/**
 * SURAKSHA brand logo.
 *
 * The lockup file (`public/suraksha-logo.png`) is the full square emblem +
 * wordmark. Two presentations share it:
 *
 * - `LogoMark` — the shield emblem only. The 4:3 frame CSS-crops the wordmark
 *   out of the square file, for chrome slots (sidebar, top bar, splash).
 * - `LogoLockup` — the full emblem + wordmark, for the landing hero.
 *
 * `mix-blend-multiply` lets the file's light background melt into light
 * surfaces instead of showing a visible box edge.
 */

import { cn } from '@/lib/cn';

export const LOGO_SRC = '/suraksha-logo.png';

export function LogoMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = size === 'sm' ? 'h-8 w-[42px]' : size === 'lg' ? 'h-12 w-16' : 'h-9 w-12';
  return (
    <span className={cn('block shrink-0 overflow-hidden rounded-lg', dims, className)}>
      <img
        src={LOGO_SRC}
        alt="SURAKSHA logo"
        draggable={false}
        className="h-full w-full object-cover object-top mix-blend-multiply"
      />
    </span>
  );
}

export function LogoLockup({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt="SURAKSHA logo"
      draggable={false}
      className={cn('h-28 w-auto rounded-2xl ring-1 ring-ink-200 sm:h-32', className)}
    />
  );
}
