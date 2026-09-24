# SURAKSHA — Safety Before SOS

**Proactive safety, not reactive response.**

> “A tool, not a promise — it doesn't end danger; it ensures nobody faces it unseen, and help starts moving before anyone has to call.”

SURAKSHA closes the gap between the moment a situation starts feeling wrong and the moment a person is able or willing to press SOS. It monitors a journey, checks in automatically, notices meaningful route/time anomalies, offers a discreet way out, and escalates progressively to a trusted circle.

It is a **working prototype**, not a slide deck: the whole workflow runs in the browser, end to end.

```
SAFE → MONITOR → CHECK-IN → DEVIATION → ESCALATE → INCIDENT → RESPONSE
```

---

## What SURAKSHA does not claim

This is a hard product rule, enforced in code, copy and tests:

- ❌ It does **not** detect assault or predict criminal behaviour.
- ❌ It does **not** determine that anyone is in danger.
- ❌ It does **not** replace police, ambulance or any emergency service.
- ❌ It never auto-dispatches anything based on a prediction.
- ❌ It never uses machine learning to judge a person.

What it says instead:

- ✅ “Safety Risk Engine detected multiple safety signals.”
- ✅ “Route deviation detected.”
- ✅ “Safety check-in missed.”

A missed check-in is recorded as *nobody answered a routine prompt* — never as proof of danger. The tests assert this copy so it cannot regress.

---

## The experience

