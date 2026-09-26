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
| **Welcome** (`/welcome`) | Landing page: “What is SURAKSHA?” — the flow story (Journey → Detect → Check-in → Escalate → Respond) with every step linking to the real feature. Reached from Home’s “How SURAKSHA works” link |
| **Home** | Minimalist, status-first: calm status medallion (You’re safe / Watch / Alert / Critical), origin → destination, “Why this status?” link, one primary **Start journey** / **Journey active** button, and the SOS card — **SIGN IN** while signed out, per the sign-in-gateway rule. Everything else (circle, incidents, exit mode, community…) stays in the existing navigation |
| **Start Journey** | Destination, starting point, expected arrival (duration *or* clock), check-in interval (5/10/15/30/60/custom), grace period, primary + backup contact, route preset |
| **Active Journey** | Large interactive map on real Google tiles (marker, destination, expected corridor, travelled trail, ETA, route status; the header states live vs simulated surface), check-in countdown, **I'M SAFE** / **I NEED HELP**, pause / end / Exit Mode / SOS, demo controls |
| **Exit Mode** | “Need a believable reason to leave?” → 10 s / 2 min / after-safety trigger, caller identity, then a polished simulated incoming call with a scripted transcript |
| **Quick SOS** | **One tap** → 🔴 CRITICAL, incident created, trusted circle alerted, honest emergency handoff, and a real `tel:112` link the traveller presses themselves |
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
| **Help request** | When the traveller presses *I need help*, the guardian gets a pop-up with the traveller's name, last known position, score/band, escalation order and a live countdown before it escalates to the whole circle. **ACKNOWLEDGE** closes it |
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
| Late / past the expected arrival window (detours included) | **+10** |
| Inside the (fictional) higher-risk demo zone | **+15** |
| Route deviation | **+20** |
| Repeated deviation | **+10** |
| Safety check-in missed | **+25** |
| Each additional missed check-in | **+15** (capped at +30) |
| Location lost — the traveller has gone dark | **+25** |
| Location updates have stopped | **+10** |
| Explicit distress / Quick SOS | **+50** |
| Confirmed-safe message | **−15** (capped at −30, never discounts an SOS) |
| Compounding, per *additional unrelated* signal family | **+6** (capped at +18) |
| Pairing bonus: in a flagged zone *and* not answering | **+10** |
| Pairing bonus: location lost *and* not answering | **+10** |
| Ceiling for passively detected signals | **74** |

Signals are grouped into families — `late` · `zone` · `deviation` · `checkin` · `location` · `sos` — so a deviation and a *repeated* deviation count as one worry, not two. Unrelated families stacking up is what compounds, and only to a cap. Compounding is forced to zero while an explicit SOS is active: an SOS resolves the uncertainty that compounding models.

| Band | Score | Meaning |
| --- | --- | --- |
| 🟢 SAFE | 0–29 | No open signals |
| 🟡 WATCH | 30–49 | One signal — confirm with the traveller |
| 🟠 ALERT | 50–74 | Multiple signals — escalate to the circle |
| 🔴 CRITICAL | 75+ | Emergency workflow activated by the traveller |

Two invariants hold, and both are tested:

- **Passive signals never reach CRITICAL.** The score is held at 74. CRITICAL is reserved for the traveller explicitly activating the emergency workflow.
- **An explicit SOS is always CRITICAL.** +50 alone would land in ALERT, so the score is floored at 75 — the number and the band can never contradict.

The band is no longer purely score-based. The heaviest single signal is +25, so a purely score-based band meant **no single signal could ever leave SAFE** — a traveller who had gone completely silent still read “everything looks normal”. While any signal is open, the band is floored at WATCH and the difference is emitted as its own explained reason line. The floor is gated on *unrecovered* worries, so a confirmed-safe message still steps the score down instead of being dragged back up.

Every clamp — the passive ceiling, the SOS floor, the WATCH floor and the 100 cap — appears as its own line in “Why this score?”, and the reason deltas always sum to the displayed score.

