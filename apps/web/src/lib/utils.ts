import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Small helper for conditionally joining class names in components. */
export function conditional(condition: boolean, whenTrue: string, whenFalse = ''): string {
  return condition ? whenTrue : whenFalse;
}