### Traveller (mobile-first)
| Screen | What it does |
| --- | --- |
| **Home** | 🟢 SAFE headline, journey status, location, next check-in, ETA, trusted contact, Start Journey / Exit Mode / Quick SOS, recent activity, “Why this score?” |
| **Start Journey** | Destination, starting point, expected arrival (duration *or* clock), check-in interval (5/10/15/30/60/custom), grace period, primary + backup contact, route preset |
| **Active Journey** | Large interactive map (marker, destination, expected corridor, travelled trail, ETA, route status), check-in countdown, **I'M SAFE** / **I NEED HELP**, pause / end / Exit Mode / SOS, demo controls |
| **Exit Mode** | “Need a believable reason to leave?” → 10 s / 2 min / after-safety trigger, caller identity, then a polished simulated incoming call with a scripted transcript |
| **Quick SOS** | 2-second press-and-hold (+ confirm step) → 🔴 CRITICAL, incident created, trusted circle alerted, honest emergency handoff |
| **Trusted Circle** | Primary / backup contacts, add / edit / remove, channel preferences, visual escalation chain |
| **Incidents** | Active incident record + history grid (#SRK-1042 Critical, #SRK-1038 Alert, #SRK-1021 Watch) |
| **Incident detail** | Timeline, itemised risk reasons, evidence with SHA-256 integrity hash, privacy + delete controls |
| **Community** | Verified safe places and practical safety reports (no feed, no names, no live locations) |
| **Learn** | 7 short lessons with 3-question quizzes and “Progress: 4 / 7 completed” |
| **Profile** | Minimum personal data, safety defaults, privacy + retention, delete incident data, demo mode |

### Guardian (desktop-first)
| Screen | What it does |
| --- | --- |
| **Dashboard** | 🟢 ALL CLEAR → 🟡 WATCH → 🟠 ALERT → 🔴 CRITICAL headline, KPIs (active journeys, risk, next check-in, alerts), monitored journey with live map, event timeline, risk explanation, notification log, **ACKNOWLEDGE** |
| **Active Journeys** | Journey list + per-journey monitoring view (map, status facts, risk explanation, people, timeline) |
| **Alerts** | One explained card per state change with traveller, score, location, incident ID and an acknowledgement action |
| **Incidents** | Filterable table (all / open / severity) with status and evidence count |
| **Trusted Contacts** | Circle members, escalation chain, notification preferences, delivery log |
| **Settings** | Guardian scope, monitoring preferences, what a guardian can and cannot do, privacy statement, reset controls |

---

## Architecture

```
src/
├── domain/                  # pure logic, no React
│   ├── types.ts             # the domain model (journey, events, incidents, risk)
│   ├── riskEngine.ts        # Safety Risk Engine — deterministic, explainable
│   ├── journeyMachine.ts    # SAFE → WATCH → ALERT → CRITICAL state machine
│   ├── journey.ts           # journey construction, ETA + link-quality read-outs
│   ├── geo.ts               # simulated map geometry (corridor, deviation, zones)
│   └── seed.ts              # fictional demo data (people, routes, lessons, places)
├── services/                # integration boundaries
│   ├── eventBus.ts          # central event collector + event presentation
│   ├── storage.ts           # localStorage adapter behind an interface
│   ├── backend.ts           # SurakshaBackend façade (swap in Firebase here)
│   ├── notifications.ts     # trusted-circle delivery + receipts (push/SMS/call)
│   └── evidence.ts          # SHA-256 integrity hashing, generated voice notes
├── store/                   # one singleton: state, virtual clock, all actions
│   ├── store.ts             # simulation engine, check-ins, escalation, demo controls
│   └── hooks.ts             # useSyncExternalStore bindings
├── components/
│   ├── ui/                  # design system (cards, buttons, dialogs, HoldButton…)
│   ├── layout/              # AppShell, sidebar, bottom nav, DemoPanel, RoleSwitcher
│   ├── map/JourneyMap.tsx   # interactive SVG map (pan, zoom, follow-cam)
│   └── domain/              # RiskWhyPanel, EventTimeline, CheckInPrompt, SosFlow, ExitMode
└── pages/traveller|guardian # screens
```

### Event-driven core
Every meaningful thing is an event, and the event log is the source of truth for both dashboards:

`journey_started`, `location_updated`, `route_deviation`, `route_restored`, `checkin_sent`, `checkin_completed`, `checkin_missed`, `safe_confirmed`, `help_requested`, `exit_mode_started`, `exit_mode_call_answered`, `sos_triggered`, `incident_created`, `guardian_notified`, `guardian_acknowledged`, `evidence_attached`, `journey_paused`, `journey_resumed`, `journey_ended`, `risk_changed`, `risk_zone_entered`, `late_arrival`, `system_note`

Every event carries `{ id, type, timestamp, journeyId, incidentId, userId, metadata }`.

### Safety Risk Engine (`domain/riskEngine.ts`)
Deterministic rules only. Every point is explained in the “Why this score?” panel, including a signed recovery line.

| Signal | Weight |
| --- | --- |
| Late / past the expected arrival window | **+10** |
| Inside the (fictional) higher-risk demo zone | **+15** |
| Route deviation | **+20** |
| Repeated deviation | **+10** |
| Safety check-in missed | **+25** |
| Each additional missed check-in | **+15** (capped at +30) |
| Explicit distress / Quick SOS | **+50** |
| Confirmed-safe message | **−15** (capped at −30, never discounts an SOS) |

| Band | Score | Meaning |
| --- | --- | --- |
| 🟢 SAFE | 0–29 | No open signals |
| 🟡 WATCH | 30–49 | One signal — confirm with the traveller |
| 🟠 ALERT | 50–74 | Multiple signals — escalate to the circle |
| 🔴 CRITICAL | 75+ | Emergency workflow activated by the traveller |

The state machine is **reversible**: confirmed-safe messages step the score down, ending a journey resolves it, and the underlying events stay in the timeline.

### Simulation instead of GPS
A single virtual clock starts at **10:42 PM** so the seeded scenario reads exactly like the demo script. `store.tick()` advances the clock, moves the traveller along the corridor, raises check-ins, detects misses, streams location updates and re-assesses risk on every tick. Demo speed is 1× / 2× / 4× / 8×. The map is an interactive SVG surface (pan, wheel-zoom, follow-cam, legend) so nothing depends on an external tile service.

### Backend seam
Everything is local-first. `services/backend.ts` defines `SurakshaBackend` (journeys, events, incidents, contacts, alerts, profiles, community, learning). Swap `LocalBackend` for a Firestore implementation and no screen or store code changes. `services/storage.ts` does the same for the storage adapter.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (binds 0.0.0.0)
```

```bash
npm test           # 38 tests: risk engine, engine simulation, demo flow, screen mounting
npm run build      # type-check + production bundle
npm run preview    # serve the build
```

No API keys, no accounts, no network calls at runtime. State lives in `localStorage` under `suraksha.v1.*`.

---

## The 2–3 minute judge script

1. **Open the Demo panel** (top-right “Demo” button, or the sidebar/footer).
2. **Start journey (10:42 PM)** → *Journey started. Your Guardian has been notified.* Land on **Active Journey**: 🟢 SAFE, ETA 30 min, live map, check-in countdown.
3. **Move off route** → 🟡 **ROUTE CHANGED** / “Your route appears different from the expected path. Everything okay?” and the guardian side raises WATCH. Nothing is declared dangerous.
4. **Send + miss the check-in** → 🟠 **SAFETY CHECK-IN MISSED**, +25, an incident record is created and the circle is alerted. The copy stays honest.
5. **Trigger Exit Mode** → 10-second countdown → full-screen simulated incoming call → **Accept** → scripted transcript, labelled *Simulated call*.
6. **Trigger Quick SOS** → 🔴 **CRITICAL**, score **95** (20 route + 25 missed + 50 SOS), Incident **#SRK-1043** with location, guardian notification status, evidence status and the emergency handoff note.
7. **Switch to the Guardian dashboard** (role switcher) → same timeline, risk explanation, **ACKNOWLEDGE** → `guardian_acknowledged` lands in the log and on the incident.
8. **RESET DEMO** to restore the seeded scenario.

Optional flavours: “Stop inside a risk zone (+15)”, “Shift planned arrival earlier (+10 late arrival)”, “Toggle location availability”, “Second deviation (+10)”, speed up the clock to watch check-ins fire on their own.

Demo roles: **Traveller — Aarav Sharma**, **Guardian — Rohan Mehta**, backup **Priya Sharma**. All people, contacts, places and incidents are fictional.

---

## Design system

- Calm, neutral, light interface by default. **Red appears only for genuine CRITICAL state.**
- Status colours: GREEN = SAFE, YELLOW = WATCH, ORANGE = ALERT, RED = CRITICAL.
- 8px spacing rhythm, 12–20px card radii, subtle shadows, tabular numerals for timers and scores.
- Large touch targets, visible keyboard focus everywhere, focus-trapped dialogs, `aria-live` regions for state changes, `prefers-reduced-motion` support.
- Traveller UI is mobile-first (sticky header + bottom navigation with a centre **SOS** button that is always one tap away); the guardian UI is desktop-first with a persistent sidebar. Neither is a shrunken copy of the other.
- Microinteractions are restrained: state transitions, countdowns, score changes, toasts, marker movement, alert appearance, modal transitions. No flashing, no fear-based animation.

---

## Honest limitations

- Location is **simulated** and the map is fictional; coordinates are derived from map geometry for readability.
- Evidence files are generated locally, never uploaded; the integrity hash proves *the stored file has not changed since hashing* — it does not prove what happened.
- Notifications are modelled locally with delivery receipts; no SMS, push or telephony provider is wired up.
- Exit Mode does not place real calls; it is an escape aid, not an emergency action.
- No authentication in the prototype: a demo role switcher stands in for it.
- SURAKSHA is a coordination tool. In a real emergency, call your local emergency service.