The state machine is **reversible**: confirmed-safe messages step the score down, ending a journey resolves it, and the underlying events stay in the timeline.

Measured behaviour (pinned by tests):

| Scenario | Score | Band |
| --- | --- | --- |
| Any single signal (late, zone, deviation, missed check-in, location lost) | 30 | WATCH |
| Zone + missed check-in | 56 | ALERT |
| Zone + missed + late | 72 | ALERT |
| Zone + missed + location lost | 74 | ALERT (at the passive ceiling) |
| Killer flow: deviation + missed + SOS | 95 | CRITICAL |
| SOS alone | 75 | CRITICAL |
| One deviation, then “I'm safe” | 5 | SAFE |

### Arrival timing

Lateness is measured against the agreed `expectedArrivalAt`, not the moving detour-adjusted ETA shown as an estimate. The existing +10 late-arrival weight, WATCH floor, recovery rules and passive ceiling are unchanged: delay updates the reason text but is not a new per-minute penalty. A check-in confirms safety, not arrival. Ending as arrived records `arrivedAt` and the final delay, then resolves live risk. Pauses retain their existing deadline-freezing behavior.

### Simulation instead of GPS
A single virtual clock starts at **10:42 PM** so the seeded scenario reads exactly like the demo script. `store.tick()` advances the clock, moves the traveller along the corridor, raises check-ins, detects misses, streams location updates and re-assesses risk on every tick. Demo speed is 1× / 2× / 4× / 8×. The map is an interactive SVG surface (pan, wheel-zoom, follow-cam, legend) so nothing depends on an external tile service.

### The map: Google tiles, with an honest fallback
One env var gives SURAKSHA a real basemap. The Google map is the map of record — there is no basemap switch on the map itself — and the built-in canvas is what it degrades to when there is no key, Google refuses the key, or the network blocks the script. A fallback that looks like the product is a bug on a safety screen, so every map card header states which one you are looking at.

```bash
cp .env.example .env      # VITE_GOOGLE_MAPS_API_KEY="AIza…"  (the VITE_ prefix is mandatory)
npm run dev               # restart — Vite freezes env values at build time
npm run maps:check         # "is the key actually arriving?", from the terminal
```

A variable set in the host (Vercel → Project Settings → Environment Variables) is picked up two ways. Vite still inlines `VITE_*` at build time when the build can see it (including `GOOGLE_MAPS_API_KEY` without the prefix, which the Vite config forwards). The website also requests `/api/maps-config` on each load and uses that response over a stale baked-in value, so a key saved in the dashboard — including one Vercel only injects at runtime — shows up on the next page load without another build. Where to check it, in order of convenience:

| Where | What you get |
| --- | --- |
| `npm run maps:check` | Which `.env` file Vite will read, the variable's source, the mask, the shape — exit code 0 only when usable. Add `--json` for CI. |
| The badge on every map | Green "Live map · AIza…abcd" or amber "No Maps key — simulated map", echoed as a chip in the card header. Click it for the full readout, the fix list, a **Test connection** button, a this-tab-only key field (`sessionStorage`, for previews where you cannot rebuild) and **Force the simulated fallback** for demos. |
| Profile → Live map, Guardian → Settings, the Demo panel | The same panel, in the UI. |
| `surakshaMaps` in the devtools console | `.status()` (object) · `.check()` (text) · `.test()` (really load the script) · `.useKey('AIza…')` · `.clearKey()` · `.live()` / `.simulated()`. Also `window.__SURAKSHA__.maps`, and a boot banner in `npm run dev`. |
| `?maps=live` · `?maps=sim` · `?maps=debug` | Force the surface for one page load (`sim` = the fallback, for a screen-recording or an offline demo), or open the key check directly. Used by the e2e runs. |

The live surface draws the corridor, travelled trail, deviation branch, pins, traveller marker and landmark labels through `toLatLng()`; the header on Active Journey, the guardian dashboard and both journey screens read the same `mapSurfaceCopy()` sentence, so the words cannot drift from the pixels.

