# SURAKSHA — functional fixes and verification

## Architecture and scope

This checkout is a React/Vite local-first prototype. Its backend is `LocalBackend`, backed by browser storage; there is no HTTP API, server database, authentication provider, real microphone capture, or real notification delivery. The existing role switcher, trusted-circle relationships, layouts, routing, risk weights and integrations are retained.

These fixes run end-to-end within that architecture. Guardian scope uses the current demo guardian profile and its explicit trusted-contact association; it is **not server-enforced authentication**. Cross-device authenticated delivery/upload requires a real backend and is not claimed here.

## Changes by issue

| Issue | Root cause | Implemented fix | Verification |
|---|---|---|---|
| Fake Call help | No dedicated usage-help dialog existed. The shield/question-mark call control opened SOS, not help. | Accessible question-mark help buttons on setup and the active call open the existing modal design. Instructions cover starting, accepting, speaking, microphone/speaker controls and ending. Escape, close and “Got it” dismiss help. The help layer is above the call and never changes call/audio state. SOS retains its action, with an unambiguous shield-alert icon. | Component tests plus a Chromium call/help flow. |
| Late-arrival risk | Lateness compared current time with a detour-adjusted ETA that advanced with time, preventing an ongoing detour from becoming overdue. Stored delay rounded away sub-minute overruns. Earlier confirmations could discount a newly overdue signal. The demo control also moved a 30-minute deadline only three minutes earlier, despite claiming to demonstrate lateness immediately. | Compare against agreed expected arrival using one calculation, retaining pause semantics and fractional delay. Reassess on ticks; invalidate prior recovery credit when the new late signal first appears. Keep the existing +10 weight, floors, recovery and caps. Explicit arrival records its time and final delay, then clears live risk. The demo now actually moves the deadline into the past. Alerts snapshot their score/location instead of borrowing a different or newer journey’s score; numeric timeline scores display correctly. | Deadline boundary, continuous detour, earlier/later check-in, end/arrival, event deduplication and score/band assertions; live guardian risk in Chromium. |
| Microphone mute stops caller | The speech effect depended on microphone mute and called `stopVoice()` on mute. | Mute only changes simulated outgoing-microphone state. Incoming speech depends on script progression, not mute. Unmute does not replay/restart speech; ending still cancels it. New calls reset controls; `aria-pressed` reflects state. No microphone permission or recording was introduced. | Speech API spies verify no cancellation/restart and progression while muted; Chromium tests cover mute, unmute, help and ending. |
| Mark All as Read | Action changed memory only; badges counted unacknowledged alerts and cards ignored `read`. All alerts were mutated without recipient scope. | Persist the scoped read update immediately, update card badges and unread navigation counts, and disable the action when none remain unread. Reading stays separate from acknowledgement. Storage failures report errors rather than claiming success. | Component/store persistence, ownership isolation and failure tests; browser badge/read update and reload. |
| Incident evidence | Only hashes/metadata were retained, with no saved bytes or retrieval control. Attachment/removal targeted `activeIncidentId`, not the viewed incident. Async failures were not shown. | Store actual bytes in IndexedDB; explicitly target the viewed incident and its journey. Validate supported type/size, honor capture preference, check ownership/guardian relationship, and recheck after async storage. Metadata must persist before success; failed metadata saves roll back the blob. Offer download on both authorized role views, verify matching hash methods before download, and expose success/error feedback. Delete/reset cleans up files. | File-input component tests; binary round-trip/reload, historical versus active incident, permissions, empty/unsupported/oversized files and quota rollback tests; browser download after reload matches original bytes and is available to the guardian. |
| Guardian check-ins | Only prompted confirmations emitted `checkin_completed`; final events were appended after persistence. No dedicated latest status/timestamp appeared, timelines could show duplicate confirmation cards, and tabs had no subscription. | Every successful safe check-in emits a canonical completion with the correct user/journey and persists the final event/state. Keep the safety audit event but coalesce its paired timeline card. Guard duplicate taps. Show latest check-in state/time for the associated journey, including after ending; unrelated guardians do not see it. Synchronize committed snapshots between same-origin tabs without switching their roles. Guardian simulation yields to an active traveller tab to avoid duplicate timer-generated entries. | Reactive guardian component tests, duplicate/scoping/no-extra-alert assertions, reload and storage-event tests; real two-tab Chromium check-in and guardian reload. |

A safety check-in is not an arrival confirmation. Increasing lateness updates the delay explanation but does not manufacture additional per-minute risk points: the existing scoring rules are unchanged.

## Backend / local database changes

- Added `suraksha.evidence.v1` IndexedDB database, version 1, with a `files` object store containing the file bytes and MIME type.
- Added optional `EvidenceRecord.blobId`, `Journey.arrivedAt`, `UserProfile.contactId`, and alert recipient/traveller/risk/location snapshot fields.
- Extended the local backend with session snapshot load/save/subscription. `suraksha.v1.session` stores the shared committed state and virtual clock, not UI dialogs or the receiving tab’s active role.
- Added a strict durable-write option to the storage adapter for evidence metadata and mark-read operations.
- Existing schema-v4 records remain compatible: fields are additive, missing guardian identity maps only to the original seeded guardian, and the schema version is not bumped or existing records erased by this update.
- Historical attachments that only contain metadata remain visible and explicitly say the original file is unavailable. Missing historical bytes cannot be reconstructed.
- No server schema migration, credentials, new runtime service, cloud upload, or authentication replacement.

Supported evidence: JPEG, PNG, GIF, WebP, PDF, plain text, WAV, MP3, M4A, Ogg, WebM, MP4 and QuickTime MIME types; nonempty and at most 10 MB per file. Downloads are attachments, not inline execution of user content. The local checks do not substitute for server authorization, malware scanning or multi-user security in a future deployment.

## Verification results

- `npm run typecheck`: passed.
- `npm test`: **115 tests passed**, including 14 new targeted component/service/store regressions and the existing User App / Guardian Dashboard route and flow tests.
- `npm run build`: passed. Vite reports a non-fatal bundle-size warning (main chunk just over 500 kB).
- Chromium/Playwright: **4 end-to-end scenarios passed**, repeated three times (**12/12 passes**). Scenarios use actual UI controls and cover all six requested issues, including two-tab updates and file byte equality after download/reload.
- `git diff --check`: passed.

### Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite starts or reuses the Vite development server. `CHROMIUM_PATH` can point to an installed Chromium binary. This sandbox blocked the standard Playwright CDN download; verification used an alternate Chromium 153 binary installed outside the repository. No browser binaries or test artifacts are committed.

### Remaining verification/deployment limits

- Speech synthesis was instrumented in automated tests; physical speaker output, OS voices and mobile autoplay behavior still need device testing.
- No real microphone exists in this prototype, so mute/unmute is correctly simulated; it does not enable an actual outgoing stream.
- Cross-tab synchronization and evidence persistence apply to one browser origin/profile. There is no cross-device guardian delivery or authenticated cloud storage to test.
- Browser storage can be cleared or evicted. Storage unavailability/quota failures are surfaced for these write operations; this is not a cloud backup.
- The current dependency audit reports seven existing findings (five moderate, one high, one critical); no unrelated dependency upgrades were applied. Existing React test warnings are non-failing.
