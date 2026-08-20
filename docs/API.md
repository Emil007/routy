# Routy HTTP API

Shared contract between the **web app**, **native Android app**, and any future clients.

- **Base URL:** user-configured (e.g. `https://routy.example.com/`)
- **Auth:** `Authorization: Bearer <token>` (Android) or session cookie (browser). Same token from `POST /api/auth/login`.
- **Errors:** JSON `{ "error": "<code>" }` unless noted. Common: `unauthorized`, `invalid_json`.
- **Version:** server display `0.36s` (`package.json` `"0.36s"`).

## Auth & profile

| Method | Path | Body / params | Response | Notes |
|--------|------|---------------|----------|-------|
| POST | `/api/auth/login` | `{ username, password, deviceName?, totpCode?, captchaToken? }` | `{ token, user }` | Sets cookie for web; Android stores `token`. |
| POST | `/api/auth/setup` | `{ setupToken, username, password, displayName?, locale?, deviceName?, captchaToken? }` | `{ token, user }` | First-user registration (native onboarding). `409 already_setup` if users exist. |
| POST | `/api/auth/logout` | — | `{ ok: true }` | |
| GET | `/api/auth/me` | — | `{ user }` | |
| GET | `/api/auth/sessions` | — | `{ sessions[] }` | |
| DELETE | `/api/auth/sessions/:sessionId` | — | `{ ok: true }` | Revoke one session. |
| POST | `/api/auth/sessions/revoke-others` | — | `{ revoked }` | |
| PATCH | `/api/app/profile` | `{ locale?, theme?, walkSpeedKmh? \| null }` | `{ user }` | Send `"walkSpeedKmh": null` to clear override. |

**Account security (password change, TOTP enable/disable, account deactivation):** dedicated page at `/settings/account` — native Android opens that page in an authenticated in-app WebView sheet (`{serverUrl}/settings/account`). Browser `/settings` links to it.

## Bootstrap & health

| Method | Path | Response | Notes |
|--------|------|----------|-------|
| GET | `/api/app/bootstrap` | nodes, segments, user, routeState, avoidSegmentIds, segmentConditions, lockProposals, todayGoldenSegmentIds, game, … | `If-None-Match` / `ETag` supported. |
| GET | `/api/health` | `{ status, version, versionDisplay, dbReachable, nodeCount, segmentCount, lastBackupAt, needsSetup, captcha }` | Onboarding connectivity check. `needsSetup: true` when no users exist. `captcha` describes the configured widget (`provider`, `siteKey`, …) or `{ provider: "none" }`. |

## Route wizard

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/route/generate` | `{ startNodeId, destinationNodeId, waypointNodeId?, explorerMode?, surpriseMode?, preset?, forceGolden? }` | `{ token, route, pointPreview? }` |
| POST | `/api/route/widen` | `{ token }` | `{ token, route }` |
| POST | `/api/route/adjust` | `{ token, direction }` | `{ token, route }` |
| POST | `/api/route/accept` | `{ token }` | `{ success: true }` | Active route stored server-side. |
| POST | `/api/route/cancel` | `{ token }` | `{ success: true }` | |
| POST | `/api/route/complete` | — | `{ pointsEarned, streakMultiplier, currentStreak, pointBreakdown, goldenHits?, celebrationTier?, … }` | `pointsEarned = round(pointBreakdown.total × streakMultiplier)` using pre-walk usage (matches generate preview). Logs walk, clears active route. |
| POST | `/api/route/discard` | — | `{ ok: true }` | |
| GET | `/api/route/state` | — | active route or empty | |
| POST | `/api/route/nickname` | `{ nickname }` | `{ ok: true }` | Active route label. |

**Presets:** `preset` may be `"short"`, `"long"`, or `"surprise"` (bias toward segments not walked in 30+ days). `surpriseMode: true` is equivalent to `preset: "surprise"`.

## Per-user avoid list

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

`pointPreview` on generate responses: `{ base, golden, exploration, diversity, total }`.

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
| POST | `/api/gpx/commit` | `{ tracks: GpxTrack[] }` | `{ saved }` | May create path split proposals when track points pass near existing segments. |
| POST | `/api/gpx/parse` | GPX XML text | `{ tracks[] }` | Web import wizard. |

**Endpoint union** (`start` / `end`): `{ nodeId }` **or** `{ part1, part2 }`.

## Network graph (map admin)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/nodes` | All nodes. |
| POST | `/api/nodes/move` | Reposition node + update segments. |
| POST | `/api/nodes/rename` | |
| POST | `/api/nodes/home` | Set home node. |
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
| GET | `/api/app/stats/me` | — | stats, streak, achievements, recentWalks, points, networkUsage |
| GET | `/api/app/stats/leaderboard/weekly` | — | `{ leaderboard[], userId }` |
| GET | `/api/app/stats/leaderboard/points` | — | `{ leaderboard[], userId }` |
| POST | `/api/app/stats/walks/delete` | `{ walkId }` | `{ ok: true }` — removes walk; adjusts segment usage |

## Admin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/backup` | Admin-only DB download. |

Browser-only flows (password change, TOTP) live on `/settings/account` — native app opens that page in an authenticated in-app WebView sheet. Locale/theme/network remain on `/settings`.
