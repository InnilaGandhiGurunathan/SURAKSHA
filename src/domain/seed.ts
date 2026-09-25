/**
 * Fictional seed data for the SURAKSHA prototype.
 * No real people, phone numbers, places or incidents are referenced.
 */

import type {
  Incident,
  LatLng,
  Lesson,
  Point,
  RoutePlan,
  SafePlace,
  SafetyReport,
  TrustedContact,
  UserProfile,
} from './types';
import { buildDeviationBranch, RISK_ZONE } from './geo';

export const DEMO_PEOPLE = {
  traveller: 'Aarav Sharma',
  guardian: 'Rohan Mehta',
  backup: 'Priya Sharma',
} as const;

export const TRAVELLER_ID = 'usr-aarav';
export const GUARDIAN_ID = 'usr-rohan';

export const CHECK_IN_OPTIONS = [5, 10, 15, 30, 60] as const;

export const trustedContactsSeed: TrustedContact[] = [
  {
    id: 'ct-rohan',
    name: 'Rohan Mehta',
    relationship: 'Friend · Guardian',
    phone: '+91 90000 00001',
    email: 'rohan.demo@example.com',
    slots: ['primary'],
    available: true,
    notifyBy: ['push', 'sms'],
    isDemoFixture: true,
  },
  {
    id: 'ct-priya',
    name: 'Priya Sharma',
    relationship: 'Parent · Backup',
    phone: '+91 90000 00002',
    email: 'priya.demo@example.com',
    slots: ['backup'],
    available: true,
    notifyBy: ['push', 'sms', 'call'],
    isDemoFixture: true,
  },
  {
    id: 'ct-campuss',
    name: 'Campus Security Desk',
    relationship: 'Institution · Escalation',
    phone: '+91 90000 00003',
    slots: [],
    available: true,
    notifyBy: ['call'],
    isDemoFixture: true,
  },
];

export const travellerProfileSeed: UserProfile = {
  id: TRAVELLER_ID,
  role: 'traveller',
  name: DEMO_PEOPLE.traveller,
  age: 21,
  pronouns: 'he/him',
  homeLabel: 'Home',
  campusLabel: 'IIT Campus',
  preferredCheckInMinutes: 10,
  gracePeriodMinutes: 2,
  riskNotifications: true,
  shareLiveLocation: true,
  shareLocationScope: 'guardians_only',
  dataRetentionDays: 30,
  evidenceCaptureEnabled: true,
  demoMode: true,
};

export const guardianProfileSeed: UserProfile = {
  id: GUARDIAN_ID,
  role: 'guardian',
  name: DEMO_PEOPLE.guardian,
  homeLabel: 'Home',
  campusLabel: 'IIT Campus',
  preferredCheckInMinutes: 10,
  gracePeriodMinutes: 2,
  riskNotifications: true,
  shareLiveLocation: true,
  shareLocationScope: 'guardians_only',
  dataRetentionDays: 30,
  evidenceCaptureEnabled: false,
  demoMode: true,
};

/** Origin → destination for the canonical demo journey. */
export const CAMPUS_POINT: Point = { x: 138, y: 548 };
export const HOME_POINT: Point = { x: 862, y: 196 };

/**
 * The expected route corridor: Campus → main road → ring road → Home.
 * Coordinates are map units on a 1000 × 680 fictional canvas.
 */
export const EXPECTED_ROUTE: Point[] = [
  CAMPUS_POINT,
  { x: 236, y: 512 },
  { x: 318, y: 470 },
  { x: 398, y: 462 },
  { x: 470, y: 424 },
  { x: 540, y: 396 },
  { x: 596, y: 352 },
  { x: 664, y: 322 },
  { x: 724, y: 286 },
  { x: 792, y: 240 },
  HOME_POINT,
];

/** A second, older route used for the "expected route" selector. */
export const ALT_ROUTE: Point[] = [
  CAMPUS_POINT,
  { x: 208, y: 596 },
  { x: 322, y: 604 },
  { x: 452, y: 580 },
  { x: 588, y: 540 },
  { x: 700, y: 452 },
  { x: 786, y: 328 },
  HOME_POINT,
];