Implementation notes: `config/googleMaps.ts` resolves and inspects the key, `services/googleMapsApi.ts` is the hand-written loader (one script tag, one promise, no `@react-google-maps/*` dependency) plus the single `getGoogleMapsStatus()` object every surface reads, and `components/map/GoogleMapLayer.tsx` projects the existing geometry through `toLatLng()` instead of duplicating it. Live mode uses `google.maps.Marker` (no Map ID needed), `gestureHandling: 'cooperative'` so the page still scrolls, and `role="img"` with the same text summary the SVG carries. Key restrictions (HTTP referrer, "Maps JavaScript API" enabled) are the top cause of a refused key, so `gm_authFailure` is surfaced as its own state rather than a blank tile area.

Nothing else in SURAKSHA depends on Google: the risk engine, check-ins, escalation and the whole judge script run identically with the variable absent — only the basemap changes.

### Build hygiene
Two traps here already cost a debugging session, and both are guarded now:

- `typecheck` must be `tsc --noEmit -p tsconfig.json`. It used to be `tsc -b --noEmit false`, which **emitted `.js` files next to the sources**; Vitest then resolved the stale `.js` instead of the `.ts`/`.tsx`, so code edits appeared to have no effect.
- That same command emitted a root `vite.config.js`, and Vite resolves `.js` config **before** `.ts` — silently shadowing the real config. It is removed, and `.gitignore` now blocks `src/**/*.js`, `src/**/*.d.ts` and `/vite.config.js`. `postcss.config.js` and `tailwind.config.js` are legitimately JS and must be kept.

Also: use `npm run typecheck`, never `npx tsc` — that installs the unrelated `tsc@2.0.4` stub package.

### Backend seam
Everything is local-first. `services/backend.ts` defines `SurakshaBackend` (journeys, events, incidents, contacts, alerts, profiles, community, learning). Swap `LocalBackend` for a Firestore implementation and no screen or store code changes. `services/storage.ts` does the same for the storage adapter.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (binds 0.0.0.0)
```

```bash
npm test           # unit/component regressions, including both role views
npm run maps:check # is the optional VITE_GOOGLE_MAPS_API_KEY arriving?
npm run build      # type-check + production bundle
npm run preview    # serve the build
npx playwright install chromium
npm run test:e2e    # real-browser flows, including two-tab synchronization
```

No API keys are required (the only optional ones are `VITE_GOOGLE_MAPS_API_KEY` for real map tiles and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` for Supabase Auth — see the sections below), no accounts, no network calls at runtime. Metadata lives in `localStorage` under `suraksha.v1.*`; evidence bytes are stored in IndexedDB (`suraksha.evidence.v1`). Tabs on the same browser origin synchronize committed journey/check-in/alert updates.

### Sign-in & Supabase Auth

The **QUICK SOS** button is the sign-in affordance: signed out, every SOS surface (header, mobile centre tab, home hero) reads **SIGN IN** and opens `/login`. The login page carries the product story while keeping one obvious way in.

- **Email magic link (OTP)** — routed through Supabase Auth when a project is linked.
- **Google / GitHub** — OAuth, needs the providers enabled in Supabase Auth.
- **Local demo fallback** — with no project linked the app signs you in on-device (clearly labelled “demo mode”). This keeps the zero-config build working.

Link a project either from the **“Connect your Supabase project”** card on `/login`, or via build env:

```bash
cp .env.example .env   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public anon key)
```

Only the project URL and the **anon/public** key are ever stored or read — never the `service_role` secret. `services/supabase.ts` lazy-creates the client, so an unlinked checkout boots with no Supabase at all.

### Maps-style routing

Both **Start Journey** (planning) and **Active Journey** (live) carry a Google-Maps-shaped route panel:

- **Mode tabs** — Fastest, Walking, Cycling, Car, and a paid “SURAKSHA Guard” tier.
- **Depart / arrive-by** — leave now, a custom departure time, or “arrive by” (the departure time is solved from the ETA).
- **Traffic model** (light / moderate / heavy) and a **custom speed** slider (0.2×–3×).
- **Avoid options** — ferries, highways, tolls.
- **Turn-by-turn steps** and a **Recalculate** refresh, with every number labelled an *estimate* on SURAKSHA's demo map.

