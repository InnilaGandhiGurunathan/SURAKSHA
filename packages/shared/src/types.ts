/**
 * SURAKSHA shared domain model.
 *
 * These types are the contract between the PWA, the reporting server and the
 * Supabase schema. They are intentionally explicit about *delivery state* — the
 * app must be able to say "this report is still only on your device" — and about
 * the fact that risk values are heuristic.
 */

export type Id = string;

export type UserRole = 'traveller' | 'guardian' | 'responder' | 'admin';

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Metres of horizontal accuracy reported by the device, when available. */
  accuracy?: number;
}

export interface EmergencyProfile {
  emergencyNumber: string;
  medicalNotes: string;
  bloodGroup: string;
  allergies: string;
  vehicleDetails: string;
  accommodation: string;
  localEmergencyContact: string;
  updatedAt: string;
}

export interface UserProfile {
  id: Id;
  fullName: string;
  email?: string;
  phone?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  /** True when the account exists only in this browser (no Supabase session). */
  deviceOnly?: boolean;
  emergency: EmergencyProfile;
  rules?: SafetyRules;
  /** Consent recorded at onboarding; shown back to the user in Settings. */
  consents?: {
    locationSharing: boolean;
    guardianSharing: boolean;
    analytics: boolean;
    recordedAt: string;
  };
}

export interface SafetyRules {
  missedCheckpointWeight: number;
  deviationWeight: number;
  deviationContextWeight: number;
  delayWeight: number;
  unusualHourWeight: number;
  gpsLostWeight: number;
  unreachableWeight: number;
  declinedCheckInWeight: number;
  manualSosWeight: number;
  autoEscalateMinSignals: number;
  checkInGraceMinutes: number;
  deviationThresholdMeters: number;
  delayThresholdMinutes: number;
  monitoringIntervalSeconds: number;
  sosAutoNotifyContacts: boolean;
  shareLocationWithGuardians: boolean;
  vibrationAlerts: boolean;
  soundAlerts: boolean;
  silentSos: boolean;
  nightTimeStartHour: number;
  nightTimeEndHour: number;
}

export interface TrustedContact {
  id: Id;
  ownerId: Id;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  notes?: string;
  /** Permission-based: each capability is explicit and revocable. */
  canReceiveAlerts: boolean;
  canViewJourney: boolean;
  canSeeLiveLocation: boolean;
  isPrimary: boolean;
  /** 1 = contacted first. */
  priority: number;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

/* --------------------------------- Journeys -------------------------------- */

export type JourneyStatus = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled' | 'escalated';

export type TransportMode = 'walk' | 'drive' | 'transit' | 'cycle' | 'other';

export type CheckpointStatus = 'pending' | 'reached' | 'missed' | 'skipped';

export interface JourneyCheckpoint {
  id: Id;
  label: string;
  location: GeoPoint;
  /** Minutes after departure at which the traveller expects to be here. */
  expectedOffsetMinutes: number;
  /** How long after the expected time before it counts as missed. */
  windowMinutes: number;
  status: CheckpointStatus;
  reachedAt?: string;
  missedAt?: string;
  note?: string;
}

export interface RouteInfo {
  provider: 'osrm' | 'straight-line' | 'cached';
  distanceMeters: number;
  durationMinutes: number;
  geometry: GeoPoint[];
  fetchedAt: string;
  /** True when the geometry was produced without a routing service. */
  approximate: boolean;
}

export type RiskBand = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export type EscalationStage = 'monitoring' | 'discreet_checkin' | 'trusted_contact_notice' | 'emergency_workflow';

export interface Journey {
  id: Id;
  ownerId: Id;
  title: string;
  status: JourneyStatus;
  transportMode: TransportMode;

  originLabel: string;
  origin: GeoPoint;
  destinationLabel: string;
  destination: GeoPoint;

  /** When the traveller plans to leave (ISO). */
  scheduledStartAt: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  expectedArrivalAt?: string;
  actualArrivalAt?: string;

  checkpoints: JourneyCheckpoint[];
  route?: RouteInfo;
  /** Width of the monitored corridor each side of the route, in metres. */
  corridorMeters: number;

  /** Offline map pack covering the journey corridor, once downloaded. */
  mapPackId?: Id;
  guardianContactIds: Id[];
  monitoringEnabled: boolean;
  notes?: string;

  lastKnownLocation?: GeoPoint;
  lastLocationAt?: string;
  riskScore?: number;
  riskBand?: RiskBand;
  escalationStage?: EscalationStage;

