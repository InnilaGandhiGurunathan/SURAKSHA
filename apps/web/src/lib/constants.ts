import type { EmergencyProfile, SafetyRules } from '@suraksha/shared';

/**
 * Honesty layer.
 *
 * These strings are the product's promises about what it can and cannot do.
 * They are used verbatim in the UI rather than being paraphrased per screen, so
 * the language cannot drift into claiming a rescue guarantee or a delivery that
 * did not happen.
 */
export const DISCLAIMERS = {
  monitoring:
    'SURAKSHA monitors your journey on this device. If the device is switched off, out of battery, or has no GPS fix, monitoring stops — no one is watching from a control room.',
  noRescueGuarantee:
    'SURAKSHA cannot guarantee that anyone will reach you. It helps the people you trust notice sooner. In an emergency, call your local emergency number.',
  riskHeuristic:
    'Risk scores are heuristic indicators produced by simple on-device rules with prototype weights. They are not probabilities and are not validated.',
  shareDisclaimer:
    'Guardian links are end-to-end encrypted and can be revoked at any time. Updates only appear when the traveller’s device has a connection.',
  delivery:
    'Delivery status reflects what actually happened: “queued” means it is still only on this device.',
  sms: 'SMS handoff opens your messaging app with the alert text. SURAKSHA cannot confirm that the message left your phone.',
  emergencyDial:
    'Dialling hands control to your phone’s dialler. SURAKSHA never calls emergency services on your behalf.',
  offlineTiles:
    'Map tiles are stored on this device for the journey corridor you downloaded. Zooming far outside that corridor needs a connection.',
  community:
    'Community reports are shown after a human review step and never include the reporter’s identity.',
} as const;

export const RISK_WEIGHTS_UI = {
  missed_checkpoint: 10,
  route_deviation_contextual: 25,
  manual_sos: 50,
} as const;

export const DEFAULT_SAFETY_RULES: SafetyRules = {
  missedCheckpointWeight: 10,
  deviationWeight: 12,
  deviationContextWeight: 25,
  delayWeight: 15,
  unusualHourWeight: 8,
  gpsLostWeight: 6,
  unreachableWeight: 20,
  declinedCheckInWeight: 45,
  manualSosWeight: 50,
  autoEscalateMinSignals: 2,
  checkInGraceMinutes: 10,
  deviationThresholdMeters: 400,
  delayThresholdMinutes: 20,
  monitoringIntervalSeconds: 45,
  sosAutoNotifyContacts: true,
  shareLocationWithGuardians: true,
  vibrationAlerts: true,
  soundAlerts: false,
  silentSos: true,
  nightTimeStartHour: 22,
  nightTimeEndHour: 5,
};

export const DEFAULT_EMERGENCY_PROFILE: EmergencyProfile = {
  emergencyNumber: '112',
  medicalNotes: '',
  bloodGroup: '',
  allergies: '',
  vehicleDetails: '',
  accommodation: '',
  localEmergencyContact: '',
  updatedAt: new Date().toISOString(),
};

export const RISK_THRESHOLDS = { low: 10, medium: 25, high: 50, critical: 75 } as const;

/** Reporting constants (the 30-second contract the app must honour). */
export const REPORT_ACK_TIMEOUT_MS = 30_000;
export const REPORT_FALLBACK_STORAGE_PREFIX = 'suraksha.report.handoff.';
export const REPORT_MAX_ATTEMPTS = 5;
export const MAX_REPORT_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 1_500_000;

export const JOURNEY_DEFAULTS = {
  deviationThresholdMeters: DEFAULT_SAFETY_RULES.deviationThresholdMeters,
  checkInGraceMinutes: DEFAULT_SAFETY_RULES.checkInGraceMinutes,
  monitoringIntervalSeconds: DEFAULT_SAFETY_RULES.monitoringIntervalSeconds,
};

export const DEMO_TAG = 'SURAKSHA-DEMO';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? 'support@suraksha.app';

export const STORAGE_KEYS = {
  theme: 'suraksha.theme',
  session: 'suraksha.session',
  installDismissed: 'suraksha.install.dismissed',
  updateDismissed: 'suraksha.update.dismissed',
  shareCache: 'suraksha.share.cache.',
  lastRoute: 'suraksha.lastRoute',
  consent: 'suraksha.consent',
} as const;
