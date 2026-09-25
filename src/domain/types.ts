/**
 * SURAKSHA — domain model.
 *
 * The product is modelled around an append-only event log plus two derived
 * things: the risk assessment (explainable, deterministic) and the journey
 * state machine. Nothing in here claims to determine that a person is unsafe.
 */

export type Role = 'traveller' | 'guardian';

/* ------------------------------------------------------------------ */
/* Emergency contact                                                   */
/* ------------------------------------------------------------------ */

/**
 * The one and only place the emergency number is written down.
 *
 * It used to be duplicated as a literal inside several copy strings, which
 * meant a passive signal could end up next to a dialable number the traveller
 * never asked for. Everything that needs to show it imports this constant, and
 * only an *explicit* SOS surface is allowed to render it as a `tel:` link.
 */
export const EMERGENCY_NUMBER = '112';

/** The only origins allowed to surface a dialable emergency number. */
export const EMERGENCY_NUMBER_ORIGINS = ['explicit_sos', 'demo_control'] as const;

/**
 * How an incident came to exist. This gates the emergency-call affordance: only
 * a traveller-initiated record may surface a dialable number. A passively
 * detected signal can never reach it.
 *
 * `demo_control` is the demo panel standing in for the traveller pressing the
 * button, so it is deliberately treated as traveller-initiated.
 */
export type IncidentOrigin = 'explicit_sos' | 'passive_signal' | 'demo_control';

/**
 * Fails closed: an incident with no recorded origin (persisted by an older
 * build) does not get a dial affordance.
 */
export function originMayDial(origin: IncidentOrigin | undefined): boolean {
  return (EMERGENCY_NUMBER_ORIGINS as readonly string[]).includes(origin ?? '');
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

export type RiskBand = 'SAFE' | 'WATCH' | 'ALERT' | 'CRITICAL';

export type RiskSignalCode =
  | 'late_arrival'
  | 'risk_zone'
  | 'route_deviation'
  | 'repeated_deviation'
  | 'missed_checkin'
  | 'repeated_missed_checkin'
  | 'location_lost'
  | 'location_stale'
  | 'explicit_sos'
  | 'safe_confirmation'
  /** Emitted when unrelated families of signal stack up (see RISK_WEIGHTS). */
  | 'compounding'
  /** Emitted when the passive ceiling clamps the score, so the ledger reconciles. */
  | 'passive_ceiling'
  /** Emitted when the absolute 100 cap bites, so the ledger reconciles. */
  | 'score_ceiling'
  /** Emitted when the band floor lifts a low score, so the ledger reconciles. */
  | 'band_floor'
  /** Emitted when an explicit SOS pins the score into CRITICAL. */
  | 'sos_floor';

export interface RiskReason {
  code: RiskSignalCode;
  /** Human readable, shown verbatim in the "Why this score?" panel. */
  label: string;
  /** Signed contribution to the total score. */
  delta: number;
  detail?: string;
}

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  reasons: RiskReason[];
  /** One-line plain-language summary, never a claim of danger. */
  headline: string;
  /** True when the score was produced purely by confirmed-safe recovery. */
  hasRecovery: boolean;
}

/* ------------------------------------------------------------------ */
/* Journey                                                             */
/* ------------------------------------------------------------------ */

export type JourneyStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';

export type CheckInState = 'IDLE' | 'REQUESTED' | 'COMPLETED' | 'MISSED';

/** Local planar point in the simulated map space (metres-ish units). */
export interface Point {
  x: number;
  y: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePlan {
  /** The expected corridor centre line. */
  expected: Point[];
  /** Where the traveller has actually been (drawn as the travelled trail). */
  travelled: Point[];
  /** The branch the traveller follows when off the expected route. */
  deviationBranch: Point[];
  /** Expected corridor half-width in map units. */
  corridorWidth: number;
}

export interface CheckInWindow {
  state: CheckInState;
  /** When the next check-in is due. */
  dueAt: number | null;
  /** When the traveller was actually asked. */
  requestedAt: number | null;
  /** dueAt + grace period. */
  expiresAt: number | null;
  lastCompletedAt: number | null;
  lastMissedAt: number | null;
  completedCount: number;
  missedCount: number;
}

export interface Journey {
  id: string;
  travellerId: string;
  travellerName: string;
  originLabel: string;
  destinationLabel: string;
  startedAt: number;
  expectedArrivalAt: number;
  /** Planned duration in minutes. */
  etaMinutes: number;
  checkInIntervalMinutes: number;
  gracePeriodMinutes: number;
  status: JourneyStatus;
  primaryContactId: string;
  backupContactId: string;
  escalationOrder: string[];

  route: RoutePlan;
  position: Point;
  /** 0..1 progress along the expected route. Freezes while off route. */
  progress: number;
  /** 0..1 progress along the deviation branch while off route. */
  offRouteProgress: number;
  offRouteSince: number | null;
  offRouteAccumulatedMs: number;
  lastPositionAt: number;
  locationAvailable: boolean;

  deviationActive: boolean;
  deviationCount: number;
  inRiskZone: boolean;
  /** True while the traveller is stopped inside the demo higher-risk zone. */
  zoneExcursion: boolean;
  /** Minutes late against the original ETA (0 when on time). */
  lateMinutes: number;
  /** True when the planned arrival window was adjusted mid-journey. */
  expectedArrivalAdjusted?: boolean;

  checkIn: CheckInWindow;
  risk: RiskAssessment;
  /** Confirmed-safe messages the traveller sent during this journey. */
  safeConfirmationCount: number;

  escalationLevel: number;
  guardianNotifiedAt: number | null;
  guardianAcknowledgedAt: number | null;
  incidentId: string | null;