  /** Set for demonstration records so they can never be mistaken for real ones. */
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyLocationPoint {
  id: Id;
  journeyId: Id;
  ownerId: Id;
  point: GeoPoint;
  speedMps?: number;
  heading?: number;
  recordedAt: string;
  source: 'gps' | 'manual' | 'checkpoint';
}

/* ------------------------------ Event timeline ----------------------------- */

export type JourneyEventType =
  | 'journey_created'
  | 'journey_started'
  | 'journey_paused'
  | 'journey_resumed'
  | 'journey_completed'
  | 'journey_cancelled'
  | 'checkpoint_reached'
  | 'checkpoint_missed'
  | 'checkpoint_skipped'
  | 'route_deviation'
  | 'deviation_cleared'
  | 'checkin_prompted'
  | 'checkin_confirmed_safe'
  | 'checkin_declined'
  | 'checkin_timed_out'
  | 'risk_updated'
  | 'sos_triggered'
  | 'sos_cancelled'
  | 'sos_delivered'
  | 'sos_delivery_failed'
  | 'alert_queued'
  | 'guardian_notified'
  | 'guardian_share_created'
  | 'guardian_share_revoked'
  | 'report_created'
  | 'report_submitted'
  | 'report_acknowledged'
  | 'report_timeout'
  | 'report_fallback_opened'
  | 'report_synced'
  | 'report_failed'
  | 'location_updated'
  | 'gps_lost'
  | 'connectivity_changed'
  | 'sync_completed'
  | 'sync_failed'
  | 'notification_shown'
  | 'session_started'
  | 'offline_ready'
  | 'permission_changed'
  | 'emergency_contact_dialled'
  | 'sms_handoff_opened'
  | 'monitoring_stopped'
  | 'data_exported'
  | 'data_erased';

export type EventSeverity = 'info' | 'notice' | 'warning' | 'critical';

export interface JourneyEvent {
  id: Id;
  ownerId: Id;
  journeyId?: Id;
  type: JourneyEventType;
  severity: EventSeverity;
  message: string;
  location?: GeoPoint;
  riskScore?: number;
  /** Free-form context: checkpoint id, report id, delivery details, and so on. */
  data?: Record<string, unknown>;
  createdAt: string;
  syncedAt?: string;
  isDemo?: boolean;
}

export interface TimelineSummary {
  total: number;
  critical: number;
  warnings: number;
  notices: number;
  firstAt?: string;
  lastAt?: string;
  byType: Partial<Record<JourneyEventType, number>>;
}

/* -------------------------------- Reporting -------------------------------- */

export type ReportCategory =
  | 'harassment'
  | 'stalking'
  | 'unsafe_area'
  | 'poor_lighting'
  | 'transport_issue'
  | 'accident'
  | 'medical'
  | 'theft'
  | 'suspicious_activity'
  | 'infrastructure'
  | 'other';

export type ReportSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ReportAnonymity = 'named' | 'anonymous';

/**
 * Delivery lifecycle. The order matters: nothing may be presented as delivered
 * before `acknowledged`, which only an explicit server acknowledgement produces.
 */
export type ReportStatus =
  | 'draft'
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'acknowledged'
  | 'timeout'
  | 'fallback_opened'
  | 'synced'
  | 'failed'
  | 'verified'
  | 'rejected';

export type ReportVerification = 'unverified' | 'verified' | 'rejected' | 'needs_info';

export interface ReportAttachment {
  id: Id;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Downscaled JPEG data URL kept locally — media is optional. */
  dataUrl?: string;
  remoteUrl?: string;
  uploadedAt?: string;
}

export interface IncidentReport {
  id: Id;
  /** Generated on the device; the dedupe key across app, website and server. */
  clientReportId: string;
  ownerId: Id;
  ownerDisplayName?: string;
  journeyId?: Id;

  category: ReportCategory;
  severity: ReportSeverity;
  title: string;
  description: string;
  occurredAt: string;
  location?: GeoPoint;
  locationLabel?: string;
  attachments: ReportAttachment[];
  anonymity: ReportAnonymity;

  status: ReportStatus;
  deliveryChannel?: 'app' | 'website' | 'sms';

  attempts: number;
  lastAttemptAt?: string;
  serverAckId?: string;
  receivedAt?: string;
  lastError?: string;

  /** Set when the 30-second acknowledgement window elapsed and the website took over. */
  fallbackOpenedAt?: string;
  fallbackUrl?: string;

  verification: ReportVerification;
  verificationNote?: string;
  isCommunityVisible: boolean;

