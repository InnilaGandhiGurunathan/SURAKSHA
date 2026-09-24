/**
 * Status design tokens. GREEN = SAFE, YELLOW = WATCH, ORANGE = ALERT,
 * RED = CRITICAL — used consistently for text, surfaces, borders and rings.
 * Red only ever appears for a genuine CRITICAL state.
 */

import type { IncidentSeverity, RiskBand, Toast } from '@/domain/types';

export type Tone = 'neutral' | 'safe' | 'watch' | 'alert' | 'critical' | 'brand';

export interface ToneTokens {
  label: string;
  emoji: string;
  /** Small dot / chip background. */
  dot: string;
  /** Chip: soft background + text + border. */
  chip: string;
  /** Solid fill for bars, buttons and map strokes. */
  solid: string;
  /** Strong text colour. */
  text: string;
  /** Card surface for alert states. */
  surface: string;
  border: string;
  /** Ring colour for pulsing markers. */
  ring: string;
  /** Progress bar fill. */
  bar: string;
}

export const TONES: Record<Tone, ToneTokens> = {
  neutral: {
    label: 'Neutral',
    emoji: '⚪️',
    dot: 'bg-ink-400',
    chip: 'bg-ink-100 text-ink-700 border-ink-200',
    solid: 'bg-ink-700 text-white',
    text: 'text-ink-700',
    surface: 'bg-white',
    border: 'border-ink-200',
    ring: 'ring-ink-300',
    bar: 'bg-ink-500',
  },
  safe: {
    label: 'Safe',
    emoji: '🟢',
    dot: 'bg-safe-500',
    chip: 'bg-safe-50 text-safe-700 border-safe-200',
    solid: 'bg-safe-600 text-white',
    text: 'text-safe-700',
    surface: 'bg-safe-50',
    border: 'border-safe-200',
    ring: 'ring-safe-300',
    bar: 'bg-safe-500',
  },
  watch: {
    label: 'Watch',
    emoji: '🟡',
    dot: 'bg-watch-400',
    chip: 'bg-watch-50 text-watch-700 border-watch-200',
    solid: 'bg-watch-500 text-white',
    text: 'text-watch-700',
    surface: 'bg-watch-50',
    border: 'border-watch-200',
    ring: 'ring-watch-300',
    bar: 'bg-watch-400',
  },
  alert: {
    label: 'Alert',
    emoji: '🟠',
    dot: 'bg-alert-500',
    chip: 'bg-alert-50 text-alert-700 border-alert-200',
    solid: 'bg-alert-500 text-white',
    text: 'text-alert-700',
    surface: 'bg-alert-50',
    border: 'border-alert-200',
    ring: 'ring-alert-300',
    bar: 'bg-alert-500',
  },
  critical: {
    label: 'Critical',
    emoji: '🔴',
    dot: 'bg-critical-600',
    chip: 'bg-critical-50 text-critical-700 border-critical-200',
    solid: 'bg-critical-600 text-white',
    text: 'text-critical-700',
    surface: 'bg-critical-50',
    border: 'border-critical-200',
    ring: 'ring-critical-300',
    bar: 'bg-critical-600',
  },
  brand: {
    label: 'In progress',
    emoji: '🔵',
    dot: 'bg-brand-500',
    chip: 'bg-brand-50 text-brand-700 border-brand-200',
    solid: 'bg-brand-600 text-white',
    text: 'text-brand-700',
    surface: 'bg-brand-50',
    border: 'border-brand-200',
    ring: 'ring-brand-300',
    bar: 'bg-brand-500',
  },
};

export function toneForBand(band: RiskBand): Tone {
  switch (band) {
    case 'SAFE':
      return 'safe';
    case 'WATCH':
      return 'watch';
    case 'ALERT':
      return 'alert';
    case 'CRITICAL':
    default:
      return 'critical';
  }
}

export function tones(band: RiskBand): ToneTokens {
  return TONES[toneForBand(band)];
}

export function toneForSeverity(severity: IncidentSeverity): Tone {
  switch (severity) {
    case 'WATCH':
      return 'watch';
    case 'ALERT':
      return 'alert';
    case 'CRITICAL':
    default:
      return 'critical';
  }
}

export function compactBandLabel(band: RiskBand): string {
  return band.charAt(0) + band.slice(1).toLowerCase();
}

export const TOAST_TONE: Record<Toast['tone'], Tone> = {
  neutral: 'neutral',
  safe: 'safe',
  watch: 'watch',
  alert: 'alert',
  critical: 'critical',
  brand: 'brand',
};
