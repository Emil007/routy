# Routy HTTP API

Shared contract between the **web app**, **native Android app**, and any future clients.

- **Base URL:** user-configured (e.g. `https://routy.example.com/`)
- **Auth:** `Authorization: Bearer <token>` (Android) or session cookie (browser). Same token from `POST /api/auth/login`.
- **Errors:** JSON `{ "error": "<code>" }` unless noted. Common: `unauthorized`, `invalid_json`.
- **Version:** server display `0.46s` (`package.json` `"0.46s"`).

## Auth & profile

| Method | Path | Body / params | Response | Notes |
|--------|------|---------------|----------|-------|
| POST | `/api/auth/login` | `{ username, password, deviceName?, totpCode?, captchaToken? }` | `{ token, user }` | Sets cookie for web; Android stores `token`. |
| POST | `/api/auth/setup` | `{ setupToken, username, password, displayName?, locale?, deviceName?, captchaToken? }` | `{ token, user }` | First-user registration (native onboarding). `409 already_setup` if users exist. |
| POST | `/api/auth/logout` | — | `{ ok: true }` | |
| GET | `/api/auth/me` | — | `{ user }` | |
| GET | `/api/auth/sessions` | — | `{ sessions[] }` | |
| DELETE | `/api/auth/sessions/:sessionId` | — | `{ ok: true }` | Revoke one session (web account page + Android). |
| POST | `/api/auth/sessions/revoke-others` | — | `{ revoked }` | |
| PATCH | `/api/app/profile` | `{ locale?, theme?, walkSpeedKmh? \| null }` | `{ user }` | Send `"walkSpeedKmh": null` to clear override. |

**Account security (password change, TOTP enable/disable, account deactivation):** dedicated page at `/settings/account` — native Android opens that page in an authenticated in-app WebView sheet (`{serverUrl}/settings/account`). Browser `/settings` links to it; web lists sessions with per-session revoke.

## Bootstrap & health

| Method | Path | Response | Notes |
|--------|------|----------|-------|
| GET | `/api/app/bootstrap` | nodes, segments, `user` (incl. `homeNodeId`), routeState, avoidSegmentIds, segmentConditions, lockProposals, todayGoldenSegmentIds, game, … | `If-None-Match` / `ETag` supported. |
| GET | `/api/health` | `{ status, version, versionDisplay, dbReachable }` | Public liveness only — no setup/captcha/network fingerprinting. |
| POST | `/api/health` | `{ status, version, …, nodeCount, segmentCount, lastBackupAt }` | Admin-only detailed health. |
| GET | `/api/auth/public-config` | `{ needsSetup, captcha }` | Login/onboarding bootstrap (not health). |

