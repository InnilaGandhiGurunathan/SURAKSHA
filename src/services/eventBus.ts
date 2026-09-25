/**
 * Central event collector.
 *
 * Every meaningful thing that happens in SURAKSHA is an event. The event log is
 * the single source of truth for the traveller's recent activity and for the
 * guardian's timeline. Nothing is inferred later — if it is not in the log, the
 * UI does not claim it happened.
 */

import type { SafetyEvent, SafetyEventType } from '@/domain/types';

export type EventListener = (event: SafetyEvent, log: SafetyEvent[]) => void;

let sequence = 0;

export function createEventId(): string {
  sequence += 1;
  return `evt-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function makeEvent(input: {
  type: SafetyEventType;
  journeyId?: string | null;
  incidentId?: string | null;
  userId: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}): SafetyEvent {
  return {
    id: createEventId(),
    type: input.type,
    timestamp: input.timestamp ?? Date.now(),
    journeyId: input.journeyId ?? null,
    incidentId: input.incidentId ?? null,
    userId: input.userId,
    metadata: input.metadata ?? {},
  };
}

/** Human-readable label + tone for an event type, shared by both dashboards. */
export interface EventPresentation {
  label: string;
  tone: 'neutral' | 'safe' | 'watch' | 'alert' | 'critical' | 'brand';
  icon:
    | 'play'
    | 'pin'
    | 'route'
    | 'route-off'
    | 'bell'
    | 'check'
    | 'alert'
    | 'shield-alert'
    | 'phone'
    | 'siren'
    | 'file'
    | 'pause'
    | 'flag'
    | 'info'
    | 'hash';
}

export function presentEvent(event: SafetyEvent): EventPresentation {
  const detail = (key: string): string | undefined => {
    const value = event.metadata[key];
    return typeof value === 'string' ? value : undefined;
  };
  const flag = (key: string): boolean => event.metadata[key] === true || event.metadata[key] === 'true';
  const count = (key: string): number | undefined => {
    const value = event.metadata[key];
    return typeof value === 'number' ? value : undefined;
  };

  switch (event.type) {
    case 'journey_started':
      return { label: `Journey started → ${detail('destination') ?? 'destination'}`, tone: 'brand', icon: 'play' };
    case 'location_updated':
      return {
        label: detail('deviationActive') === 'true'
          ? `Location updated — off the expected route (${detail('position') ?? 'simulated'})`
          : `Location updated (${detail('position') ?? 'simulated'})`,
        tone: 'neutral',
        icon: 'pin',
      };
    case 'route_deviation':
      return { label: 'Route deviation detected', tone: 'watch', icon: 'route-off' };
    case 'route_restored':
      return { label: 'Back on the expected route', tone: 'safe', icon: 'route' };
    case 'checkin_sent':
      return { label: 'Safety check-in sent', tone: 'brand', icon: 'bell' };
    case 'checkin_completed':
      return { label: 'Check-in completed — traveller confirmed safe', tone: 'safe', icon: 'check' };
    case 'checkin_missed':
      return { label: 'Safety check-in missed', tone: 'alert', icon: 'alert' };
    case 'safe_confirmed':
      return { label: 'Safety confirmed by traveller', tone: 'safe', icon: 'check' };
    case 'help_requested':
      /*
       * One event type covers two very different things: the traveller asking
       * for help, and that request escalating because nobody reached them. Both
       * used to render as "Traveller requested help", so the timeline hid the
       * escalation — the exact thing #4 and #10 were about.
       */
      if (flag('escalated')) {
        const waited = count('waitedMinutes');
        return {
          label: waited
            ? `Help request escalated — nobody reached the traveller within ${waited} min`
            : 'Help request escalated — nobody reached the traveller in time',
          tone: 'critical',
          icon: 'shield-alert',
        };
      }
      return { label: 'Traveller requested help', tone: 'alert', icon: 'shield-alert' };
    case 'exit_mode_started':
      return { label: `Exit Mode started (${detail('contact') ?? 'simulated call'})`, tone: 'brand', icon: 'phone' };
    case 'exit_mode_call_answered':
      return { label: 'Simulated call answered', tone: 'brand', icon: 'phone' };
    case 'sos_triggered':
      return { label: 'Quick SOS activated by traveller', tone: 'critical', icon: 'siren' };
    case 'incident_created':
      return { label: `Incident ${detail('code') ?? ''} created`.trim(), tone: 'critical', icon: 'flag' };
    case 'guardian_notified':
      return { label: `Guardian notified (${detail('contact') ?? 'primary'})`, tone: 'alert', icon: 'bell' };
    case 'guardian_acknowledged':
      return { label: `Guardian acknowledged (${detail('contact') ?? 'guardian'})`, tone: 'brand', icon: 'check' };
    case 'evidence_attached':
      return { label: `Evidence attached — ${detail('fileName') ?? 'file'}`, tone: 'neutral', icon: 'file' };
    case 'journey_paused':
      return { label: 'Journey paused', tone: 'neutral', icon: 'pause' };
    case 'journey_resumed':
      return { label: 'Journey resumed', tone: 'brand', icon: 'play' };
    case 'journey_ended':
      return { label: 'Journey ended', tone: 'safe', icon: 'check' };
    case 'risk_changed':
      return {
        label: `Risk state → ${detail('band') ?? 'SAFE'} (score ${count('score') ?? detail('score') ?? 0})`,
        tone:
          detail('band') === 'CRITICAL'
            ? 'critical'
            : detail('band') === 'ALERT'
              ? 'alert'
              : detail('band') === 'WATCH'
                ? 'watch'
                : 'safe',
        icon: 'info',
      };
    case 'risk_zone_entered':
      return { label: 'Entered a map zone flagged for the demo', tone: 'watch', icon: 'pin' };
    case 'late_arrival':
      return { label: 'Past the expected arrival window', tone: 'watch', icon: 'alert' };
    case 'system_note':
    default:
      return { label: detail('note') ?? 'System note', tone: 'neutral', icon: 'info' };
  }
}

/**
 * Tiny pub/sub. The store owns the log; components subscribe for toasts and
 * for guardian live updates.
 */
export class EventBus {
  private listeners = new Set<EventListener>();
  private log: SafetyEvent[] = [];

  emit(event: SafetyEvent): void {
    this.log = [...this.log, event];
    this.listeners.forEach((listener) => listener(event, this.log));
  }

  emitMany(events: SafetyEvent[]): void {
    events.forEach((event) => this.emit(event));
  }

  getLog(): SafetyEvent[] {
    return this.log;
  }

  setLog(events: SafetyEvent[]): void {
    this.log = [...events];
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.log = [];
  }
}

export const eventBus = new EventBus();
