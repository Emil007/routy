# Review Feedback — Routy Phase Plan

**Last updated:** 2026-08-19 (implementation agent)  
**Server:** `main` @ `6bd41b9`  
**Android:** `main` @ `9507d7e`

---

## P0 + P1 — Fixed ✅

All verified and resolved on `main`.

---

## P2 — Fixed ✅ (2026-08-19)

- [x] Route session daily purge — `sweepExpiredRouteSessions()` in `runDailyPurge()`
- [x] Weekly/total points formula — shared `computeBasePoints()`; weekly uses 7-day filter
- [x] Leaderboard perf — single walk_log query + batch base computation
- [x] HTTPS deep link host — manifest `deepLinkHost` + runtime host check in `MainActivity`
- [x] Bootstrap user — shared `BootstrapLoader`; shell uses bootstrap user (no `/me` on launch)
- [x] Bootstrap ETag/304 — `getBootstrapVersion()` + `conditionalJson`; full cache in `NetworkCache`
- [x] RoutyWebView comment — updated for per-tab WebView
- [x] Voice/TTS locale — account locale from bootstrap applied before route UI
- [x] Warm deep links — `RouteViewModel` observes `DeepLinkHolder` after initial load
- [x] `pointsEarned` streak inflation — walk-only base × post-walk multiplier (not lifetime delta)

### Still open (minor)

- [ ] **`acceptSharedRoute` silent fallback** when `routeState()` fails — preview route kept; favorites may be stale
- [ ] **Digital Asset Links** file for production HTTPS App Links verification
- [ ] **Recording map still 280dp** — fullscreen recording overlay (Phase F)

---

## P3 — Verification

- [ ] **Server CI green** on `main` (tests added; awaiting CI)
- [x] **Android CI green** on `main`
- [ ] **Deploy server** before production E2E
- [x] **Smoke tests** — `points.test.ts`, `networkVersion.test.ts`, `conditionalJson.test.ts`
- [ ] **Full `npm install`** when Node available

---

## Recommended Next Steps

1. Confirm server CI on `main`
2. Deploy server for E2E
3. Recording fullscreen map (Phase F)
4. Digital Asset Links for production domain
5. `acceptSharedRoute` retry on `routeState()` failure