## Route wizard

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/route/generate` | `{ startNodeId?, destinationNodeId?, mustVisitNodeIds?, requiredSegmentIds?, excludedSegmentIds?, explorerMode?, surpriseMode?, preset?, forceGolden?, waypointNodeId?, preserveMustVisitOrder? }` | `{ token, route, pointPreview?, goldenHits?, goldenHitIds?, lengthRelaxed?, lengthKm?, usingNetworkFallback?, mustVisitOrder?, routeQuality?, closedNodeWarnings? }` |
| POST | `/api/route/widen` | `{ token }` | `{ token, route, pointPreview?, goldenHits?, goldenHitIds?, lengthRelaxed?, tolerancePercent? }` |
| POST | `/api/route/adjust` | `{ token, direction }` | `{ token, route, pointPreview?, goldenHits?, goldenHitIds?, lengthRelaxed? }` |
| POST | `/api/route/reverse` | `{ token }` | `{ token, route, pointPreview?, goldenHits?, goldenHitIds? }` | Flip node chain / segment directions (reverse pairs). `400 cannot_reverse` when not reversible. |
| POST | `/api/route/guide/start` | `{ orderedNodeIds: number[] (max 12), loopBack?: boolean }` | `{ token, route, pointPreview?, guideMode: true, pointsMultiplier: 0.7, orderedNodeIds }` | Routeless node guide: Dijkstra legs between consecutive nodes (+ optional loop). Session `walkMode=guide`. |
| POST | `/api/route/guide/accept` | `{ token }` | `{ success, guideMode: true, pointsMultiplier: 0.7 }` | Sets active route with `walk_mode='guide'`. |
| POST | `/api/route/accept` | `{ token }` | `{ success: true }` | Active route stored server-side (honours session `walkMode`). |
| POST | `/api/route/reposition-node` | `{ nodeId, lat, lng, accuracyM? }` | `{ ok, offPathWarning }` | Active route required. Owner/admin only. Node must be within `accuracyM+30` m of GPS (default 35 m → 65 m). `offPathWarning: true` when move >25 m. |
| POST | `/api/route/cancel` | `{ token }` | `{ success: true }` | |
| POST | `/api/route/complete` | `{ trackPoints? }` | `{ walkId, pointsEarned, streakMultiplier, currentStreak, pointBreakdown, goldenHits?, celebrationTier?, guideMode?, pointsMultiplier?, … }` | Optional GPX-like `trackPoints`: `{ lat, lng, ele?, time?, accuracy?, speed?, bearing? }[]` stored on `walk_log.track_json` / `walk_track`. Points ledger: stores breakdown + multiplier on `walk_log` once. First walk of the day uses streak+1 for the multiplier. **Guide mode** (`walk_mode='guide'`): points × `0.7` after streak multiplier. Clears active route in the same transaction (double-complete → `no_active_route`). |
| POST | `/api/route/discard` | — | `{ ok: true }` | |
| GET | `/api/route/state` | — | active route or empty | |
| POST | `/api/route/nickname` | `{ nickname }` | `{ ok: true }` | Active route label. |
| POST | `/api/app/walks/rate` | `{ walkId, rating: 1–5 }` | `{ ok: true }` | Length taste after complete (`1–2` short, `3` normal, `4–5` long). Recomputes user taste medians after ≥3 ratings. |

**Generate constraints:** `mustVisitNodeIds` (ordered; prefer over deprecated `waypointNodeId`). `requiredSegmentIds` must appear (or reverse pair). `excludedSegmentIds` hard-dropped for this search only (distinct from soft avoid). Session stores constraints + `preset` + `forceGolden`; widen/adjust honor them.

**Presets:** `short` \| `normal` \| `long` \| `surprise`. Length band from per-user taste after 3 rated walks; else network `suggest_min_km` / `suggest_max_km`. Impossible band → shortest/closest feasible under constraints with `lengthRelaxed: true` + `lengthKm` (never 404 for km alone). `usingNetworkFallback: true` on the generate response means the band came from network defaults (fewer than 3 length ratings) rather than personal taste (from `lengthBandForUser`). `surpriseMode: true` ≡ `preset: "surprise"`. `forceGolden: true` requires ≥1 of today's golden segments (`404 no_golden_route` if none fit). With ≥2 must-visits, order is optimized on graph Dijkstra costs unless `preserveMustVisitOrder: true`; response includes `mustVisitOrder` and `routeQuality` `{ lengthM, backtrack, crossing, homeConnectors, unexplored }` (debug/metrics — ranking still uses `scoreRoutes` / `pickBest`).

**Generation engine (Phase L):** the primary finder is a **shortest-path (Dijkstra) leg** engine (`src/lib/routeSearch.ts`): shortest legs `start → each must-visit → destination` (loop when `start === destination`), `excludedSegmentIds` hard-dropped from the graph, `requiredSegmentIds` stitched in as forced hops, and mid-node detours / Yen-like alternate legs to build a pool that `scoreRoutes` / `pickBest` then rank. The legacy shuffled DFS is kept only as a **last-resort fallback** when that pool is empty. Home-access connectors are ignored **for generation scoring only** (prefer ≤1 distinct connector — leave and return the same way); when actually walked they count like any other path in stats / points / usage.

**Errors:** `400 no_home_node` when start omitted and home unset; `429 rate_limited` on generate (20/min/user). `goldenHitIds` are canonical segment ids on the route that are golden today. Home-access connectors (segments incident to `home_node_id`) are walkable and ignored **only for generation scoring / point preview**; once walked they count normally in stats / points / usage (Phase L reverted the 0.41 stats exclusion).

`pointPreview` on generate/adjust/widen responses: `{ base, golden, exploration, diversity, total }` (preview only; balances use the ledger).

**Opening hours:** nodes may have `openFromMinutes` / `openUntilMinutes` (minutes from midnight, local time at check). Generate includes `closedNodeWarnings: number[]` when must-visits or required segments touch closed nodes.

**Default start:** if `startNodeId` omitted, uses the current user's `homeNodeId` (`400 no_home_node` when unset).

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/app/avoid` | — | `{ segmentIds[] }` |
| POST | `/api/app/avoid` | `{ segmentId }` | `{ segmentIds[] }` |
| DELETE | `/api/app/avoid` | `{ segmentId }` | `{ segmentIds[] }` |