  /**
   * "I need help" used to be a fire-and-forget event with no follow-up state,
   * so nothing happened if the traveller never got an answer. Requesting help
   * now opens a grace window; if it lapses without the traveller confirming
   * safety, the request escalates to the trusted circle.
   */
  helpRequestedAt: number | null;
  /** When the help request escalates if still unanswered. */
  helpDeadlineAt: number | null;

  pausedAt: number | null;
  endedAt: number | null;
  /** Explicit arrival confirmation; cancelling a journey is not arrival. */
  arrivedAt?: number | null;
  /** Set when the journey was ended or resolved after an alert. */
  resolvedBy: 'ended_normally' | 'resolved_after_alert' | null;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type SafetyEventType =
  | 'journey_started'
  | 'location_updated'
  | 'route_deviation'
  | 'route_restored'
  | 'checkin_sent'
  | 'checkin_completed'
  | 'checkin_missed'
  | 'safe_confirmed'
  | 'help_requested'
  | 'exit_mode_started'
  | 'exit_mode_call_answered'
  | 'sos_triggered'
  | 'incident_created'
  | 'guardian_notified'
  | 'guardian_acknowledged'
  | 'evidence_attached'
  | 'journey_paused'
  | 'journey_resumed'
  | 'journey_ended'
  | 'risk_changed'
  | 'risk_zone_entered'
  | 'late_arrival'
  | 'system_note';

export interface SafetyEvent {
  id: string;
  type: SafetyEventType;
  timestamp: number;
  journeyId: string | null;
  incidentId: string | null;
  userId: string;
  metadata: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export type IncidentSeverity = 'WATCH' | 'ALERT' | 'CRITICAL';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface EvidenceRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  sha256: string;
  /** Where the hash came from — WebCrypto or the documented fallback. */
  hashMethod: 'sha256-webcrypto' | 'sha256-fallback';
  kind: 'voice_note' | 'location_snapshot' | 'note';
  description: string;
  /** Demo evidence is generated locally and never uploaded. */
  simulated: boolean;
  /** Blob stored separately in the local evidence database. */
  blobId?: string;
}

export interface Incident {
  id: string;
  /** Human-facing code, e.g. SRK-1042 */
  code: string;
  /**
   * What created this record. Gates the emergency-call affordance — a passive
   * signal must never surface a dialable emergency number.
   */
  origin?: IncidentOrigin;
  journeyId: string | null;
  travellerId: string;
  travellerName: string;
  createdAt: number;
  updatedAt: number;
  severity: IncidentSeverity;
  status: IncidentStatus;
  riskScore: number;
  riskReasons: RiskReason[];
  locationLabel: string;
  locationAvailable: boolean;
  summary: string;
  guardianNotifiedAt: number | null;
  guardianAcknowledgedAt: number | null;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
  evidence: EvidenceRecord[];
  timeline: SafetyEvent[];
  escalationOrder: string[];
  /** What SURAKSHA did / did not do. Honest handoff information. */
  handoff: {
    emergencyServicesContacted: false;
    note: string;
    localEmergencyNumberLabel: string;
    /**
     * Set only on an explicit-SOS record. The UI renders a `tel:` link for it
     * and nothing else may — see EMERGENCY_NUMBER_ORIGINS.
     */
    emergencyNumber?: string;
    /** Records that the traveller pressed the dial affordance themselves. */
    emergencyNumberDialledAt?: number | null;
  };
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export interface TrustedContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  slots: Array<'primary' | 'backup'>;
  available: boolean;
  notifyBy: Array<'push' | 'sms' | 'call'>;
  isDemoFixture: boolean;
}

export interface UserProfile {
  /** Explicit link to this guardian’s trusted-circle contact. */
  contactId?: string;
  id: string;
  role: Role;
  name: string;
  age?: number;
  pronouns?: string;
  homeLabel: string;
  campusLabel: string;
  preferredCheckInMinutes: number;
  gracePeriodMinutes: number;
  riskNotifications: boolean;
  shareLiveLocation: boolean;
  shareLocationScope: 'guardians_only' | 'incident_only';
  dataRetentionDays: number;
  evidenceCaptureEnabled: boolean;
  demoMode: boolean;
}

/* ------------------------------------------------------------------ */
/* Alerts (guardian facing)                                            */
/* ------------------------------------------------------------------ */

export interface GuardianAlert {
  /** Snapshot at the time of the alert, not the current journey score. */
  riskScore?: number;
  travellerName?: string;
  locationLabel?: string;
  guardianId?: string;
  travellerId?: string;
  id: string;
  journeyId: string | null;
  incidentId: string | null;
  band: RiskBand;
  title: string;
  body: string;
  createdAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  read: boolean;
}

/* ------------------------------------------------------------------ */
/* Community + learning                                                */
/* ------------------------------------------------------------------ */

export type SafePlaceType = 'security' | 'reception' | 'hospital' | 'help_desk' | 'cafe' | 'gate';

export interface SafePlace {
  id: string;
  name: string;
  type: SafePlaceType;
  distanceMeters: number;
  openNow: boolean;
  hours: string;
  verified: boolean;
  note: string;
}

export interface SafetyReport {
  id: string;
  title: string;
  category: 'lighting' | 'access' | 'footpath' | 'crowd' | 'other';
  locationLabel: string;
  createdAt: number;
  confirms: number;
  upvotes: number;
  confirmedByMe: boolean;
  upvotedByMe: boolean;
  status: 'open' | 'verified' | 'closed';
  note?: string;
}

export interface LessonQuizQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  icon: string;
  sections: Array<{ heading: string; body: string }>;
  quiz: LessonQuizQuestion[];
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'neutral' | 'safe' | 'watch' | 'alert' | 'critical' | 'brand';
  sticky?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}
