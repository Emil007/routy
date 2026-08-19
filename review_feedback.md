# Review Feedback — Routy Phase Plan

**Reviewer role:** Read-only code review (this agent does not modify source code)  
**Last verified:** 2026-08-19 (re-review after P0/P1 fixes)  
**Server:** `main` @ `2d14b85` (`fix: sync package-lock root package metadata`)  
**Android:** `main` @ `e91d330` (`fix(android): address P0/P1 review feedback`)

This file tracks deviations from the [Phase Plan](c:\Users\slopr\.cursor\plans\routy_phase_plan_bd829612.plan.md), architectural mistakes, and bugs the implementation agent must fix.

---

## P0 + P1 — Verified Fixed ✅

All items below were re-checked against current `main`. Implementations look correct.

### P0 — Data corruption / incorrect behavior

- [x] **Recording restore duplicates GPS points** (`routy-android`)  
  Verified: `appendedPointsAfterSnapshot()` in `:logic` replays only the JSONL tail not already in the snapshot; unit test in `RecordingRestoreTest.kt`. Service skips JSONL replay for `CONFIRM` phase.  
  Files: `RecordingForegroundService.kt` (82–89), `RecordingRestore.kt`, `RecordingRestoreTest.kt`

- [x] **`networkVersion` / ETag stays stale on in-place edits** (`routy`)  
  Verified: `updated_at` columns + `AFTER UPDATE` triggers on nodes/segments in `db.ts`; fingerprint uses `MAX(updated_at)` in `networkVersion.ts`.

- [x] **Deep link resolved multiple times** (`routy-android`)  
  Verified: init-time `openShareToken()` removed; single `consumeDeepLink()` after bootstrap; `pendingShareToken` lives in `RouteUiState`; `DeepLinkHolder` removed from `RouteScreen.kt`.

- [x] **Completion dialog shows wrong points** (`routy-android` + `routy`)  
  Verified: `/api/route/complete` returns `pointsEarned`, `streakMultiplier`, `currentStreak`; Android stores in `completionPointsEarned` and dialog shows walk delta.

### P1 — Functional bugs / plan violations

- [x] **`routeCompleted()` dead code** — called when `completed >= route.stations.lastIndex` in `ActiveTrackingEffects`.
- [x] **Track progress off-by-one** — `completedCount` is 0 when `completedWaypointIndex == -1`.
- [x] **`acceptSharedRoute()` resync** — calls `routeState()` + `applyNetworkState` on success.
- [x] **Recording CONFIRM phase restore** — `restoreIfNeeded()` no longer skips CONFIRM; `RecordingScreen` loads points into confirm UI via `recordedPoints()`.
- [x] **`package-lock.json` metadata** — root name/version aligned to `routy` / `0.20.0` (metadata only; full `npm install` still recommended).
- [x] **Unused import in `generateRateLimit.ts`** — removed.
- [x] **Update checker version compare** — uses `APP_VERSION` not `APP_VERSION_DISPLAY`.

---

## P2 — Architecture / plan deviations (still open)

- [ ] **Route session purge missing from daily job** (`routy`)  
  `purgeSchedule.ts` only deletes DB `sessions`. Route suggestion tokens in `routeSessions.ts` rely on lazy `sweep()` on create.  
  **Fix:** Wire `sweep()` into `runDailyPurge()` or document as intentional.

- [ ] **Weekly vs total points formula inconsistent** (`routy`)  
  `totalPoints` includes elevation + exploration; `weeklyPoints` only walks + distance.  
  **Fix:** Align formulas or rename/document fields before D4 goes live.

- [ ] **`getPointsLeaderboard` is O(users × walks)** (`routy`)  
  **Fix:** Aggregated SQL or cached materialization.

- [ ] **HTTPS deep link without `android:host`** (`routy-android`)  
  Manifest still matches any HTTPS host with `/share/` path.  
  **Fix:** Production host + Digital Asset Links.

- [ ] **Bootstrap user ignored** (`routy-android`)  
  `AppBootstrapResponse.user` unused; shell still calls `/api/auth/me` separately.