  riskScore?: number;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSubmissionPayload {
  clientReportId: string;
  category: ReportCategory;
  severity: ReportSeverity;
  title: string;
  description: string;
  occurredAt: string;
  anonymity: ReportAnonymity;
  reporterName?: string;
  reporterContact?: string;
  location?: GeoPoint;
  locationLabel?: string;
  journeyId?: Id;
  attachments?: ReportAttachment[];
  riskScore?: number;
  source: 'pwa' | 'website' | 'sms';
}

export interface ReportAck {
  ok: true;
  serverAckId: string;
  reportId: string;
  receivedAt: string;
  duplicate: boolean;
  status: string;
}

export interface ReportDeliverySummary {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  detail: string;
  /** True only when a server explicitly acknowledged the report. */
  delivered: boolean;
}

/* ------------------------------ Notifications ------------------------------ */

export type NotificationKind = 'checkin' | 'risk' | 'journey' | 'report' | 'guardian' | 'system' | 'sos';

export interface AppNotification {
  id: Id;
  ownerId: Id;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: EventSeverity;
  readAt?: string;
  journeyId?: Id;
  reportId?: Id;
  actionUrl?: string;
  createdAt: string;
  isDemo?: boolean;
}

/* ------------------------------- Guardian mode ----------------------------- */

export type GuardianShareScope =
  | 'journey:read'
  | 'location:read'
  | 'location:live'
  | 'alerts:read'
  | 'events:read';

export interface GuardianShare {
  id: Id;
  journeyId: Id;
  ownerId: Id;
  /** Secret half of the link; only its hash is stored server-side. */
  token: string;
  contactId?: Id;
  contactName: string;
  scopes: GuardianShareScope[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastViewedAt?: string;
  snapshotUpdatedAt?: string;
}

export interface GuardianCheckpointSnapshot {
  id: Id;
  label: string;
  status: CheckpointStatus;
  expectedOffsetMinutes: number;
  reachedAt?: string;
}

export interface GuardianSnapshot {
  shareId: Id;
  travellerName: string;
  journeyId: Id;
  journeyTitle: string;
  status: JourneyStatus;
  originLabel: string;
  destinationLabel: string;
  startedAt?: string;
  expectedArrivalAt?: string;
  riskBand: RiskBand;
  riskScore: number;
  progress: {
    percent: number;
    travelledMeters: number;
    remainingMeters: number;
  };
  lastKnownLocation?: GeoPoint;
  lastLocationAt?: string;
  checkpoints: GuardianCheckpointSnapshot[];
  recentEvents: Array<{
    id: Id;
    type: JourneyEventType;
    message: string;
    severity: EventSeverity;
    createdAt: string;
  }>;
  updatedAt: string;
  /** Repeated on every snapshot so a guardian cannot mistake it for a rescue guarantee. */
  disclaimer: string;
}

/* ------------------------------- Risk engine ------------------------------- */

export type RiskSignalKind =
  | 'missed_checkpoint'
  | 'route_deviation'
  | 'route_deviation_contextual'
  | 'deviation_persisted'
  | 'journey_delay'
  | 'unusual_hour'
  | 'gps_lost'
  | 'no_movement'
  | 'speed_anomaly'
  | 'unreachable_checkin'
  | 'declined_checkin'
  | 'manual_sos'
  | 'guardian_alert';

export interface RiskSignal {
  kind: RiskSignalKind;
  weight: number;
  detail: string;
  at: string;
  /** Contextual signals only count when the context check passes. */
  contextual?: boolean;
}

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  stage: EscalationStage;
  signals: RiskSignal[];
  rationale: string[];
  /** Always true for anything above the discreet check-in stage. */
  requiresHumanConfirmation: boolean;
  /** Set when the only reason for escalation is an explicit user signal. */
  triggeredBy?: 'manual_sos' | 'declined_checkin' | 'accumulated_signals';
  evaluatedAt: string;
  disclaimer: string;
}

/* --------------------------------- Offline --------------------------------- */

export interface OfflineMapPack {
  id: Id;
  journeyId: Id;
  ownerId: Id;
  label: string;
  bounds: [[number, number], [number, number]];
  minZoom: number;
  maxZoom: number;
  tilesRequested: number;
  tilesStored: number;
  bytes: number;
  status: 'queued' | 'downloading' | 'ready' | 'partial' | 'failed';
  /** 0..1 */
  progress: number;
  attribution: string;
  tileUrlTemplate: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface OfflineReadiness {
  shell: boolean;
  rules: boolean;
  contacts: boolean;
  journeys: boolean;
  tiles: boolean;
  storage: boolean;
  /** Only the essentials count towards "ready to travel without signal". */
  ready: boolean;
  checkedAt: string;
  note: string;
}

export type SetupStepId =
  | 'account'
  | 'permissions'
  | 'contacts'
  | 'emergency'
  | 'rules'
  | 'offline_bundle'
  | 'complete';

export interface SetupState {
  steps: Partial<Record<SetupStepId, { done: boolean; at: string; detail?: string }>>;
  completedAt?: string;
  version: number;
}

/* ------------------------------- Sync & health ----------------------------- */

export type SyncStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface SyncLogEntry {
  ownerId: Id;
  kind: 'outbox' | 'full' | 'report' | 'share';
  status: SyncStatus;
  items: number;
  failed: number;
  message?: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

export interface ConnectivityInfo {
  state: 'online' | 'offline';
  quality: 'good' | 'slow' | 'unknown';
  effectiveType?: string;
  downlinkMbps?: number;
  rttMs?: number;
  lastChangedAt: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  time: string;
  supabase: 'connected' | 'not-configured' | 'unreachable';
  store?: Record<string, number>;
}

/* --------------------------------- Monitoring ------------------------------ */

export interface MonitorTickResult {
  journeyId?: Id;
  assessment?: RiskAssessment;
  actions: Array<{
    type:
      | 'start_journey'
      | 'complete_journey'
      | 'mark_checkpoint_reached'
      | 'mark_checkpoint_missed'
      | 'prompt_checkin'
      | 'notify_guardians'
      | 'open_emergency_workflow'
      | 'clear_deviation'
      | 'record_event';
    detail: string;
    payload?: Record<string, unknown>;
  }>;
  deviationMeters?: number;
  progress?: number;
  delayMinutes?: number;
  offRoute?: boolean;
  evaluatedAt: string;
}
