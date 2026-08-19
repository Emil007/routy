# Routy HTTP API

Shared contract between the **web app**, **native Android app**, and any future clients.

- **Base URL:** user-configured (e.g. `https://routy.example.com/`)
- **Auth:** `Authorization: Bearer <token>` (Android) or session cookie (browser). Same token from `POST /api/auth/login`.
- **Errors:** JSON `{ "error": "<code>" }` unless noted. Common: `unauthorized`, `invalid_json`.
- **Version:** server display `0.26s` (`package.json` `"0.26s"`).

## Auth & profile

| Method | Path | Body / params | Response | Notes |
|--------|------|---------------|----------|-------|
| POST | `/api/auth/login` | `{ username, password, deviceName?, totpCode? }` | `{ token, user }` | Sets cookie for web; Android stores `token`. |
| POST | `/api/auth/logout` | — | 204 | |
| GET | `/api/auth/me` | — | `{ user }` | |
| GET | `/api/auth/sessions` | — | `{ sessions[] }` | |
| DELETE | `/api/auth/sessions/:sessionId` | — | 204 | Revoke one session. |
| POST | `/api/auth/sessions/revoke-others` | — | `{ revoked }` | |
| PATCH | `/api/app/profile` | `{ locale?, theme?, walkSpeedKmh? \| null }` | `{ user }` | Send `"walkSpeedKmh": null` to clear override. |

## Bootstrap & health

| Method | Path | Response | Notes |
|--------|------|----------|-------|
| GET | `/api/app/bootstrap` | nodes, segments, user, settings, … | `If-None-Match` / `ETag` supported. |
| GET | `/api/health` | `{ ok: true }` | Onboarding connectivity check. |

## Route wizard

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/route/generate` | `{ startNodeId, destinationNodeId, waypointNodeId?, explorerMode?, preset? }` | `{ token, route }` |
| POST | `/api/route/widen` | `{ token }` | `{ token, route }` |
| POST | `/api/route/adjust` | `{ token, direction }` | `{ token, route }` |
| POST | `/api/route/accept` | `{ token }` | 204 | Active route stored server-side. |
| POST | `/api/route/cancel` | `{ token }` | 204 | |
| POST | `/api/route/complete` | — | `{ … }` | Logs walk, clears active route. |
| POST | `/api/route/discard` | — | 204 | |
| GET | `/api/route/state` | — | active route or empty | |
| POST | `/api/route/nickname` | `{ nickname }` | 204 | Active route label. |

## Favorites & share

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/favorites` | — | `{ favorites[] }` |
| POST | `/api/favorites` | `{ name, nodeChain, segmentIds, lengthM, durationMin }` | `{ id }` |
| POST | `/api/favorites/:id/accept` | — | 204 | Becomes active route. |
| POST | `/api/favorites/:id/delete` | — | 204 | |
| POST | `/api/favorites/:id/share` | `{ enable: boolean }` | `{ shareToken \| null }` |
| GET | `/api/share/:token` | — | route preview | Public read. |
| POST | `/api/share/:token/accept` | — | 204 | |

## GPX / recording

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/gpx/config` | — | `{ mergeRadiusM, walkSpeedKmh }` | |
| POST | `/api/gpx/commit` | `{ tracks: GpxTrack[] }` | 204 | Each track: points, lengthM, durationMin, start/end endpoints, markStartAsHome?, source. |
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
| GET | `/api/nodes/suggest-name-parts` | Reverse geocode hint for junction names. |
| GET | `/api/segments` | All segments + geometry. |
| POST | `/api/segments/geometry` | Replace segment shape. |
| POST | `/api/segments/split` | Split at point. |
| POST | `/api/segments/rename` | |
| POST | `/api/segments/lock` | Temporary lock. |
| POST | `/api/segments/delete` | Soft delete. |
| POST | `/api/segments/restore` | |
| POST | `/api/segments/purge` | Admin permanent delete. |

## Stats (native)

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/app/stats/me` | stats, streak, achievements, recentWalks, points |
| GET | `/api/app/stats/leaderboard/weekly` | `{ leaderboard[] }` |
| GET | `/api/app/stats/leaderboard/points` | `{ leaderboard[] }` |

## Admin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/backup` | Admin-only DB download. |

Browser-only flows (password change, TOTP, global settings) remain on `/settings` server actions — not REST in v1.
