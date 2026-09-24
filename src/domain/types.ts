/**
 * SURAKSHA — domain model.
 *
 * The product is modelled around an append-only event log plus two derived
 * things: the risk assessment (explainable, deterministic) and the journey
 * state machine. Nothing in here claims to determine that a person is unsafe.
 */

export type Role = 'traveller' | 'guardian';

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
  | 'explicit_sos'
  | 'safe_confirmation';

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
  computedAt: number;
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

  pausedAt: number | null;
  endedAt: number | null;
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
}

export interface Incident {
  id: string;
  /** Human-facing code, e.g. SRK-1042 */
  code: string;
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