Soft routing penalty only — segments are not hard-excluded. Prefer `POST /api/segments/restrict` for new clients.

## Unified segment restriction

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/segments/restrict` | `{ segmentId, scope: "personal" \| "global", reason?, days?, clear? }` | `{ ok, proposalId? }` | Personal scope upserts `user_avoid_segment` (with optional `expires_at`, `reason`). Global scope locks immediately for owner/admin; others create a pending lock proposal. |

Legacy endpoints `/api/segments/lock`, `/api/segments/condition`, and `/api/app/avoid` remain for compatibility.

## Lock proposals (global restrict approval)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/app/lock-proposals` | — | `{ proposals[] }` | Pending global-lock requests visible to segment owner/admin. |
| POST | `/api/app/lock-proposals/approve` | `{ proposalId }` | `{ ok }` | Applies segment lock. |
| POST | `/api/app/lock-proposals/dismiss` | `{ proposalId }` | `{ ok }` | |

Distinct from GPX split proposals (`/api/app/proposals`).

## Gamification

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/app/game/daily` | `{ pointBalance, streakMultiplier, goldenSegments[], dailyChallenge }` |

## Segment conditions

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/segments/condition` | `{ segmentId, reason, days? }` | `{ condition }` | `409 condition_limit_reached` when path has too many active reports. |

**Reasons:** `muddy`, `flooded`, `construction`, `dog`, `icy`, `overgrown`. Reports expire (default 7 days). Active conditions are included in bootstrap as `segmentConditions[]` and add a stronger routing penalty than the avoid list.

## Path discovery proposals

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/app/proposals` | — | `{ proposals[] }` | Pending split proposals from GPX commits. |
| POST | `/api/app/proposals/accept` | `{ proposalId, part1?, part2? }` | `{ ok, newNodeId }` | Splits segment at proposal point. |
| POST | `/api/app/proposals/dismiss` | `{ proposalId }` | `{ ok }` | |

## Crash reports (self-hosted)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/app/crash` | `{ message, stack?, appVersion? }` | `{ ok }` | Stored in `crash_report` table. Complements optional Sentry. |

## Favorites & share

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/favorites` | `{ name, nodeChain, segmentIds, lengthM, durationMin }` | `{ favorite }` | Web loads favorites via bootstrap; this endpoint saves only. |
| POST | `/api/favorites/:id/accept` | — | `{ ok: true }` | Becomes active route. |
| POST | `/api/favorites/:id/delete` | — | `{ ok: true }` | |
| POST | `/api/favorites/:id/share` | `{ enable: boolean }` | `{ shareToken \| null }` |
| GET | `/api/share/:token` | — | route preview | Public read. |
| POST | `/api/share/:token/accept` | — | `{ ok: true }` |

## GPX / recording

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/gpx/config` | — | `{ mergeRadiusM, walkSpeedKmh }` | |
| POST | `/api/gpx/commit` | `{ tracks: GpxTrack[] }` | `{ saved }` | Max 50 tracks; ≤20 000 points/track; ≤50 000 points total. `markStartAsHome` sets **current user’s** home only. Rate-limited. |
| POST | `/api/gpx/parse` | multipart `file` | `{ tracks[] }` | Max file **5 MB**; same point caps as commit. Rate-limited. Oversize → `413 file_too_large` / `400 too_many_points`. |