- [ ] **Bootstrap ETag / 304 not used** (`routy-android`)  
  `RouteViewModel.loadInitial()` never sends cached ETag to `bootstrap()`.

- [ ] **Stale comment in `RoutyWebView.kt`** (`routy-android`)  
  Still claims "no per-tab scroll-position/state preservation" while shell uses `key(currentTab.path)` per tab.

- [ ] **Voice strings vs TTS locale split** (`routy-android`)  
  TTS uses account locale; cue text uses device `stringResource()`.

### New findings from re-review (add to P2)

- [ ] **Warm deep links not consumed while app is running** (`routy-android`)  
  `MainActivity.onNewIntent` calls `DeepLinkHolder.setShareToken()`, but `RouteViewModel.consumeDeepLink()` only runs inside `loadInitial()`. If the app is already open on the Route tab, a new share link is stored but never resolved until process death / ViewModel recreation.  
  **Fix:** Observe `DeepLinkHolder` in `RouteViewModel` (or shell) and call `consumeDeepLink()` when a token arrives after initial load.

- [ ] **`pointsEarned` delta includes streak-tier recalculation** (`routy`)  
  `/api/route/complete` computes `after.totalPoints - before.totalPoints`. If completing a walk bumps the streak tier (e.g. 6 → 7 days), the multiplier applies retroactively to all historical points, inflating `pointsEarned` beyond what this walk alone earned.  
  **Fix:** Compute walk-only base points before applying multiplier, or return explicit breakdown from `recordWalk`.

- [ ] **`acceptSharedRoute` silent fallback when `routeState()` fails** (`routy-android`)  
  On accept success, if `routeState()` fails, UI still sets `mode = ACTIVE` using the in-memory preview route. Acceptable fallback but nickname/favorites may be stale. Consider surfacing an error or retry.

---

## P3 — Verification before merge (still open)

- [ ] **Server CI green** on `main` — lint, test, build (user reports in progress; not verified locally — `npm` unavailable in reviewer environment)
- [x] **Android CI green** on `main` — `:logic:test`, `:app:assembleDebug`, `:app:lintDebug` (per implementer; not re-verified here)
- [ ] **Deploy/merge server** before Android Phase B/C E2E against production
- [ ] **Server smoke tests** for `points.ts`, `networkVersion.ts`, `conditionalJson.ts`, app API routes
- [ ] **Full `npm install`** on server repo to refresh dependency tree (lockfile metadata only was patched)

---

## Status Summary (updated)

| Area | Status |
|------|--------|
| A1 Embedded NavBar | ✅ |
| A2 Version 0.20.0 / display 0.2 | ✅ (run `npm install` for full lockfile sync) |
| A3 Ops hygiene | ⚠️ route-session daily purge still open |
| A4 App APIs + ETag | ✅ (P0 fix verified) |
| B Stats API, logout, admin role | ✅ |
| C Share deep links | ⚠️ cold start OK; warm deep link gap (P2) |
| D Tracking, cues, completion points | ✅ (P0/P1 fixes verified) |
| E Recording persistence + CONFIRM restore | ✅ |
| F Fullscreen map | ⚠️ recording still 280dp; scroll/pan conflicts remain |
| G NetworkCache, per-tab WebView, locale | ⚠️ bootstrap user/ETag/backoff open |

---

## Recommended Next Steps for Implementation Agent

1. Confirm server CI green on `main`  
2. Warm deep-link handling (new P2 — quick win for Phase C)  
3. Bootstrap user + ETag caching (Phase G)  
4. HTTPS App Links host (Phase C hardening)  
5. Points formula / leaderboard scaling (Phase D4 prep)  
6. Route session purge or document  
7. Server smoke tests  
8. Full `npm install` when Node is available

---

## Notes for This Reviewer Agent

- Source code stays **read-only** for this agent.
- Add new findings as `[ ]` checkboxes; implementation agent marks done as `[x]`.
- Re-verify P0/P1 on new commits touching the listed files.
