/**
 * SURAKSHA application store.
 *
 * One singleton, one virtual clock, one event log. The store owns:
 *   - the journey state machine (SAFE → WATCH → ALERT → CRITICAL → RESOLVED)
 *   - the Safety Risk Engine assessment for that journey
 *   - the event log both dashboards read from
 *   - the simulated movement + check-in engine ("virtual clock")
 *   - the notification fan-out to the trusted circle
 *
 * The virtual clock (state.now) starts at 10:42 PM on the day the demo runs so
 * the seeded scenario reads exactly like the script, and speeds up with
 * `setSimSpeed` so a judge never has to wait for a real countdown.
 */

import type {
  EvidenceRecord,
  GuardianAlert,
  Incident,
  IncidentOrigin,
  IncidentSeverity,
  Journey,
  RiskBand,
  Role,
  SafePlace,
  SafetyEvent,
  SafetyReport,
  Toast,
  TrustedContact,
  UserProfile,
} from '@/domain/types';
import { EMERGENCY_NUMBER, originMayDial } from '@/domain/types';
import { RISK_WEIGHTS } from '@/domain/riskEngine';
import { presentEvent } from '@/services/eventBus';
import { backend, SCHEMA_VERSION } from '@/services/backend';
import { deliver, type DeliveryReceipt } from '@/services/notifications';
import {
  bandRank,
  evaluateIntents,
  reduceJourney,
  timeProgress,
  type JourneyAction,
} from '@/domain/journeyMachine';
import { bandForScore, guardianActionFor, explainScore } from '@/domain/riskEngine';
import { createJourney, estimatedArrivalAt, type StartJourneyConfig } from '@/domain/journey';
import {
  buildRoutePlan,
  demoStartClock,
  EXPECTED_ROUTE,
  guardianProfileSeed,
  INCIDENT_SEED,
  LESSONS_SEED,
  SAFE_PLACES_SEED,
  SAFETY_REPORTS_SEED,
  TRAVELLER_ID,
  trustedContactsSeed,
  travellerProfileSeed,
} from '@/domain/seed';
import { pointAtProgress, pointInPolygon, pushTrail, RISK_ZONE, polygonCentroid } from '@/domain/geo';
import { makeEvent } from '@/services/eventBus';

export const TICK_MS = 1000;
export const DEMO_SPEEDS = [1, 2, 4, 8] as const;

/**
 * How long a help request waits for the traveller before it escalates to the
 * trusted circle. Short enough to be useful, long enough that "I need help"
 * does not instantly become an alert.
 */
export const HELP_GRACE_MINUTES = 3;

export interface LearningState {
  completed: string[];
  quizScores: Record<string, number>;
}

export interface ExitModeState {
  active: boolean;
  contactId: string;
  contactLabel: string;
  delaySeconds: number;
  startedAt: number;
  ringsAt: number;
  ringing: boolean;
  answered: boolean;
  declined: boolean;
  endedAt: number | null;
  scriptId: string;
}

export interface UiState {
  sosPanelOpen: boolean;
  helpPanelOpen: boolean;
  exitModePanelOpen: boolean;
  checkInPromptOpen: boolean;
  whyScoreOpen: boolean;
  demoPanelOpen: boolean;
}

export interface AppState {
  ready: boolean;
  now: number;
  simSpeed: number;
  role: Role;
  journey: Journey | null;
  events: SafetyEvent[];
  incidents: Incident[];
  contacts: TrustedContact[];
  alerts: GuardianAlert[];
  receipts: DeliveryReceipt[];
  travellerProfile: UserProfile;
  guardianProfile: UserProfile;
  places: SafePlace[];
  reports: SafetyReport[];
  learning: LearningState;
  exitMode: ExitModeState | null;
  activeIncidentId: string | null;
  incidentCounter: number;
  toasts: Toast[];
  ui: UiState;
  durable: boolean;
  /** Bumped by RESET DEMO so screens can re-run entrance animations. */
  demoEpoch: number;
}

type Listener = () => void;

const EXIT_SCRIPTS = [
  "Hey, where are you? I'm waiting outside.",
  "I'm at the main gate — I can see the auto. Come out now.",
  "Two minutes and the shop closes, where are you?",
];

const MAX_EVENTS = 400;

function initialState(): AppState {
  return {
    ready: false,
    now: demoStartClock(),
    simSpeed: 1,
    role: 'traveller',
    journey: null,
    events: [],
    incidents: INCIDENT_SEED.map((i) => ({ ...i, evidence: [...i.evidence], timeline: [...i.timeline] })),
    contacts: trustedContactsSeed.map((c) => ({ ...c, slots: [...c.slots], notifyBy: [...c.notifyBy] })),
    alerts: [],
    receipts: [],
    travellerProfile: { ...travellerProfileSeed },
    guardianProfile: { ...guardianProfileSeed },
    places: SAFE_PLACES_SEED.map((p) => ({ ...p })),
    reports: SAFETY_REPORTS_SEED.map((r) => ({ ...r })),
    learning: { completed: ['ls-1', 'ls-2', 'ls-3'], quizScores: {} },
    exitMode: null,
    activeIncidentId: null,
    incidentCounter: 1042,
    toasts: [],
    ui: {
      sosPanelOpen: false,
      helpPanelOpen: false,
      exitModePanelOpen: false,
      checkInPromptOpen: false,
      whyScoreOpen: false,
      demoPanelOpen: false,
    },
    durable: backend.durable,
    demoEpoch: 0,
  };
}

export class SurakshaStore {
  private state: AppState = initialState();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPersistAt = 0;
  private lastLocationLogAt = 0;
  /** Guards against pinging the same contact twice for the same beat. */
  private dedupe = new Map<string, number>();
  private hydrated = false;

  /* ---------------------------------------------------------------- */
  /* React plumbing                                                   */
  /* ---------------------------------------------------------------- */