export const ROUTE_PRESETS = [
  {
    id: 'main-road',
    label: 'Main road via Ring Road',
    detail: 'Well-lit, staffed shops until 11 PM',
    points: EXPECTED_ROUTE,
  },
  {
    id: 'inner-route',
    label: 'Inner route via Sector 4',
    detail: 'Shorter, fewer open businesses after 10 PM',
    points: ALT_ROUTE,
  },
] as const;

export function buildRoutePlan(
  expected: Point[],
  deviationStartProgress = 0.42,
): RoutePlan {
  return {
    expected: expected.map((p) => ({ ...p })),
    travelled: [{ ...expected[0] }],
    deviationBranch: buildDeviationBranch(expected, deviationStartProgress),
    corridorWidth: 34,
  };
}

export const MAP_LANDMARKS: Array<{
  id: string;
  label: string;
  kind: 'origin' | 'destination' | 'poi' | 'checkpoint';
  point: Point;
  detail?: string;
}> = [
  { id: 'lm-campus', label: 'IIT Campus — Gate 2', kind: 'origin', point: CAMPUS_POINT, detail: 'Start' },
  { id: 'lm-home', label: 'Home', kind: 'destination', point: HOME_POINT, detail: 'Destination' },
  { id: 'lm-metro', label: 'Metro Gate 3', kind: 'poi', point: { x: 470, y: 424 }, detail: 'Staffed till 11 PM' },
  { id: 'lm-cafe', label: 'Highway Cafe', kind: 'poi', point: { x: 596, y: 352 }, detail: 'Open 24/7' },
  { id: 'lm-hospital', label: 'City Hospital', kind: 'poi', point: { x: 792, y: 240 }, detail: 'Emergency desk' },
  { id: 'lm-checkpoint', label: 'Checkpoint — Ring Rd', kind: 'checkpoint', point: { x: 664, y: 322 } },
];