Chosen preferences are stored on the journey, and the live panel can re-plan the running ETA (guardians see the same estimate).

---

## The 2–3 minute judge script

1. **Open the Demo panel** (top-right “Demo” button, or the sidebar/footer).
2. **Start journey (10:42 PM)** → *Journey started. Your Guardian has been notified.* Land on **Active Journey**: 🟢 SAFE, ETA 30 min, live map, check-in countdown.
3. **Move off route** → 🟡 **ROUTE CHANGED** / “Your route appears different from the expected path. Everything okay?” and the guardian side raises WATCH. Nothing is declared dangerous.
4. **Send + miss the check-in** → 🟠 **SAFETY CHECK-IN MISSED**, +25, an incident record is created and the circle is alerted. The copy stays honest.
5. **Trigger Exit Mode** → 10-second countdown → full-screen simulated incoming call → **Accept** → the caller **speaks** the scripted line through the device (labelled *Simulated call*); **Mute** changes the simulated microphone state without interrupting the caller. The **?** button opens dismissible usage help; no real microphone is accessed.
6. **Trigger Quick SOS** (*one tap*) → 🔴 **CRITICAL**, score **95** (20 route + 25 missed + 50 SOS), Incident **#SRK-1043** with location, guardian notification status, evidence status, a real **Call 112 now** link the traveller presses themselves, and the honest handoff note.
6b. **Press “I NEED HELP”** on a check-in → the help panel opens with a grace countdown, and the guardian's role view shows the help pop-up with the same countdown. Leave it unanswered and it escalates to the whole circle on its own.
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
- Traveller UI is mobile-first (sticky header + bottom navigation with a centre **SOS** button that is always one tap away — it doubles as the **SIGN IN** affordance while signed out); the guardian UI is desktop-first with a persistent sidebar. Neither is a shrunken copy of the other.
- Microinteractions are restrained: state transitions, countdowns, score changes, toasts, marker movement, alert appearance, modal transitions. No flashing, no fear-based animation.

---

## Honest limitations

- Location is **simulated** and the map is fictional; coordinates are derived from map geometry for readability.
- Evidence can be selected from the device or generated as a demo note. Bytes are persisted locally in IndexedDB, never uploaded to a server. Supported images, PDF, text, audio and video are limited to 10 MB each; active HTML/SVG/executable files are rejected. Downloads remain available after reload. Older metadata-only attachments cannot recover their original bytes and must be reattached. The hash can detect changes to the file; it does not prove what happened.
- Notifications are modelled locally with delivery receipts; no SMS, push or telephony provider is wired up.
- Exit Mode does not place real calls; it is an escape aid, not an emergency action. It *does* speak its scripted lines through the device's own Web Speech API once the traveller accepts the call, and falls back to text-only silence wherever speech synthesis is unavailable. There is deliberately **no ringtone**: it would have to start from a timer rather than a user gesture, and browsers would block it.
- **112 is offered, never dialled.** An explicit SOS surfaces a real `tel:` link that the traveller presses themselves, and the incident records that they did. No passively detected signal can reach a number — the gate lives in the domain layer, and a record with no recorded origin fails closed.
- **The WATCH floor is a deliberate product decision**, not an accident: it keeps WATCH meaning “confirm with the traveller” while making sure one open signal is never hidden behind a SAFE headline. If you disagree with it, remove the `band_floor` block in `riskEngine.ts` — nothing else depends on it.
- Authentication: the sign-in flow supports Supabase Auth (email OTP + OAuth) and an honest local fallback. Without a linked project, the local sign-in is an on-device fixture, not a real identity check — the UI says so.
- SURAKSHA is a coordination tool. In a real emergency, call your local emergency service (112 in India).


## Functional fixes and verification

See [the implementation and verification report](docs/functional-fixes.md) for root causes, local database changes, test coverage and prototype limitations.