  /** Arrow property so it can be passed straight to useSyncExternalStore. */
  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  private update(updater: (state: AppState) => Partial<AppState>): void {
    this.set(updater(this.state));
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  hydrate(): void {
    /*
     * The load itself must happen exactly once — a second pass would overwrite
     * live in-memory state with whatever was last written to storage.
     *
     * The clock, however, has to restart on every mount. React 18 StrictMode
     * (development only) mounts, unmounts and remounts the tree: the discarded
     * mount's cleanup calls stop(), and this guard used to return before
     * start() ran again. The interval stayed dead, so the virtual clock froze —
     * no simulated movement, no check-in countdown, no ETA drift, and the demo
     * controls that ride on a tick never fired. start() is idempotent, so
     * calling it here is always safe.
     */
    if (this.hydrated) {
      this.start();
      return;
    }
    this.hydrated = true;

    // Discard state written by an older build instead of half-reading it.
    const meta = backend.loadMeta();
    if (meta?.version !== SCHEMA_VERSION) {
      backend.reset();
      backend.saveMeta({ version: SCHEMA_VERSION });
    }

    const storedJourney = backend.loadJourney();
    const storedEvents = backend.loadEvents();
    const storedIncidents = backend.loadIncidents();
    const storedContacts = backend.loadContacts();
    const storedAlerts = backend.loadAlerts();
    const storedProfiles = backend.loadProfiles();
    const storedCommunity = backend.loadCommunity();
    const storedLearning = backend.loadLearning<LearningState>();
    const storedRole = backend.loadRole();

    /*
     * The clock is part of the simulation, so an interrupted journey resumes
     * exactly where it stopped rather than jumping to the wall clock (which
     * would make it look hours overdue).
     */
    const now =
      storedJourney && storedJourney.status !== 'ENDED'
        ? Math.max(storedJourney.startedAt, storedJourney.lastPositionAt)
        : demoStartClock();

    this.state = {
      ...this.state,
      ready: true,
      now,
      role: storedRole === 'guardian' ? 'guardian' : 'traveller',
      journey: storedJourney,
      events: storedEvents,
      incidents: storedIncidents.length ? storedIncidents : this.state.incidents,
      contacts: storedContacts ?? this.state.contacts,
      alerts: storedAlerts,
      travellerProfile: storedProfiles?.traveller ?? this.state.travellerProfile,
      guardianProfile: storedProfiles?.guardian ?? this.state.guardianProfile,
      places: storedCommunity?.places ?? this.state.places,
      reports: storedCommunity?.reports ?? this.state.reports,
      learning: storedLearning ?? this.state.learning,
      activeIncidentId: storedJourney?.incidentId ?? null,
      incidentCounter: Math.max(
        1042,
        ...storedIncidents.map((i) => Number(i.code.replace('SRK-', '')) || 0),
      ),
    };

    if (storedJourney?.incidentId) {
      const incident = this.state.incidents.find((i) => i.id === storedJourney.incidentId);
      if (incident && incident.timeline.length === 0) {
        this.hydrateIncidentTimeline(incident.id);
      }
    }

    // Repair references that a previous build left pointing at deleted records.
    this.reconcileIncidentReferences();

    this.listeners.forEach((l) => l());
    this.start();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.trailingPersist) clearTimeout(this.trailingPersist);
    this.trailingPersist = null;
    this.timer = null;
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                      */
  /* ---------------------------------------------------------------- */

  private trailingPersist: ReturnType<typeof setTimeout> | null = null;

  private scheduleTrailingPersist(): void {
    if (this.trailingPersist) return;
    this.trailingPersist = setTimeout(() => {
      this.trailingPersist = null;
      this.persist(true);
    }, 4000);
  }

  /**
   * Writes the latest state straight to storage. Called when the page is being
   * hidden or closed so a refresh never loses the newest check-in or incident.
   */
  flush(): void {
    this.persist(true);
  }

  private persist(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 4000) {
      // Coalesce: make sure the skipped write still lands shortly after.
      this.scheduleTrailingPersist();
      return;
    }
    this.lastPersistAt = now;
    backend.saveJourney(this.state.journey);
    backend.saveEvents(this.state.events);
    backend.saveIncidents(this.state.incidents);
    backend.saveContacts(this.state.contacts);
    backend.saveAlerts(this.state.alerts);
    backend.saveProfiles({
      traveller: this.state.travellerProfile,
      guardian: this.state.guardianProfile,
    });
    backend.saveCommunity({ places: this.state.places, reports: this.state.reports });
    backend.saveLearning(this.state.learning);
    backend.saveRole(this.state.role);
    backend.saveMeta({ version: SCHEMA_VERSION });
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                           */
  /* ---------------------------------------------------------------- */

  private logEvent(
    event: SafetyEvent,
    opts?: { toast?: { title: string; description?: string; tone: Toast['tone']; sticky?: boolean } },
  ): SafetyEvent {
    const events = [...this.state.events, event].slice(-MAX_EVENTS);
    this.set({ events });
    if (opts?.toast) {
      this.pushToast({
        title: opts.toast.title,
        description: opts.toast.description,
        tone: opts.toast.tone,
        sticky: opts.toast.sticky,
      });
    }
    return event;
  }

  private makeJourneyEvent(
    type: SafetyEvent['type'],
    metadata: Record<string, unknown> = {},
    journey?: Journey | null,
    incidentId?: string | null,
  ): SafetyEvent {
    const j = journey ?? this.state.journey;
    return makeEvent({
      type,
      userId: j?.travellerId ?? TRAVELLER_ID,
      journeyId: j?.id ?? null,
      incidentId: incidentId ?? j?.incidentId ?? null,
      timestamp: this.state.now,
      metadata,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Toasts                                                           */
  /* ---------------------------------------------------------------- */

  pushToast(toast: Omit<Toast, 'id'>): void {
    const id = `tst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const next: Toast = { ...toast, id };
    this.set({ toasts: [...this.state.toasts, next] });
    if (!toast.sticky) {
      setTimeout(() => this.dismissToast(id), 6200);
    }
  }

  dismissToast(id: string): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  /* ---------------------------------------------------------------- */
  /* Role + demo mode                                                 */
  /* ---------------------------------------------------------------- */

  setRole(role: Role): void {
    this.set({ role });
    this.persist(true);
  }

  setSimSpeed(speed: number): void {
    this.set({ simSpeed: speed });
  }

  setDemoMode(enabled: boolean): void {
    this.update((s) => ({
      travellerProfile: { ...s.travellerProfile, demoMode: enabled },
      guardianProfile: { ...s.guardianProfile, demoMode: enabled },
    }));
    this.persist(true);
  }

  toggleUi(key: keyof UiState, value?: boolean): void {
    this.update((s) => ({ ui: { ...s.ui, [key]: value ?? !s.ui[key] } }));
  }

  /* ---------------------------------------------------------------- */
  /* Journey lifecycle                                                */
  /* ---------------------------------------------------------------- */

  startJourney(config: StartJourneyConfig): Journey {
    const now = this.state.now;
    const primary = this.state.contacts.find((c) => c.id === config.primaryContactId);
    const journey = createJourney(config, now, this.state.travellerProfile.name);

    this.logEvent(
      makeEvent({
        type: 'journey_started',
        userId: journey.travellerId,
        journeyId: journey.id,
        timestamp: now,
        metadata: {
          destination: journey.destinationLabel,
          origin: journey.originLabel,
          etaMinutes: journey.etaMinutes,
          checkInMinutes: journey.checkInIntervalMinutes,
          guardian: primary?.name ?? 'Primary guardian',
          simulated: true,
        },
      }),
    );

    const notified = this.notifyCircle(journey, {
      title: `Journey started — ${journey.destinationLabel}`,
      body: `${journey.travellerName} left ${journey.originLabel}. ETA ${journey.etaMinutes} min. Check-ins every ${journey.checkInIntervalMinutes} min.`,
      only: [journey.primaryContactId],
      eventType: 'guardian_notified',
    });

    const withNotify: Journey = {
      ...journey,
      guardianNotifiedAt: notified.length ? now : null,
      escalationLevel: 1,
    };

    this.set({
      journey: withNotify,
      ui: { ...this.state.ui, demoPanelOpen: false },
    });
    this.persist(true);
    this.pushToast({
      title: 'Journey started',
      description: `Your Guardian has been notified · ETA ${journey.etaMinutes} min to ${journey.destinationLabel}`,
      tone: 'brand',
    });
    return withNotify;
  }

  private applyAction(action: JourneyAction): Journey | null {
    const journey = this.state.journey;
    if (!journey) return null;
    const now = this.state.now;
    const prevBand = journey.risk.band;
    const next = reduceJourney(journey, action, now);
    this.set({ journey: next });
    this.handleBandChange(prevBand, next, now);
    this.persist(true);
    return next;
  }

  pauseJourney(): void {
    const next = this.applyAction({ type: 'PAUSE' });
    if (!next) return;
    this.logEvent(this.makeJourneyEvent('journey_paused', {}, next), {
      toast: { title: 'Journey paused', description: 'Check-in timer is on hold.', tone: 'neutral' },
    });
  }

  resumeJourney(): void {
    const next = this.applyAction({ type: 'RESUME' });
    if (!next) return;
    this.logEvent(this.makeJourneyEvent('journey_resumed', {}, next), {
      toast: { title: 'Journey resumed', description: 'Your ETA has been shifted by the pause.', tone: 'brand' },
    });
  }

  endJourney(reason: 'arrived' | 'cancelled' = 'arrived'): void {
    const journey = this.state.journey;
    if (!journey) return;
    const next = this.applyAction({ type: 'END' });
    if (!next) return;
    this.logEvent(
      this.makeJourneyEvent('journey_ended', {
        reason,
        resolvedBy: next.resolvedBy ?? 'ended_normally',
      }, next),
      {
        toast: {
          title: reason === 'arrived' ? 'Journey ended' : 'Journey cancelled',
          description:
            next.resolvedBy === 'resolved_after_alert'
              ? 'Recorded as resolved after an alert.'
              : 'Your guardian can see the journey is closed.',
          tone: 'safe',
        },
      },
    );

    if (next.incidentId) {
      this.updateIncident(next.incidentId, (incident) => ({
        ...incident,
        status: 'RESOLVED',
        resolvedAt: this.state.now,
        summary: `${incident.summary} Journey closed by the traveller.`,
      }));
    }
    this.update((s) => ({ ui: { ...s.ui, checkInPromptOpen: false, helpPanelOpen: false } }));
    this.persist(true);
  }

  /** "I'M SAFE" — the traveller confirming the situation is okay. */
  confirmSafe(source: 'home' | 'checkin' | 'deviation' | 'journey' | 'incident'): void {
    const journey = this.state.journey;
    if (!journey) {
      this.pushToast({ title: 'No active journey', description: 'Start a journey to use check-ins.', tone: 'neutral' });
      return;
    }
    const wasRequested = journey.checkIn.state === 'REQUESTED';
    const next = this.applyAction({ type: 'SAFE_CONFIRMED' });
    if (!next) return;

    this.logEvent(
      this.makeJourneyEvent('safe_confirmed', {
        source,
        checkInRequested: wasRequested,
        score: next.risk.score,
        band: next.risk.band,
      }, next),
      {
        toast: {
          title: 'Thanks — recorded as safe',
          description:
            next.risk.score < journey.risk.score
              ? `Risk state moved to ${next.risk.band} (${journey.risk.score} → ${next.risk.score}).`
              : 'Your guardian can see you confirmed.',
          tone: next.risk.band === 'SAFE' ? 'safe' : 'watch',
        },
      },
    );

    if (wasRequested) {
      this.logEvent(this.makeJourneyEvent('checkin_completed', { source }, next));
    }

    // Tell the guardian the situation eased.
    if (bandRank(next.risk.band) < bandRank(journey.risk.band)) {
      this.notifyCircle(next, {
        title: `Safety confirmed — ${next.travellerName}`,
        body: `The traveller confirmed safety. Risk state is now ${next.risk.band} (${next.risk.score}). Earlier signals stay in the timeline.`,
        only: [next.primaryContactId, next.backupContactId],
        eventType: 'system_note',
      });
    }

    // Confirming safety also stands down an open help request: the traveller
    // has told us they are okay, so it must not escalate on a timer.
    const afterConfirm = this.state.journey;
    if (afterConfirm && (afterConfirm.helpRequestedAt || afterConfirm.helpDeadlineAt)) {
      this.set({
        journey: { ...afterConfirm, helpRequestedAt: null, helpDeadlineAt: null },
      });
    }

    this.update((s) => ({
      ui: { ...s.ui, checkInPromptOpen: false, helpPanelOpen: false },
    }));
  }

  /**
   * "I NEED HELP" — opens proportionate options rather than escalating hard.
   *
   * It also opens a grace window. Previously this was a one-shot event: if the
   * traveller asked for help and then got no answer, nothing else happened.
   * Now the request is remembered on the journey and escalates on its own if
   * nobody is reached inside HELP_GRACE_MINUTES.
   */
  requestHelp(via: 'check-in' | 'home' | 'journey' = 'check-in'): void {
    const journey = this.state.journey;
    const now = this.state.now;
    if (journey && journey.status !== 'ENDED') {
      const next: Journey = {
        ...journey,
        helpRequestedAt: now,
        helpDeadlineAt: now + HELP_GRACE_MINUTES * 60_000,
      };
      this.set({ journey: next });
      this.logEvent(
        this.makeJourneyEvent('help_requested', {
          via,
          graceMinutes: HELP_GRACE_MINUTES,
          escalatesAt: next.helpDeadlineAt,
        }, next),
        {
          toast: {
            title: 'Help requested',
            description: `Your circle is watching. If nobody has reached you in ${HELP_GRACE_MINUTES} minutes this escalates on its own.`,
            tone: 'alert',
          },
        },
      );
    } else {
      this.logEvent(this.makeJourneyEvent('help_requested', { via }, journey), {
        toast: {
          title: 'Help requested',
          description: 'Choose how you want to proceed — your guardian is watching.',
          tone: 'alert',
        },
      });
    }
    this.update((s) => ({ ui: { ...s.ui, helpPanelOpen: true, checkInPromptOpen: false } }));
  }

  /**
   * Somebody reached the traveller, or they told us they are okay — close the
   * help grace window without escalating.
   */
  resolveHelpFollowUp(reason: 'acknowledged' | 'confirmed_safe' | 'manual'): void {
    const journey = this.state.journey;
    if (!journey) return;
    if (!journey.helpRequestedAt && !journey.helpDeadlineAt) return;

    this.set({
      journey: { ...journey, helpRequestedAt: null, helpDeadlineAt: null },
    });
    this.logEvent(
      this.makeJourneyEvent('system_note', { note: 'Help follow-up closed', reason }, this.state.journey),
    );
    this.persist(true);
  }

  /**
   * The grace window lapsed with no answer. Escalate the help request to the
   * whole trusted circle and raise an ALERT-severity incident, so the request
   * appears on the guardian side instead of disappearing.
   */
  escalateHelpFollowUp(): void {
    const journey = this.state.journey;
    if (!journey || journey.status === 'ENDED') return;
    if (!journey.helpDeadlineAt) return;
    const now = this.state.now;

    const cleared: Journey = {
      ...journey,
      helpRequestedAt: null,
      helpDeadlineAt: null,
      escalationLevel: Math.max(journey.escalationLevel, 2),
      guardianNotifiedAt: now,
    };
    this.set({ journey: cleared });

    this.logEvent(
      this.makeJourneyEvent('help_requested', {
        via: 'escalation',
        escalated: true,
        waitedMinutes: HELP_GRACE_MINUTES,
      }, cleared),
      {
        toast: {
          title: 'Help request escalated',
          description: 'Nobody reached you in time, so your whole trusted circle has been notified.',
          tone: 'critical',
          sticky: true,
        },
      },
    );

    const incident = this.ensureIncident(
      cleared,
      'ALERT',
      `Help was requested and not answered within ${HELP_GRACE_MINUTES} minutes. Escalated to the trusted circle. No danger has been confirmed.`,
      'passive_signal',
    );

    this.pushAlert(cleared, {
      band: 'ALERT',
      title: `${cleared.travellerName} asked for help`,
      body: `They pressed "I need help" and nobody reached them within ${HELP_GRACE_MINUTES} minutes. Please try to reach them now. No danger has been confirmed.`,
      journeyId: cleared.id,
    });

    this.notifyCircle(cleared, {
      title: `Help requested — ${cleared.travellerName}`,
      body: `${cleared.travellerName} asked for help and did not respond within ${HELP_GRACE_MINUTES} minutes. Incident ${incident.code}. Please try to reach them.`,
      only: cleared.escalationOrder,
      eventType: 'guardian_notified',
      incidentId: incident.id,
      dedupeKey: `help-${incident.id}`,
    });

    this.set({ activeIncidentId: incident.id });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Check-ins                                                        */
  /* ---------------------------------------------------------------- */

  sendCheckInNow(manual = true): void {
    const journey = this.state.journey;
    if (!journey || journey.status === 'ENDED') return;
    const now = this.state.now;
    const next: Journey = {
      ...journey,
      checkIn: {
        ...journey.checkIn,
        state: 'REQUESTED',
        requestedAt: now,
        expiresAt: now + journey.gracePeriodMinutes * 60_000,
      },
    };
    this.set({ journey: next, ui: { ...this.state.ui, checkInPromptOpen: true } });
    this.logEvent(this.makeJourneyEvent('checkin_sent', { manual }, next), {
      toast: {
        title: 'Everything okay?',
        description: `Check-in sent. You have ${journey.gracePeriodMinutes} min of grace time.`,
        tone: 'brand',
      },
    });
  }

  missCheckIn(manual = false): void {
    const journey = this.state.journey;
    if (!journey) return;
    const prevBand = journey.risk.band;
    const next = reduceJourney(journey, { type: 'CHECKIN_MISSED' }, this.state.now);
    this.set({ journey: next, ui: { ...this.state.ui, checkInPromptOpen: false } });

    this.logEvent(
      this.makeJourneyEvent('checkin_missed', {
        gracePeriod: journey.gracePeriodMinutes,
        missedTotal: next.checkIn.missedCount,
        manual,
      }, next),
      {
        toast: {
          title: 'Safety check-in missed',
          description: 'Not a claim about danger — we just could not reach you for a routine check.',
          tone: 'alert',
        },
      },
    );

    this.pushAlert(next, {
      band: next.risk.band,
      title: 'Safety check-in missed',
      body: `${next.travellerName} did not answer the ${formatInterval(next.checkInIntervalMinutes)} check-in within the ${next.gracePeriodMinutes} min grace period. This does not confirm danger.`,
      journeyId: next.id,
    });

    this.notifyCircle(next, {
      title: 'Safety check-in missed',
      body: `${next.travellerName} did not answer a routine check-in. Try a message first — a missed check-in often means a flat battery or no signal.`,
      only: [next.primaryContactId],
      eventType: 'guardian_notified',
      dedupeKey: `miss-${next.id}-${next.checkIn.missedCount}`,
    });

    this.handleBandChange(prevBand, next, this.state.now, { skipAlert: true });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Route deviation                                                  */
  /* ---------------------------------------------------------------- */

  moveOffRoute(reason = 'Demo control: simulated diversion'): void {
    const journey = this.state.journey;
    if (!journey) return;
    const prevBand = journey.risk.band;
    const now = this.state.now;
    const withDeviation = reduceJourney(journey, { type: 'ROUTE_DEVIATION' }, now);
    const next: Journey = {
      ...withDeviation,
      offRouteProgress: 0,
      offRouteSince: now,
      position: { ...withDeviation.route.deviationBranch[0] },
      lastPositionAt: now,
      locationAvailable: true,
    };
    this.set({ journey: next });

    this.logEvent(
      this.makeJourneyEvent('route_deviation', {
        deviationNumber: next.deviationCount,
        reason,
        corridorWidth: next.route.corridorWidth,
      }, next),
      {
        toast: {
          title: 'Route change detected',
          description: 'Your route appears different from the expected path. Everything okay?',
          tone: 'watch',
        },
      },
    );

    this.pushAlert(next, {
      band: next.risk.band,
      title: 'Route deviation detected',
      body: `${next.travellerName} is outside the expected route corridor near ${next.destinationLabel}. Awaiting traveller confirmation.`,
      journeyId: next.id,
    });

    this.notifyCircle(next, {
      title: 'Route deviation detected',
      body: `${next.travellerName} appears to be off the planned route. We have asked them to confirm. No danger has been confirmed.`,
      only: [next.primaryContactId],
      eventType: 'guardian_notified',
    });

    this.handleBandChange(prevBand, next, now, { skipAlert: true });
    this.persist(true);
  }

  /**
   * Demo control: the traveller stops inside the fictional higher-risk zone
   * (+15). The zone is a demonstration device, never a claim about a real place.
   */
  enterRiskZone(): void {
    const journey = this.state.journey;
    if (!journey) return;
    const now = this.state.now;
    const prevBand = journey.risk.band;
    const centre = riskZoneCentre();
    const moved: Journey = {
      ...journey,
      zoneExcursion: true,
      inRiskZone: true,
      position: { ...centre },
      lastPositionAt: now,
      locationAvailable: true,
    };
    const next = reduceJourney(moved, { type: 'TICK' }, now);
    this.set({ journey: next });
    this.logEvent(
      this.makeJourneyEvent('risk_zone_entered', { zone: RISK_ZONE.label, simulated: true }, next),
      {
        toast: {
          title: 'Entered a flagged zone',
          description:
            'This is a fictional demo zone, not a judgement about the area. It adds +15 to the risk score.',
          tone: 'watch',
        },
      },
    );
    this.handleBandChange(prevBand, next, now);
    this.persist(true);
  }

  leaveRiskZone(): void {
    const journey = this.state.journey;
    if (!journey) return;
    const now = this.state.now;
    const routePoint = pointAtProgress(journey.route.expected, journey.progress);
    const next: Journey = {
      ...reduceJourney(
        {
          ...journey,
          zoneExcursion: false,
          inRiskZone: pointInPolygon(routePoint, RISK_ZONE.polygon),
        },
        { type: 'TICK' },
        now,
      ),
      position: routePoint,
      lastPositionAt: now,
    };
    this.set({ journey: next });
    this.logEvent(this.makeJourneyEvent('system_note', { note: 'Left the flagged demo zone' }, next));
    this.persist(true);
  }

  restoreRoute(manual = true): void {
    const journey = this.state.journey;
    if (!journey) return;
    const now = this.state.now;
    const offFor = journey.offRouteSince ? now - journey.offRouteSince : 0;
    const restored = reduceJourney(journey, { type: 'ROUTE_RESTORED' }, now);
    const next: Journey = {
      ...restored,
      offRouteSince: null,
      offRouteAccumulatedMs: journey.offRouteAccumulatedMs + offFor,
      offRouteProgress: 0,
      position: pointAtProgress(restored.route.expected, restored.progress),
      lastPositionAt: now,
    };
    this.set({ journey: next });
    this.logEvent(this.makeJourneyEvent('route_restored', { manual, offRouteSeconds: Math.round(offFor / 1000) }, next));
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* SOS + incidents                                                  */
  /* ---------------------------------------------------------------- */

  triggerSos(source: 'quick_sos' | 'help_panel' | 'demo' = 'quick_sos'): Incident | null {
    const journey = this.state.journey;
    const now = this.state.now;

    if (!journey) {
      this.pushToast({
        title: 'No active journey',
        description: 'SOS needs a journey to attach to. Start one first — you can still call emergency services directly.',
        tone: 'alert',
      });
      return null;
    }

    /*
     * Mark the journey as carrying an explicit SOS, then let the engine derive
     * the score, the band and the reason list. The engine owns the numbers so
     * the explanation and the total can never disagree — it pins the band to
     * CRITICAL and suppresses compounding and recovery credit for an SOS.
     */
    const sosJourney: Journey = {
      ...journey,
      risk: {
        ...journey.risk,
        reasons: [
          ...journey.risk.reasons.filter((r) => r.code !== 'explicit_sos' && r.code !== 'safe_confirmation'),
          {
            code: 'explicit_sos',
            label: 'Explicit distress signal (Quick SOS)',
            delta: RISK_WEIGHTS.explicitSos,
            detail: 'The traveller activated the emergency workflow',
          },
        ],
      },
      escalationLevel: 0,
    };
    const prevBand = journey.risk.band;
    const reassessed = reduceJourney(sosJourney, { type: 'TICK' }, now);
    this.set({ journey: { ...reassessed, status: journey.status } });

    this.logEvent(this.makeJourneyEvent('sos_triggered', { source, simulated: true }, reassessed), {
      toast: {
        title: 'Emergency workflow activated',
        description: 'Your trusted circle is being alerted. SURAKSHA does not contact emergency services for you.',
        tone: 'critical',
        sticky: true,
      },
    });

    const incident = this.ensureIncident(
      reassessed,
      'CRITICAL',
      'Emergency workflow activated by the traveller (Quick SOS).',
      source === 'demo' ? 'demo_control' : 'explicit_sos',
    );
    this.set({ activeIncidentId: incident.id });

    // One fan-out path for alerts, notifications and the risk_changed event.
    this.handleBandChange(prevBand, this.state.journey ?? reassessed, now);
    this.persist(true);
    return incident;
  }

  private nextIncidentCode(): string {
    const next = this.state.incidentCounter + 1;
    this.set({ incidentCounter: next });
    return `SRK-${next}`;
  }

  private ensureIncident(
    journey: Journey,
    severity: IncidentSeverity,
    summary: string,
    origin: IncidentOrigin = 'passive_signal',
  ): Incident {
    const activeIncidentId = journey.incidentId ?? this.state.journey?.incidentId ?? null;
    if (activeIncidentId) {
      const existing = this.state.incidents.find((i) => i.id === activeIncidentId);
      if (existing) {
        // Severity only ever escalates on an open record.
        const rank: Record<IncidentSeverity, number> = { WATCH: 0, ALERT: 1, CRITICAL: 2 };
        if (rank[severity] > rank[existing.severity] && existing.status !== 'RESOLVED') {
          const upgraded: Incident = {
            ...existing,
            severity,
            summary,
            riskScore: journey.risk.score,
            riskReasons: journey.risk.reasons,
            locationLabel: journey.locationAvailable
              ? `${describePosition(journey, this.state.now)} (simulated)`
              : 'Location unavailable — last known position used',
          };
          this.set({ incidents: this.state.incidents.map((i) => (i.id === existing.id ? upgraded : i)) });
          return upgraded;
        }
        return existing;
      }
    }

    const code = this.nextIncidentCode();
    const id = `inc-${code.toLowerCase()}`;
    const primary = this.state.contacts.find((c) => c.id === journey.primaryContactId);
    const backup = this.state.contacts.find((c) => c.id === journey.backupContactId);
    const now = this.state.now;

    const incident: Incident = {
      id,
      code,
      origin,
      journeyId: journey.id,
      travellerId: journey.travellerId,
      travellerName: journey.travellerName,
      createdAt: now,
      updatedAt: now,
      severity,
      status: 'OPEN',
      riskScore: journey.risk.score,
      riskReasons: journey.risk.reasons,
      locationLabel: journey.locationAvailable
        ? `${describePosition(journey, now)} (simulated)`
        : 'Location unavailable — last known position used',
      locationAvailable: journey.locationAvailable,
      summary,
      guardianNotifiedAt: null,
      guardianAcknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      evidence: [],
      timeline: [],
      escalationOrder: [primary?.id, backup?.id].filter(Boolean) as string[],
      handoff: {
        emergencyServicesContacted: false,
        note: 'SURAKSHA has alerted your trusted circle. It does not contact or dispatch emergency services, and it never claims to know whether you are in danger.',
        localEmergencyNumberLabel: `Emergency number ${EMERGENCY_NUMBER}`,
        /*
         * The dialable number is only ever attached to a traveller-initiated
         * record. A passively detected signal must not surface something the
         * traveller can dial — see EMERGENCY_NUMBER_ORIGINS.
         */
        emergencyNumber: originMayDial(origin) ? EMERGENCY_NUMBER : undefined,
        emergencyNumberDialledAt: null,
      },
    };

    this.set({
      incidents: [incident, ...this.state.incidents],
      journey: { ...journey, incidentId: id },
    });

    this.logEvent(
      makeEvent({
        type: 'incident_created',
        userId: journey.travellerId,
        journeyId: journey.id,
        incidentId: id,
        timestamp: now,
        metadata: { code, severity, score: journey.risk.score },
      }),
      {
        toast: {
          title: `Incident ${code} created`,
          description: `Severity ${severity}. Your trusted circle has the details.`,
          tone: 'critical',
        },
      },
    );

    return incident;
  }

  /**
   * Escalate to the whole trusted circle, in order, with copy that matches the
   * band. CRITICAL is an explicit SOS; ALERT is "signals stacked up".
   */
  private escalateToCircle(journey: Journey, incident: Incident): void {
    const now = this.state.now;
    const critical = journey.risk.band === 'CRITICAL';

    const message = critical
      ? {
          title: `SOS — ${journey.travellerName}`,
          body: `${journey.travellerName} activated Quick SOS near ${journey.destinationLabel}. Incident ${incident.code} · risk ${journey.risk.score}. Open the Guardian Dashboard now.`,
          dedupeKey: `sos-${incident.id}`,
        }
      : {
          title: `Multiple safety signals — ${journey.travellerName}`,
          body: `${journey.travellerName}: ${journey.risk.headline} Incident ${incident.code} · risk ${journey.risk.score}. Please acknowledge and try to reach them. No danger has been confirmed.`,
          dedupeKey: `alert-${incident.id}`,
        };

    this.notifyCircle(journey, {
      title: message.title,
      body: message.body,
      only: journey.escalationOrder,
      eventType: 'guardian_notified',
      incidentId: incident.id,
      dedupeKey: message.dedupeKey,
    });

    this.set({
      journey: {
        ...(this.state.journey ?? journey),
        guardianNotifiedAt: now,
        escalationLevel: critical ? 3 : 2,
      },
    });
    this.updateIncident(incident.id, (i) => ({
      ...i,
      guardianNotifiedAt: i.guardianNotifiedAt ?? now,
      riskScore: journey.risk.score,
      riskReasons: journey.risk.reasons,
    }));
  }

  private hydrateIncidentTimeline(incidentId: string): void {
    const timeline = this.state.events.filter(
      (e) => e.incidentId === incidentId || (e.journeyId && e.journeyId === this.state.journey?.id),
    );
    this.updateIncident(incidentId, (i) => ({ ...i, timeline }));
  }

  updateIncident(id: string, updater: (incident: Incident) => Incident): void {
    this.set({
      incidents: this.state.incidents.map((i) => (i.id === id ? { ...updater(i), updatedAt: this.state.now } : i)),
    });
  }

  attachEvidence(record: EvidenceRecord): void {
    const incidentId = this.state.activeIncidentId;
    if (!incidentId) {
      this.pushToast({ title: 'No open incident', description: 'Evidence attaches to an incident record.', tone: 'neutral' });
      return;
    }
    this.updateIncident(incidentId, (i) => ({ ...i, evidence: [record, ...i.evidence] }));
    this.logEvent(
      makeEvent({
        type: 'evidence_attached',
        userId: this.state.travellerProfile.id,
        journeyId: this.state.journey?.id ?? null,
        incidentId,
        timestamp: this.state.now,
        metadata: { fileName: record.fileName, sha256: record.sha256, hashMethod: record.hashMethod },
      }),
      {
        toast: {
          title: 'Evidence attached',
          description: 'Integrity hash generated on this device. Nothing was uploaded.',
          tone: 'neutral',
        },
      },
    );
    this.persist(true);
  }

  removeEvidence(evidenceId: string): void {
    const incidentId = this.state.activeIncidentId;
    if (!incidentId) return;
    this.updateIncident(incidentId, (i) => ({
      ...i,
      evidence: i.evidence.filter((e) => e.id !== evidenceId),
    }));
    this.pushToast({ title: 'Evidence deleted', description: 'Removed from this device.', tone: 'neutral' });
    this.persist(true);
  }

  deleteIncident(incidentId: string): void {
    const incident = this.state.incidents.find((i) => i.id === incidentId);
    this.set({
      incidents: this.state.incidents.filter((i) => i.id !== incidentId),
      activeIncidentId: this.state.activeIncidentId === incidentId ? null : this.state.activeIncidentId,
      events: this.state.events.filter((e) => e.incidentId !== incidentId),
      // Do not leave the journey pointing at a record that no longer exists —
      // that dangling id is what made "Open incident" navigate into nothing.
      journey: this.state.journey
        ? { ...this.state.journey, incidentId: this.state.journey.incidentId === incidentId ? null : this.state.journey.incidentId }
        : null,
      alerts: this.state.alerts.map((a) => (a.incidentId === incidentId ? { ...a, incidentId: null } : a)),
    });
    this.pushToast({
      title: `Incident ${incident?.code ?? ''} deleted`.trim(),
      description: 'The record and its evidence were removed from this device.',
      tone: 'neutral',
    });
    this.persist(true);
  }

  /**
   * Repairs references left dangling by older builds — a journey or alert whose
   * `incidentId` points at a record that is no longer in state. Without this,
   * state persisted before the fix keeps navigating to a missing incident.
   */
  private reconcileIncidentReferences(): void {
    const known = new Set(this.state.incidents.map((i) => i.id));
    const journey = this.state.journey;
    const journeyDangles = Boolean(journey?.incidentId && !known.has(journey.incidentId));
    const alertsDangle = this.state.alerts.some((a) => a.incidentId && !known.has(a.incidentId));
    const activeDangles = Boolean(this.state.activeIncidentId && !known.has(this.state.activeIncidentId));

    if (!journeyDangles && !alertsDangle && !activeDangles) return;

    this.state = {
      ...this.state,
      journey: journeyDangles && journey ? { ...journey, incidentId: null } : journey,
      activeIncidentId: activeDangles ? null : this.state.activeIncidentId,
      alerts: alertsDangle
        ? this.state.alerts.map((a) => (a.incidentId && !known.has(a.incidentId) ? { ...a, incidentId: null } : a))
        : this.state.alerts,
    };
  }

  /**
   * Records that the traveller pressed the dial affordance on an explicit-SOS
   * record. SURAKSHA did not place the call and does not know whether it
   * connected — the timeline records only that the traveller opened the
   * dialler themselves.
   */
  recordEmergencyDialAttempt(incidentId?: string): void {
    const id = incidentId ?? this.state.activeIncidentId ?? this.state.journey?.incidentId ?? null;
    if (!id) return;
    const incident = this.state.incidents.find((i) => i.id === id);
    if (!incident || !originMayDial(incident.origin)) return;

    const now = this.state.now;
    this.updateIncident(id, (i) => ({
      ...i,
      handoff: { ...i.handoff, emergencyNumberDialledAt: now },
    }));
    this.logEvent(
      makeEvent({
        type: 'system_note',
        userId: this.state.travellerProfile.id,
        journeyId: this.state.journey?.id ?? null,
        incidentId: id,
        timestamp: now,
        metadata: {
          note: `Traveller opened the dialler for ${EMERGENCY_NUMBER} themselves`,
          placedBySuraksha: false,
          simulated: true,
        },
      }),
    );
    this.persist(true);
  }

  resolveIncident(incidentId: string): void {
    this.updateIncident(incidentId, (i) => ({
      ...i,
      status: 'RESOLVED',
      resolvedAt: this.state.now,
    }));
    if (this.state.journey?.incidentId === incidentId) {
      const next = reduceJourney(this.state.journey, { type: 'END' }, this.state.now);
      this.set({ journey: next });
    }
    this.pushToast({ title: 'Incident resolved', description: 'Timeline and evidence are retained.', tone: 'safe' });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Guardian                                                         */
  /* ---------------------------------------------------------------- */

  acknowledgeAlert(alertId: string): void {
    const alert = this.state.alerts.find((a) => a.id === alertId);
    if (!alert) return;
    const now = this.state.now;
    const guardianName = this.state.guardianProfile.name;
    // Alerts raised before the record existed still resolve to the journey's incident.
    const incidentId = alert.incidentId ?? this.state.journey?.incidentId ?? null;

    this.set({
      alerts: this.state.alerts.map((a) =>
        a.id === alertId
          ? { ...a, acknowledgedAt: now, acknowledgedBy: guardianName, read: true, incidentId: incidentId ?? a.incidentId }
          : a,
      ),
    });

    if (incidentId) {
      this.updateIncident(incidentId, (i) => ({
        ...i,
        status: i.status === 'RESOLVED' ? 'RESOLVED' : 'ACKNOWLEDGED',
        guardianAcknowledgedAt: now,
        acknowledgedBy: guardianName,
      }));
    }
    if (this.state.journey) {
      this.set({ journey: { ...this.state.journey, guardianAcknowledgedAt: now } });
    }

    this.logEvent(
      makeEvent({
        type: 'guardian_acknowledged',
        userId: this.state.guardianProfile.id,
        journeyId: this.state.journey?.id ?? null,
        incidentId,
        timestamp: now,
        metadata: { contact: guardianName, alertId },
      }),
      {
        toast: {
          title: 'Alert acknowledged',
          description: `${guardianName} is responding. Added to the timeline.`,
          tone: 'brand',
        },
      },
    );
    this.persist(true);
  }

  markAlertsRead(): void {
    this.set({ alerts: this.state.alerts.map((a) => ({ ...a, read: true })) });
  }

  updateGuardianProfile(patch: Partial<UserProfile>): void {
    this.set({ guardianProfile: { ...this.state.guardianProfile, ...patch } });
    this.persist(true);
  }

  private pushAlert(
    journey: Journey,
    input: { band: RiskBand; title: string; body: string; journeyId: string },
  ): GuardianAlert {
    const id = `alr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const alert: GuardianAlert = {
      id,
      journeyId: input.journeyId,
      incidentId: input.journeyId === journey.id ? journey.incidentId : journey.incidentId,
      band: input.band,
      title: input.title,
      body: input.body,
      createdAt: this.state.now,
      acknowledgedAt: null,
      acknowledgedBy: null,
      read: false,
    };
    this.set({ alerts: [alert, ...this.state.alerts] });
    return alert;
  }

  private notifyCircle(
    journey: Journey,
    input: {
      title: string;
      body: string;
      only: string[];
      eventType: SafetyEvent['type'];
      incidentId?: string;
      /** Suppresses an identical notification sent in the last 90 virtual seconds. */
      dedupeKey?: string;
    },
  ): DeliveryReceipt[] {
    if (input.dedupeKey) {
      const sentAt = this.dedupe.get(input.dedupeKey);
      if (sentAt !== undefined && this.state.now - sentAt < 90_000) return [];
      this.dedupe.set(input.dedupeKey, this.state.now);
    }

    const receipts = deliver({
      contacts: this.state.contacts,
      title: input.title,
      body: input.body,
      only: input.only.filter(Boolean),
      // The store owns the clock, so receipts share the timeline they appear in.
      at: this.state.now,
    });

    this.set({ receipts: [...receipts, ...this.state.receipts].slice(0, 60) });

    receipts.forEach((receipt, index) => {
      this.logEvent(
        makeEvent({
          type: input.eventType,
          userId: journey.travellerId,
          journeyId: journey.id,
          incidentId: input.incidentId ?? journey.incidentId,
          timestamp: this.state.now + index, // keep ordering stable for the timeline
          metadata: {
            contact: receipt.contactName,
            channel: receipt.channel,
            status: receipt.status,
            title: input.title,
          },
        }),
      );
    });

    return receipts;
  }

  /* ---------------------------------------------------------------- */
  /* Band changes → alerts, notifications, incidents                  */
  /* ---------------------------------------------------------------- */

  private handleBandChange(
    prevBand: RiskBand,
    next: Journey,
    now: number,
    opts?: { skipAlert?: boolean },
  ): void {
    if (prevBand === next.risk.band) return;

    const rising = bandRank(next.risk.band) > bandRank(prevBand);

    this.logEvent(
      makeEvent({
        type: 'risk_changed',
        userId: next.travellerId,
        journeyId: next.id,
        incidentId: next.incidentId,
        timestamp: now,
        metadata: {
          band: next.risk.band,
          previous: prevBand,
          score: next.risk.score,
          reasons: next.risk.reasons.map((r) => `${r.delta > 0 ? '+' : ''}${r.delta} ${r.label}`).join('; '),
        },
      }),
    );

    // Incidents are created by the *store*, at ALERT and above, before the alert
    // card is written so every alert is linked to the record it belongs to.
    let incident = next.incidentId ? this.state.incidents.find((i) => i.id === next.incidentId) ?? null : null;
    if (next.risk.band === 'ALERT') {
      incident = this.ensureIncident(
        next,
        'ALERT',
        'Multiple safety signals detected from passively detected events. No danger has been confirmed.',
        'passive_signal',
      );
    } else if (next.risk.band === 'CRITICAL') {
      // An explicit SOS is normally recorded by triggerSos(), which owns the
      // incident origin. Reaching CRITICAL from passive signals is impossible
      // (the ceiling holds at 74), so this fails closed as a passive record.
      incident = this.ensureIncident(
        next,
        'CRITICAL',
        'Emergency workflow activated. Explicit SOS signal received from the traveller.',
        'passive_signal',
      );
    }

    const action = guardianActionFor(next.risk.band);
    if (!opts?.skipAlert && rising) {
      // Read the journey back from state so the alert carries the incident id
      // created a few lines above.
      const linked = this.state.journey ?? next;
      this.pushAlert(linked, {
        band: linked.risk.band,
        title: action.title,
        body: `${action.body} Score ${linked.risk.score}. ${explainScore(linked.risk)}`,
        journeyId: linked.id,
      });
    }

    if (next.risk.band === 'ALERT' || next.risk.band === 'CRITICAL') {
      if (incident) {
        this.escalateToCircle(next, incident);
        this.set({ activeIncidentId: incident.id });
      }
    } else if (next.risk.band === 'WATCH' && rising) {
      this.notifyCircle(next, {
        title: 'Watch — a safety signal was detected',
        body: `${next.travellerName}: ${next.risk.headline} Score ${next.risk.score}. No action required yet — we will tell you if it escalates.`,
        only: [next.primaryContactId],
        eventType: 'guardian_notified',
        dedupeKey: `watch-${next.id}`,
      });
      this.set({
        journey: this.state.journey
          ? { ...this.state.journey, escalationLevel: Math.max(1, this.state.journey.escalationLevel) }
          : null,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Exit mode                                                        */
  /* ---------------------------------------------------------------- */

  startExitMode(input: { delaySeconds: number; contactId: string }): void {
    const now = this.state.now;
    const contact = this.state.contacts.find((c) => c.id === input.contactId);
    const label = contact?.name ?? 'Incoming call';
    const exit: ExitModeState = {
      active: true,
      contactId: input.contactId,
      contactLabel: label,
      delaySeconds: input.delaySeconds,
      startedAt: now,
      ringsAt: now + input.delaySeconds * 1000,
      ringing: false,
      answered: false,
      declined: false,
      endedAt: null,
      scriptId: EXIT_SCRIPTS[Math.floor(Math.random() * EXIT_SCRIPTS.length)],
    };

    this.set({ exitMode: exit });
    this.logEvent(this.makeJourneyEvent('exit_mode_started', {
      contact: label,
      delaySeconds: input.delaySeconds,
      simulated: true,
    }), {
      toast: {
        title: 'Exit Mode armed',
        description: `Simulated call from ${label} in ${input.delaySeconds < 60 ? `${input.delaySeconds} seconds` : `${Math.round(input.delaySeconds / 60)} minute(s)`}.`,
        tone: 'brand',
      },
    });
    this.persist(true);
  }

  answerExitCall(): void {
    const exit = this.state.exitMode;
    if (!exit) return;
    this.set({ exitMode: { ...exit, answered: true } });
    this.logEvent(
      this.makeJourneyEvent('exit_mode_call_answered', {
        contact: exit.contactLabel,
        simulated: true,
        script: exit.scriptId,
      }),
      {
        toast: {
          title: 'Simulated call answered',
          description: 'This is a SurAKSHA Exit Mode call — no real telephony is used.',
          tone: 'brand',
        },
      },
    );
  }

  declineExitCall(): void {
    const exit = this.state.exitMode;
    if (!exit) return;
    this.set({ exitMode: { ...exit, declined: true, ringing: false } });
  }

  endExitMode(): void {
    const exit = this.state.exitMode;
    if (!exit) return;
    this.set({ exitMode: { ...exit, active: false, ringing: false, endedAt: this.state.now } });
    this.update((s) => ({ ui: { ...s.ui, exitModePanelOpen: false } }));
    this.pushToast({
      title: 'Exit Mode closed',
      description: 'Nothing about the simulated call was recorded to your trusted circle.',
      tone: 'neutral',
    });
  }

  /* ---------------------------------------------------------------- */
  /* Trusted circle                                                   */
  /* ---------------------------------------------------------------- */

  addContact(contact: Omit<TrustedContact, 'id' | 'isDemoFixture'>): TrustedContact {
    const created: TrustedContact = {
      ...contact,
      id: `ct-${Date.now().toString(36)}`,
      notifyBy: contact.notifyBy.length ? contact.notifyBy : ['push'],
      isDemoFixture: false,
    };
    this.set({ contacts: [...this.state.contacts, created] });
    this.pushToast({ title: `${created.name} added`, description: 'Added to your Trusted Circle.', tone: 'brand' });
    this.persist(true);
    return created;
  }

  updateContact(id: string, patch: Partial<TrustedContact>): void {
    this.set({ contacts: this.state.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    this.persist(true);
  }

  removeContact(id: string): void {
    const contact = this.state.contacts.find((c) => c.id === id);
    this.set({ contacts: this.state.contacts.filter((c) => c.id !== id) });
    this.pushToast({ title: `${contact?.name ?? 'Contact'} removed`, tone: 'neutral' });
    this.persist(true);
  }

  setContactSlot(id: string, slot: 'primary' | 'backup'): void {
    this.set({
      contacts: this.state.contacts.map((c) => {
        if (c.id === id) {
          return { ...c, slots: Array.from(new Set([...c.slots, slot])) };
        }
        return { ...c, slots: c.slots.filter((s) => s !== slot) };
      }),
    });
    this.persist(true);
  }

  clearContactSlot(slot: 'primary' | 'backup'): void {
    this.set({
      contacts: this.state.contacts.map((c) => ({ ...c, slots: c.slots.filter((s) => s !== slot) })),
    });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Profile + settings                                               */
  /* ---------------------------------------------------------------- */

  updateTravellerProfile(patch: Partial<UserProfile>): void {
    this.set({ travellerProfile: { ...this.state.travellerProfile, ...patch } });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Community                                                        */
  /* ---------------------------------------------------------------- */

  confirmReport(id: string): void {
    this.set({
      reports: this.state.reports.map((r) =>
        r.id === id
          ? { ...r, confirms: r.confirms + (r.confirmedByMe ? -1 : 1), confirmedByMe: !r.confirmedByMe }
          : r,
      ),
    });
    this.persist(true);
  }

  upvoteReport(id: string): void {
    this.set({
      reports: this.state.reports.map((r) =>
        r.id === id ? { ...r, upvotes: r.upvotes + (r.upvotedByMe ? -1 : 1), upvotedByMe: !r.upvotedByMe } : r,
      ),
    });
    this.persist(true);
  }

  addReport(input: { title: string; category: SafetyReport['category']; locationLabel: string; note?: string }): void {
    this.set({
      reports: [
        {
          id: `sr-${Date.now().toString(36)}`,
          title: input.title,
          category: input.category,
          locationLabel: input.locationLabel,
          createdAt: this.state.now,
          confirms: 0,
          upvotes: 0,
          confirmedByMe: false,
          upvotedByMe: false,
          status: 'open',
          note: input.note,
        },
        ...this.state.reports,
      ],
    });
    this.pushToast({
      title: 'Report submitted',
      description: 'No personal details or live locations are attached.',
      tone: 'brand',
    });
    this.persist(true);
  }

  togglePlaceOpen(id: string): void {
    this.set({ places: this.state.places.map((p) => (p.id === id ? { ...p, openNow: !p.openNow } : p)) });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Learning                                                         */
  /* ---------------------------------------------------------------- */

  completeLesson(lessonId: string, score: { correct: number; total: number }): void {
    const completed = Array.from(new Set([...this.state.learning.completed, lessonId]));
    this.set({
      learning: {
        completed,
        quizScores: { ...this.state.learning.quizScores, [lessonId]: score.correct },
      },
    });
    this.pushToast({
      title: 'Lesson completed',
      description: `${score.correct}/${score.total} quiz questions correct · ${completed.length}/${LESSONS_SEED.length} lessons done.`,
      tone: 'safe',
    });
    this.persist(true);
  }

  resetLearning(): void {
    this.set({ learning: { completed: [], quizScores: {} } });
    this.persist(true);
  }

  /* ---------------------------------------------------------------- */
  /* Simulation engine                                                */
  /* ---------------------------------------------------------------- */

  private tick(): void {
    const speed = this.state.simSpeed;
    const dt = TICK_MS * speed;
    const now = this.state.now + dt;
    const journey = this.state.journey;
    let nextJourney = journey;
    const newEvents: SafetyEvent[] = [];

    if (journey && journey.status === 'ACTIVE') {
      const prevBand = journey.risk.band;
      // Advanced past the band a check-in miss already handled, so the fan-out
      // at the end of the tick never notifies twice.
      let prevBandForFinalFanout = prevBand;
      const plannedDuration = Math.max(60_000, journey.expectedArrivalAt - journey.startedAt);
      const rate = dt / plannedDuration;

      let progress = journey.progress;
      let offRouteProgress = journey.offRouteProgress;
      let position = journey.position;
      let offRouteSince = journey.offRouteSince;

      if (journey.zoneExcursion) {
        // Stopped inside the demo zone: progress and ETA are frozen on purpose.
        position = riskZoneCentre();
      } else if (journey.deviationActive) {
        offRouteProgress = Math.min(1, offRouteProgress + rate * 0.85);
        position = pointAtProgress(journey.route.deviationBranch, offRouteProgress);
      } else {
        progress = Math.min(1, progress + rate);
        position = pointAtProgress(journey.route.expected, progress);
      }

      const travelled = pushTrail(journey.route.travelled, position);
      const inRiskZone = journey.zoneExcursion || pointInPolygon(position, RISK_ZONE.polygon);

      nextJourney = {
        ...journey,
        progress,
        offRouteProgress,
        position,
        offRouteSince,
        inRiskZone,
        route: { ...journey.route, travelled },
        lastPositionAt: now,
      };

      if (inRiskZone && !journey.inRiskZone) {
        newEvents.push(
          makeEvent({
            type: 'risk_zone_entered',
            userId: nextJourney.travellerId,
            journeyId: nextJourney.id,
            timestamp: now,
            metadata: { zone: RISK_ZONE.label },
          }),
        );
      }

      // Re-assess on every tick so timing-based signals stay live.
      const wasOnTime = journey.lateMinutes === 0;
      nextJourney = reduceJourney(nextJourney, { type: 'TICK' }, now);
      if (wasOnTime && nextJourney.lateMinutes > 0) {
        newEvents.push(
          makeEvent({
            type: 'late_arrival',
            userId: nextJourney.travellerId,
            journeyId: nextJourney.id,
            timestamp: now,
            metadata: { plannedArrival: journey.expectedArrivalAt, minutesLate: Math.round(nextJourney.lateMinutes) },
          }),
        );
      }

      // Derived intents: check-in requests, misses, escalation, lateness.
      const intents = evaluateIntents(nextJourney, now);
      for (const intent of intents) {
        if (intent.kind === 'request_checkin') {
          nextJourney = reduceJourney(nextJourney, { type: 'CHECKIN_DUE' }, now);
          newEvents.push(
            makeEvent({
              type: 'checkin_sent',
              userId: nextJourney.travellerId,
              journeyId: nextJourney.id,
              timestamp: now,
              metadata: { manual: false, gracePeriod: nextJourney.gracePeriodMinutes },
            }),
          );
          this.set({ ui: { ...this.state.ui, checkInPromptOpen: true } });
        }
        if (intent.kind === 'miss_checkin') {
          // missCheckIn() runs its own alert/notification fan-out, so advance the
          // comparison band to keep the final handleBandChange() a no-op.
          this.set({ journey: nextJourney });
          this.missCheckIn(false);
          nextJourney = this.state.journey ?? nextJourney;
          prevBandForFinalFanout = nextJourney.risk.band;
        }
        if (intent.kind === 'escalate_help') {
          /*
           * This runs *inside* the ACTIVE branch, before the set()/return below.
           * Anything after that return never executes for an active journey.
           * escalateHelpFollowUp() writes to the store itself, so the journey
           * must be re-read afterwards — otherwise the branch's own set() would
           * clobber the escalation with a stale object.
           */
          this.set({ journey: nextJourney });
          this.escalateHelpFollowUp();
          nextJourney = this.state.journey ?? nextJourney;
          prevBandForFinalFanout = nextJourney.risk.band;
        }
      }

      // Periodic location pings (every ~5 virtual seconds).
      if (now - this.lastLocationLogAt >= 5000) {
        this.lastLocationLogAt = now;
        newEvents.push(
          makeEvent({
            type: 'location_updated',
            userId: nextJourney.travellerId,
            journeyId: nextJourney.id,
            timestamp: now,
            metadata: {
              position: `${Math.round(position.x)}, ${Math.round(position.y)}`,
              deviationActive: String(nextJourney.deviationActive),
              simulated: true,
            },
          }),
        );
      }

      this.set({ journey: nextJourney, now });
      newEvents.forEach((e) => this.logEvent(e));
      this.handleBandChange(prevBandForFinalFanout, nextJourney, now);
      // Exit Mode is armed *during* a journey, so it has to advance here too —
      // before the return, not after it.
      this.advanceExitMode(now);
      this.persist();
      return;
    }

    this.advanceExitMode(now);

    this.set({ now });
    this.persist();
  }

  /**
   * Advances the simulated Exit Mode call.
   *
   * Runs on every tick, with or without a journey. This used to sit after the
   * active-journey early return, so a call armed mid-journey counted down to
   * zero and then never rang — which is the only situation a traveller actually
   * uses Exit Mode in.
   */
  private advanceExitMode(now: number): void {
    const exit = this.state.exitMode;
    if (!exit?.active) return;

    if (!exit.ringing && !exit.answered && !exit.declined && now >= exit.ringsAt) {
      this.set({ exitMode: { ...exit, ringing: true } });
      return;
    }

    if (exit.ringing && now >= exit.ringsAt + 45_000) {
      // Missed simulated call — reset so the demo can try again.
      this.set({ exitMode: { ...exit, active: false, ringing: false } });
      this.pushToast({
        title: 'Simulated call ended',
        description: 'Nobody answered. Press START EXIT to run it again.',
        tone: 'neutral',
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Demo controls                                                    */
  /* ---------------------------------------------------------------- */

  /** One-tap scenario used by judges: starts the canonical 10:42 PM journey. */
  startCanonicalJourney(): Journey {
    const primary = this.state.contacts.find((c) => c.slots.includes('primary'));
    const backup = this.state.contacts.find((c) => c.slots.includes('backup'));
    const now = this.state.now;
    return this.startJourney({
      originLabel: this.state.travellerProfile.campusLabel,
      destinationLabel: this.state.travellerProfile.homeLabel,
      expectedArrivalAt: now + 30 * 60_000,
      etaMinutes: 30,
      checkInIntervalMinutes: 10,
      gracePeriodMinutes: 2,
      primaryContactId: primary?.id ?? trustedContactsSeed[0].id,
      backupContactId: backup?.id ?? trustedContactsSeed[1].id,
      routePoints: EXPECTED_ROUTE.map((p) => ({ ...p })),
      // First check-in after 60 virtual seconds so the demo runs without waiting.
      demoPacing: true,
    });
  }

  /**
   * Demo control: drop or restore the simulated position feed.
   *
   * Losing location is a real signal (+25), so this has to re-assess the
   * journey rather than only flipping a boolean. Previously the flag changed
   * and the score did not move at all.
   */
  setLocationAvailable(available: boolean): void {
    const journey = this.state.journey;
    if (!journey) return;
    const now = this.state.now;
    const prevBand = journey.risk.band;

    // Push the last-known timestamp back so restoring the feed clears staleness.
    const next = reduceJourney(
      { ...journey, locationAvailable: available, lastPositionAt: available ? now : journey.lastPositionAt },
      { type: 'TICK' },
      now,
    );
    this.set({ journey: next });

    this.logEvent(
      this.makeJourneyEvent('system_note', {
        note: available ? 'Location feed restored' : 'Location feed lost — last known position in use',
        simulated: true,
        score: next.risk.score,
      }, next),
      {
        toast: {
          title: available ? 'Location restored' : 'Location unavailable',
          description: available
            ? 'Your guardian can see your position again.'
            : `Using the last known position. This adds +${RISK_WEIGHTS.locationLost} to the risk score. Your guardian sees the same.`,
          tone: available ? 'safe' : 'watch',
        },
      },
    );

    this.handleBandChange(prevBand, next, now);
    this.persist(true);
  }

  /** Force a natural-feeling ETA slip without waiting for real time. */
  simulateEtaSlip(minutes: number): void {
    const journey = this.state.journey;
    if (!journey) return;
    const now = this.state.now;
    const prevBand = journey.risk.band;
    const shortened: Journey = {
      ...journey,
      expectedArrivalAt: journey.expectedArrivalAt - minutes * 60_000,
      expectedArrivalAdjusted: true,
    };
    const next = reduceJourney(shortened, { type: 'TICK' }, now);
    this.set({ journey: next });
    this.pushToast({
      title: `Planned arrival moved ${minutes} min earlier`,
      description: 'This is the demo standing in for a delayed start or a slower route.',
      tone: 'watch',
    });
    this.handleBandChange(prevBand, next, now);
    this.persist(true);
  }

  resetDemo(): void {
    backend.reset();
    const fresh = initialState();
    this.state = {
      ...fresh,
      ready: true,
      role: this.state.role,
      demoEpoch: this.state.demoEpoch + 1,
      durable: backend.durable,
    };
    this.listeners.forEach((l) => l());
    this.pushToast({
      title: 'Demo reset',
      description: 'Journey, events, alerts and incidents are back to the seeded state.',
      tone: 'brand',
    });
    this.persist(true);
  }

  /** Clears only the live journey, keeping incident history. */
  clearJourney(): void {
    this.set({
      journey: null,
      activeIncidentId: null,
      exitMode: null,
      ui: { ...this.state.ui, checkInPromptOpen: false, helpPanelOpen: false, sosPanelOpen: false },
    });
    this.persist(true);
  }
}

function formatInterval(minutes: number): string {
  return `${minutes}-minute`;
}

export function describePosition(journey: Journey, now: number): string {
  const zone = pointInPolygon(journey.position, RISK_ZONE.polygon);
  if (zone) return `${RISK_ZONE.label} (simulated)`;
  if (journey.deviationActive) return 'Off the planned corridor, near the Ring Road service lane (simulated)';
  const pct = Math.round(Math.min(1, journey.progress || timeProgress(journey, now)) * 100);
  return `${pct}% of the way to ${journey.destinationLabel} (simulated)`;
}

export function riskZoneCentre() {
  return polygonCentroid(RISK_ZONE.polygon);
}

export function bandFromScore(score: number): RiskBand {
  return bandForScore(score);
}

export function journeyPlannedArrival(journey: Journey, now: number): number {
  return estimatedArrivalAt(journey, now);
}

export function eventLabel(event: SafetyEvent): string {
  return presentEvent(event).label;
}

export function buildDefaultRoute(): ReturnType<typeof buildRoutePlan> {
  return buildRoutePlan(EXPECTED_ROUTE);
}