/** Fixed 10:42 PM clock used by the killer demo flow. */
export function demoStartClock(): number {
  const d = new Date();
  d.setHours(22, 42, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export const INCIDENT_SEED: Incident[] = [
  {
    id: 'inc-1038',
    code: 'SRK-1038',
    // Raised by passively detected signals. Never carries a dialable number.
    origin: 'passive_signal',
    journeyId: null,
    travellerId: TRAVELLER_ID,
    travellerName: DEMO_PEOPLE.traveller,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 22,
    severity: 'ALERT',
    status: 'RESOLVED',
    // 20 + 25 + 10 + 12 compounding - 15 credit = 52. The reasons must sum to
    // the score: the incident screen lists every line and then shows the total.
    riskScore: 52,
    riskReasons: [
      { code: 'route_deviation', label: 'Route deviation detected', delta: 20 },
      { code: 'missed_checkin', label: 'Safety check-in missed', delta: 25 },
      { code: 'late_arrival', label: 'Traveller is past the expected arrival time', delta: 10 },
      {
        code: 'compounding',
        label: 'Unrelated safety signals stacking up',
        delta: 12,
        detail: '3 independent signal families open — late, deviation, checkin',
      },
      {
        code: 'safe_confirmation',
        label: 'Safety confirmed by traveller',
        delta: -15,
        detail: 'Resolves part of the raised signals — the event log still records them',
      },
    ],
    locationLabel: 'Ring Road service lane (simulated)',
    locationAvailable: true,
    summary:
      'Traveller took a diversion around roadwork, missed one automated check-in, then confirmed safety and completed the journey.',
    guardianNotifiedAt: Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 4,
    guardianAcknowledgedAt: Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 6,
    acknowledgedBy: DEMO_PEOPLE.guardian,
    resolvedAt: Date.now() - 1000 * 60 * 60 * 24 * 3 + 1000 * 60 * 22,
    evidence: [],
    timeline: [],
    escalationOrder: ['ct-rohan', 'ct-priya'],
    handoff: {
      emergencyServicesContacted: false,
      note: 'Escalation stayed inside the trusted circle. SURAKSHA never dials emergency services for you.',
      localEmergencyNumberLabel: 'Emergency number 112',
    },
  },
  {
    id: 'inc-1021',
    code: 'SRK-1021',
    origin: 'passive_signal',
    journeyId: null,
    travellerId: TRAVELLER_ID,
    travellerName: DEMO_PEOPLE.traveller,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7 + 1000 * 60 * 9,
    severity: 'WATCH',
    status: 'RESOLVED',
    // A single low-level signal: +10, floored to the WATCH minimum of 30.
    riskScore: 30,
    riskReasons: [
      { code: 'late_arrival', label: 'Traveller is past the expected arrival time', delta: 10 },
      {
        code: 'band_floor',
        label: 'Open signal — confirm with the traveller',
        delta: 20,
        detail: '1 signal family still open. WATCH means "confirm with the traveller", not an emergency.',
      },
    ],
    locationLabel: 'Campus Road (simulated)',
    locationAvailable: true,
    summary: 'Arrived 24 minutes later than planned because of a late bus. No escalation beyond a late-arrival notice.',
    guardianNotifiedAt: Date.now() - 1000 * 60 * 60 * 24 * 7 + 1000 * 60 * 3,
    guardianAcknowledgedAt: Date.now() - 1000 * 60 * 60 * 24 * 7 + 1000 * 60 * 4,
    acknowledgedBy: DEMO_PEOPLE.backup,
    resolvedAt: Date.now() - 1000 * 60 * 60 * 24 * 7 + 1000 * 60 * 9,
    evidence: [],
    timeline: [],
    escalationOrder: ['ct-rohan'],
    handoff: {
      emergencyServicesContacted: false,
      note: 'No escalation was required.',
      localEmergencyNumberLabel: 'Emergency number 112',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Community                                                           */
/* ------------------------------------------------------------------ */

export const SAFE_PLACES_SEED: SafePlace[] = [
  {
    id: 'sp-1',
    name: 'Campus Security Desk — Gate 2',
    type: 'security',
    distanceMeters: 120,
    openNow: true,
    hours: '24/7',
    verified: true,
    note: 'Staffed desk with PA system and first-aid kit.',
  },
  {
    id: 'sp-2',
    name: 'Metro Gate 3 Reception',
    type: 'reception',
    distanceMeters: 430,
    openNow: true,
    hours: '05:30 – 23:45',
    verified: true,
    note: 'Metro staff at the concourse level.',
  },
  {
    id: 'sp-3',
    name: 'City Hospital Emergency',
    type: 'hospital',
    distanceMeters: 900,
    openNow: true,
    hours: '24/7',
    verified: true,
    note: 'Emergency desk with ambulance bay.',
  },
  {
    id: 'sp-4',
    name: 'Ring Road Police Help Desk',
    type: 'help_desk',
    distanceMeters: 1400,
    openNow: true,
    hours: '24/7',
    verified: true,
    note: 'Public help desk — walk in and ask to wait inside.',
  },
  {
    id: 'sp-5',
    name: 'Highway Cafe',
    type: 'cafe',
    distanceMeters: 760,
    openNow: true,
    hours: '24/7',
    verified: true,
    note: 'Bright frontage, staff present through the night.',
  },
  {
    id: 'sp-6',
    name: 'Hostel Gate — Block C',
    type: 'gate',
    distanceMeters: 60,
    openNow: false,
    hours: '06:00 – 23:00',
    verified: true,
    note: 'Gate closes at 11 PM; intercom available after hours.',
  },
];

export const SAFETY_REPORTS_SEED: SafetyReport[] = [
  {
    id: 'sr-1',
    title: 'Streetlight not working near Gate 3',
    category: 'lighting',
    locationLabel: 'Campus Road, Gate 3',
    createdAt: Date.now() - 1000 * 60 * 60 * 30,
    confirms: 14,
    upvotes: 26,
    confirmedByMe: false,
    upvotedByMe: false,
    status: 'verified',
    note: 'Two-pole stretch is fully dark. Reported to campus facilities.',
  },
  {
    id: 'sr-2',
    title: 'Construction blocking the footpath',
    category: 'footpath',
    locationLabel: 'Ring Road service lane',
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
    confirms: 6,
    upvotes: 11,
    confirmedByMe: false,
    upvotedByMe: false,
    status: 'open',
    note: 'Pedestrians are being routed onto the carriageway.',
  },
  {
    id: 'sr-3',
    title: 'Campus gate closes at 11 PM',
    category: 'access',
    locationLabel: 'Hostel Gate — Block C',
    createdAt: Date.now() - 1000 * 60 * 60 * 60,
    confirms: 31,
    upvotes: 48,
    confirmedByMe: true,
    upvotedByMe: true,
    status: 'verified',
    note: 'After 11 PM use the intercom or walk to the Gate 2 desk.',
  },
];

/* ------------------------------------------------------------------ */
/* Learning hub                                                        */
/* ------------------------------------------------------------------ */

export const LESSONS_SEED: Lesson[] = [
  {
    id: 'ls-1',
    title: 'Planning a safer journey',
    summary: 'Pick a route on purpose, not by habit, and tell someone the plan.',
    minutes: 4,
    icon: 'route',
    sections: [
      {
        heading: 'Choose the route, not just the destination',
        body:
          'The shortest route is not always the calmest one. Prefer routes with open businesses, transit you can re-enter, and wide footpaths. If you can, plan a second route before you leave.',
      },
      {
        heading: 'Give your plan a shape',
        body:
          'A plan someone else can act on has four parts: where you are leaving from, where you are going, roughly when you arrive, and who knows. SURAKSHA stores these four things when you start a journey.',
      },
      {
        heading: 'Build in a checkpoint',
        body:
          'Pick one mid-journey landmark — a metro gate, a lit junction — and decide you will note the time when you pass it. A single checkpoint turns a vague "I should be home soon" into an observable signal.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'What makes a journey plan actionable for a trusted contact?',
        options: [
          'Knowing your usual habits',
          'Origin, destination, expected arrival and who is aware',
          'A screenshot of the map',
        ],
        answerIndex: 1,
        explanation:
          'A trusted contact can only act on specifics: where you started, where you are going, when you expect to arrive, and that they are the person watching.',
      },
      {
        id: 'q2',
        question: 'Why plan a second route in advance?',
        options: [
          'So you can switch quickly without re-thinking under pressure',
          'Because the first route is always wrong',
          'To make the journey longer',
        ],
        answerIndex: 0,
        explanation:
          'Deciding in advance means you do not have to reason through options while you are uncomfortable.',
      },
      {
        id: 'q3',
        question: 'How many mid-journey checkpoints does SURAKSHA recommend to start with?',
        options: ['None', 'At least one landmark you will consciously pass', 'Twelve'],
        answerIndex: 1,
        explanation: 'One checkpoint is enough to turn an assumption into a signal.',
      },
    ],
  },
  {
    id: 'ls-2',
    title: 'Recognising uncomfortable situations',
    summary: 'Trust the early signals — the ones before anything has happened.',
    minutes: 5,
    icon: 'eye',
    sections: [
      {
        heading: 'Discomfort is information',
        body:
          'Feeling uneasy is not overreacting; it is early data. The useful question is not "am I in danger?" but "has something changed that I did not choose?"',
      },
      {
        heading: 'Notice changes you did not ask for',
        body:
          'Someone repeatedly closing distance. A vehicle matching your pace. A route you were talked into. A lift you did not request. Each one is small; together they matter.',
      },
      {
        heading: 'Act early and small',
        body:
          'You do not need an emergency to change plans. Crossing a road, stepping into a lit shop, putting a call on speaker, or starting Exit Mode are all proportionate, low-drama responses.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'What is the most useful question when you feel uneasy?',
        options: [
          'Am I definitely in danger?',
          'Has something changed that I did not choose?',
          'Am I being polite enough?',
        ],
        answerIndex: 1,
        explanation:
          'Focusing on uninvited changes keeps you observing instead of arguing with yourself about whether you are overreacting.',
      },
      {
        id: 'q2',
        question: 'Which response is proportionate to discomfort that is not an emergency?',
        options: [
          'Waiting to see if it gets worse',
          'A small, early action — change route, enter a lit space, start a check-in',
          'Confronting the person',
        ],
        answerIndex: 1,
        explanation: 'Small early actions are lower-risk and easier to justify to yourself and others.',
      },
      {
        id: 'q3',
        question: 'What does SURAKSHA claim about your discomfort?',
        options: [
          'It can tell whether you are in danger',
          'It records signals and alerts the people you chose',
          'It will dispatch help automatically',
        ],
        answerIndex: 1,
        explanation:
          'SURAKSHA is a tool, not a promise: it makes sure the right people are watching and informed, and it never claims to know whether you are safe.',
      },
    ],
  },
  {
    id: 'ls-3',
    title: 'Creating a trusted circle',
    summary: 'Two people who will actually pick up, and a clear order.',
    minutes: 3,
    icon: 'users',
    sections: [
      {
        heading: 'Two is a system, one is a hope',
        body:
          'A single contact can be asleep, in a meeting or out of network. A primary plus a backup means escalation has somewhere to go.',
      },
      {
        heading: 'Tell them what they signed up for',
        body:
          'A guardian should know: what SURAKSHA will send them, what a "check-in missed" message actually means, and what you want them to do first.',
      },
      {
        heading: 'Write down the escalation order',
        body:
          'Primary first, then backup, then your own emergency plan. Agree it out loud once, so nobody is improvising during a bad night.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'Why does SURAKSHA ask for a primary and a backup contact?',
        options: [
          'To send more notifications',
          'So escalation still has a path if one person is unreachable',
          'Because it is a legal requirement',
        ],
        answerIndex: 1,
        explanation: 'Redundancy is the point — escalation should not dead-end on one person.',
      },
      {
        id: 'q2',
        question: 'What should you agree with your guardian in advance?',
        options: [
          'A colour scheme',
          'What the alerts mean and what they should do first',
          'That they will never call you',
        ],
        answerIndex: 1,
        explanation: 'Shared expectations turn an alert into an action instead of confusion.',
      },
      {
        id: 'q3',
        question: 'What is the SURAKSHA escalation order?',
        options: [
          'Backup → primary → emergency workflow',
          'Primary guardian → backup guardian → emergency workflow',
          'Police → primary guardian',
        ],
        answerIndex: 1,
        explanation:
          'Primary, then backup, then your own emergency workflow. SURAKSHA never dials emergency services for you — you always make that call yourself.',
      },
    ],
  },
  {
    id: 'ls-4',
    title: 'Digital privacy',
    summary: 'Share what helps, keep what does not.',
    minutes: 4,
    icon: 'lock',
    sections: [
      {
        heading: 'Share by purpose',
        body:
          'Live location helps a guardian while a journey is active. It rarely needs to keep running after you arrive. Switch sharing to incident-only if you want the minimum.',
      },
      {
        heading: 'Retention is a choice',
        body:
          'Incident records are useful for a short while. Set a retention window and delete old incidents — fewer records are easier to reason about.',
      },
      {
        heading: 'Hashes prove integrity, not truth',
        body:
          'An integrity hash shows the stored file has not changed since hashing. It does not prove what happened, who was involved, or that anything is true.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'What does an integrity hash prove?',
        options: [
          'That the file has not changed since it was hashed',
          'That the file is true',
          'That the file was recorded legally',
        ],
        answerIndex: 0,
        explanation:
          'Integrity hashes detect tampering with a stored file. They say nothing about the truth of its contents.',
      },
      {
        id: 'q2',
        question: 'When is live location most useful?',
        options: [
          'Always, forever',
          'While a journey is active',
          'Only after an incident is closed',
        ],
        answerIndex: 1,
        explanation: 'Scoped sharing is easier to justify and safer by default.',
      },
      {
        id: 'q3',
        question: 'A practical data retention approach is to…',
        options: [
          'Keep everything indefinitely',
          'Set a short window and delete old incidents',
          'Never record anything',
        ],
        answerIndex: 1,
        explanation: 'Short, deliberate retention keeps data useful and minimises what can leak.',
      },
    ],
  },
  {
    id: 'ls-5',
    title: 'Emergency planning',
    summary: 'Decide the boring details now so you are not deciding later.',
    minutes: 5,
    icon: 'siren',
    sections: [
      {
        heading: 'Know the number before you need it',
        body:
          'Save your local emergency number and the campus security number as actual contacts, not notes. SURAKSHA will not dial for you — you must be able to.',
      },
      {
        heading: 'Pre-decide your first move',
        body:
          'Pick a default: "I go to the nearest staffed counter." Ambiguity is what slows people down under pressure.',
      },
      {
        heading: 'Rehearse the handoff',
        body:
          'If you share a location with a guardian, tell them what you want them to do with it. Most people default to calling; some should be told to come, or to ring the desk.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'Does SURAKSHA contact emergency services automatically?',
        options: [
          'Yes, on SOS',
          'No — it escalates to your trusted circle and shows you how to reach emergency services yourself',
          'Only at night',
        ],
        answerIndex: 1,
        explanation:
          'SURAKSHA does not replace emergency services, never dials them for you, and never auto-dispatches based on a risk score.',
      },
      {
        id: 'q2',
        question: 'Why pre-decide a default first move?',
        options: [
          'It removes a decision from a high-pressure moment',
          'It is required by law',
          'It makes the app cheaper',
        ],
        answerIndex: 0,
        explanation: 'Pre-decided defaults are faster and less error-prone than improvising.',
      },
      {
        id: 'q3',
        question: 'What should you tell a guardian about the location you share?',
        options: [
          'Nothing',
          'What you want them to do with it',
          'Only the coordinates',
        ],
        answerIndex: 1,
        explanation: 'A location is only useful if the recipient knows what action you want from them.',
      },
    ],
  },
  {
    id: 'ls-6',
    title: 'Reporting online abuse',
    summary: 'Keep the record, use the platform, escalate when it continues.',
    minutes: 4,
    icon: 'flag',
    sections: [
      {
        heading: 'Preserve before you block',
        body:
          'Screenshots, usernames, timestamps and message URLs are what platforms act on. Capture first, then block.',
      },
      {
        heading: 'Use the platform process, then go higher',
        body:
          'Report in-app. If it continues or involves threats, escalate to your institution or local authorities — stalking and threats are offences in most jurisdictions.',
      },
      {
        heading: 'You do not have to review it alone',
        body:
          'Ask someone you trust to sit with you while you file the report. Having a second pair of eyes reduces the chance of missing a detail — and the emotional load.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'What should you do first?',
        options: [
          'Block immediately',
          'Preserve evidence (screenshots, usernames, timestamps) then block',
          'Reply to the person',
        ],
        answerIndex: 1,
        explanation: 'Blocking removes your access to the record. Preserve it first.',
      },
      {
        id: 'q2',
        question: 'When should you escalate beyond the platform?',
        options: [
          'Never',
          'When it continues, or contains threats',
          'On the first rude message',
        ],
        answerIndex: 1,
        explanation: 'Threats and sustained abuse are matters for institutions and authorities.',
      },
      {
        id: 'q3',
        question: 'Why file with someone sitting with you?',
        options: [
          'It is required',
          'It reduces missed details and shared emotional load',
          'It makes the report valid',
        ],
        answerIndex: 1,
        explanation: 'A second person helps you be thorough and makes the process less isolating.',
      },
    ],
  },
  {
    id: 'ls-7',
    title: 'What to share with a trusted contact',
    summary: 'Enough to act, not more than you need.',
    minutes: 3,
    icon: 'share',
    sections: [
      {
        heading: 'The four-line brief',
        body:
          'Where I am, where I am going, when I expect to arrive, what I want you to do if you do not hear from me. Four lines is a complete plan.',
      },
      {
        heading: 'Give them a threshold',
        body:
          '"If I miss two check-ins, call me. If I miss three, call my mum." Thresholds prevent both over- and under-reacting.',
      },
      {
        heading: 'Update, do not restart',
        body:
          'Plans change. Send a one-line update instead of starting over — a guardian who knows the new ETA will not raise a false alarm.',
      },
    ],
    quiz: [
      {
        id: 'q1',
        question: 'What are the four lines of a complete brief?',
        options: [
          'Where, where to, when, and what to do if you go quiet',
          'Name, age, address, blood group',
          'Route, weather, mood, music',
        ],
        answerIndex: 0,
        explanation: 'Those four lines let a guardian act without guessing.',
      },
      {
        id: 'q2',
        question: 'Why agree a threshold in advance?',
        options: [
          'It stops both over-reacting and under-reacting',
          'It is required by SURAKSHA',
          'It reduces battery use',
        ],
        answerIndex: 0,
        explanation: 'A shared threshold converts a vague worry into a defined action.',
      },
      {
        id: 'q3',
        question: 'Your ETA slips by 20 minutes. What is best?',
        options: [
          'Nothing — it is only 20 minutes',
          'Send a one-line update of the new ETA',
          'End the journey and start a new one',
        ],
        answerIndex: 1,
        explanation: 'A one-line update prevents a guardian from raising a false alarm.',
      },
    ],
  },
];

export const DEMO_PRESET_COORDS: LatLng = { lat: 28.545, lng: 77.1926 };

export const RISK_ZONE_EXPORT = RISK_ZONE;
