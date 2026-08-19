# Review Feedback — Routy Phase Plan

**Reviewer role:** Read-only code review (this agent does not modify source code)  
**As of:** 2026-08-19  
**Server branch:** `cursor/routy-embedded-app-apis-0-20` (clean, pushed)  
**Android branch:** `cursor/android-stats-api-me-weekly-ac91` (clean, pushed)

This file tracks deviations from the [Phase Plan](c:\Users\slopr\.cursor\plans\routy_phase_plan_bd829612.plan.md), architectural mistakes, and bugs the implementation agent **must fix immediately**.

---

## Immediate Fixes (Required Checklist)

### P0 — Data corruption / incorrect behavior

- [x] **Recording restore duplicates GPS points** (`routy-android`)  
  Fixed: restore replays JSONL tail only via `appendedPointsAfterSnapshot()`; test in `:logic`.

- [x] **`networkVersion` / ETag stays stale on in-place edits** (`routy`)  
  Fixed: `updated_at` columns + triggers on nodes/segments; fingerprint uses `MAX(updated_at)`.

- [x] **Deep link resolved multiple times** (`routy-android`)  
  Fixed: single `consumeDeepLink()` after bootstrap; `pendingShareToken` in `RouteUiState`.

- [x] **Completion dialog shows wrong points** (`routy-android`)  
  Fixed: `/api/route/complete` returns `pointsEarned`; dialog shows walk delta.

### P1 — Functional bugs / plan violations

- [x] **`routeCompleted()` is dead code** (`routy-android`)  
  Fixed: called on final waypoint in `ActiveTrackingEffects`.

- [x] **Track progress off-by-one** (`routy-android`)  
  Fixed: `completedCount` is 0 when `completedWaypointIndex == -1`.

- [x] **`acceptSharedRoute()` does not resync server state** (`routy-android`)  
  Fixed: refreshes via `routeState()` + `applyNetworkState` after accept.

- [x] **Recording CONFIRM phase lost on process kill** (`routy-android`)  
  Fixed: CONFIRM snapshot restored; `RecordingScreen` loads points into confirm UI.

- [x] **`package-lock.json` out of sync with `package.json`** (`routy`)  
  Fixed: lockfile name/version aligned to `routy` / `0.20.0` (run `npm install` locally to refresh dependency tree if needed).

- [x] **Unused import in `generateRateLimit.ts`** (`routy`)  
  Fixed: removed unused `db` import.

- [x] **Update checker compares wrong versions** (`routy`)  
  Fixed: `isUpdateAvailable()` compares against `APP_VERSION`.

### P2 — Architecture / plan deviations (resolve before merge)

- [ ] **Route session purge missing from daily job** (`routy`)  
  Plan A3: "purge expired auth/**route** sessions daily". `purgeSchedule.ts` only deletes DB `sessions`. Route suggestion tokens live in-memory in `routeSessions.ts` with lazy `sweep()` only on `createRouteSession`.  
  **Fix:** Wire `sweep()` into `runDailyPurge()` **or** document in plan/README that route sessions are intentionally in-memory + lazy only.

- [ ] **Weekly vs total points formula inconsistent** (`routy`)  
  `computeUserPoints`: `totalPoints` includes elevation + exploration; `weeklyPoints` only walks + distance. Leaderboard semantics conflict (Phase D4).  
  **Fix:** Same base formula with a 7-day window, or rename/document API fields clearly.

- [ ] **`getPointsLeaderboard` is O(users × walks)** (`routy`)  
  Calls `computeUserPoints()` per user → full walk + segment scan. Does not scale.  
  **Fix:** Aggregated SQL query or cached materialization before D4 goes live.

- [ ] **HTTPS deep link without `android:host`** (`routy-android`)  
  Manifest: `pathPrefix="/share/"` with no host → matches **any** HTTPS domain with that path. App Links cannot be verified; security/UX risk.  
  **Fix:** Set production host (e.g. from `BuildConfig.BASE_URL`) + Digital Asset Links.

- [ ] **Bootstrap user ignored** (`routy-android`)  
  `AppBootstrapResponse.user` is unused; shell fetches `/api/auth/me` separately. Extra round trip; locale/role arrive later than needed.  
  **Fix:** Pass bootstrap user into shell/route (Plan G2 "instant cached startup").

- [ ] **Bootstrap ETag / 304 not used** (`routy-android`)  
  `ApiService.bootstrap()` supports `If-None-Match`, but `RouteViewModel.loadInitial()` never sends a cached ETag.  
  **Fix:** Store ETag in `NetworkCache` and send it on bootstrap.

- [ ] **Stale comment in `RoutyWebView.kt`** (`routy-android`)  
  Claims "no per-tab state", but shell uses `key(currentTab.path)` per tab. Update the comment or Phase G1 work may be undone by mistake.

- [ ] **Voice strings vs TTS locale split** (`routy-android`)  
  TTS uses account locale; cue text uses `stringResource()` (device/AppCompat). DE account + EN device → mixed language.  
  **Fix:** Drive cues from account-locale strings or server locale (Plan G3).

### P3 — Verification before merge (no code, but blocking)

- [ ] **Server CI green:** `npm run lint`, `npm test`, `npm run build` on `cursor/routy-embedded-app-apis-0-20`
- [x] **Android CI green:** `:logic:test`, `:app:assembleDebug`, `:app:lintDebug` on `main`
- [ ] **Deploy/merge server branch** before Android Phase B/C E2E against production (endpoints: `/api/app/*`, `/api/share/*`, points leaderboard)
- [ ] **No tests for new server modules:** `points.ts`, `networkVersion.ts`, `conditionalJson.ts`, app API routes — add at least smoke tests for ETag bump and points formula

---

## What Is Correctly Implemented (Summary)

| Area | Status |
|------|--------|
| A1 Embedded NavBar (`showHeaderChrome`, `showUserbar`, layout `embedded`) | ✅ |
| A2 `package.json` name/version + `formatVersionDisplay` → "0.2" | ✅ (lockfile missing) |
| A3 activity_log 180d, auth-session purge, quick_check, health, generate rate limit, restore docs | ⚠️ route sessions missing |
| A4 `/api/app/stats/me`, `/leaderboard/weekly`, `/bootstrap`, ETag on nodes/segments | ⚠️ ETag bug |
| B Stats API, logout, admin role, `.gitignore` | ✅ |
| C Share manifest, MainActivity, API, RouteViewModel preview/accept | ⚠️ triple handler |
| D WaypointProgressTracker, track UI, progress store, keep-screen-on | ⚠️ cues/points UI |
| E RecordingSnapshot + session restore | ⚠️ duplicate bug |
| F Route fullscreen map + route-only fit | ⚠️ recording still 280dp |
| G NetworkCache, per-tab WebView, partial locale | ⚠️ ETag/backoff open |

---

## Recommended Fix Order for the Implementation Agent

1. Recording restore dedup (P0)  
2. `networkVersion` fix + lockfile (P0/P1)  
3. Single deep-link consume path (P0)  
4. Completion points + `routeCompleted()` + track display (P1)  
5. `acceptSharedRoute` resync + CONFIRM restore (P1)  
6. CI green + server before Android E2E (P3)  
7. Remaining P2 items before Phase D4 merge

---

## Notes for This Reviewer Agent

- Source code stays **read-only** for this agent.
- Add new findings as `[ ]` checkboxes; the implementation agent marks done items as `[x]`.
- On new commits: re-verify P0/P1 items against the files listed above.