**Rate limits (429 + `retryAfterSeconds` / `Retry-After`):** login lockout, route generate (20/min/user), plus per-user and per-IP caps on `gpx/parse`, `gpx/commit`, `app/crash`, `route/complete`, `segments/condition`, `segments/restrict`.

**Endpoint union** (`start` / `end`): `{ nodeId }` **or** `{ part1, part2 }`.

## Network graph (map admin)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/nodes` | All nodes. |
| POST | `/api/nodes/move` | Reposition node + update segments. |
| POST | `/api/nodes/opening-hours` | `{ nodeId, openFromMinutes?, openUntilMinutes?, clear? }` → `{ ok }` | Owner/admin. Minutes from midnight (local). `clear: true` removes hours. |
| POST | `/api/nodes/rename` | |
| POST | `/api/nodes/home` | Sets **current user’s** `homeNodeId` only (`{ ok, homeNodeId }`). Does not change other users or legacy `nodes.is_home`. |
| POST | `/api/nodes/delete` | Soft delete. |
| POST | `/api/nodes/restore` | |
| POST | `/api/nodes/purge` | Admin permanent delete. |
| POST | `/api/nodes/suggest-name-parts` | Body `{ lat, lng }` → name-part hints. |
| GET | `/api/segments` | All segments + geometry. |
| POST | `/api/segments/geometry` | Replace segment shape. |
| POST | `/api/segments/split` | Split at point. |
| POST | `/api/segments/rename` | |
| POST | `/api/segments/lock` | Temporary lock. |
| POST | `/api/segments/delete` | Soft delete. |
| POST | `/api/segments/restore` | |
| POST | `/api/segments/purge` | Admin permanent delete. |
| GET | `/api/app/map/trash` | `{ deletedNodes[], deletedSegments[] }` — soft-deleted items visible to owner (admin sees all). |

## Stats (native)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/app/stats/me` | — | stats, streak, achievements, recentWalks (incl. `pointsEarned` + optional breakdown), points (`SUM(walk_log.points_earned)`), networkUsage, `nodes[]` (`id`/`name` for label resolution) |
| GET | `/api/app/stats/leaderboard/weekly` | — | `{ leaderboard[], userId }` |
| GET | `/api/app/stats/leaderboard/points` | — | `{ leaderboard[], userId }` — ledger totals |
| POST | `/api/app/stats/walks/delete` | `{ walkId }` | `{ ok: true }` — removes walk; adjusts segment usage |

**Points ledger:** balances and leaderboards are `SUM(points_earned)` stored at complete time. Weekly = sum where `accepted_at` in last 7 days. No “replay × current streak”.

## Admin

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/admin/backup` | Admin-only DB download (POST only — not CSRF-friendly GET). |
| GET | `/api/admin/track-geometry/walks` | Walks with uploaded `track_json` / `walk_track`. |
| GET | `/api/admin/track-geometry/walk/[walkId]` | Split track vs official segment geometry; outlier-filtered suggestions. |
| POST | `/api/admin/track-geometry/accept` | `{ walkId, segmentId }` — backup to `segment_geometry_history`, then `updateSegmentGeometry`. |
| POST | `/api/admin/track-geometry/discard` | `{ walkId, segmentId }` — dismiss suggestion for that walk/segment. |

**Network settings:** `golden_percent` (1–25, default 5) via admin stepper on `/settings` — live `(picked/total)` preview; does not re-roll today's goldens.

Browser-only flows (password change, TOTP) live on `/settings/account` — native app opens that page in an authenticated in-app WebView sheet. Locale/theme/network remain on `/settings`.
