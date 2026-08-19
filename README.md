# Routy

Self-hosted dog-walk route planner for a household. Everyone in the house feeds paths they know into one shared network — drawn on a map, imported from GPX, or recorded live by GPS while walking. Routy then suggests a route from that network, favoring ground that hasn't been walked recently and steering toward clean loops over out-and-back stretches.

This is entirely vibecoded, and that's nothing to be proud of — but I'm a sysop, not a developer, so it was either build it this way or not at all. The idea and the execution are still mine either way. Standard hobby-project disclaimer applies: not professionally audited, so read the code before trusting it with anything that matters.

## Quickstart

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

| | |
|---|---|
| Port | `3000` |
| Data | SQLite file under `./data` (bind-mounted volume) |
| Logs | `docker compose logs -f` — JSON lines to stdout, auto-rotated by Docker (10MB × 5 files, gzipped) |
| Config | none required — no API keys, no `.env` file (env vars go in `docker-compose.yml`) |
| Update | `docker compose pull && docker compose up -d` |
| Build locally instead | comment out `image:`, uncomment `build: .` in `docker-compose.yml`, then `docker compose up -d --build` |

First launch prints a one-time **setup token** to the console (`docker compose logs -f`). Enter it to create the first account, which becomes admin.

Assumes a reverse proxy terminating HTTPS in front. `COOKIE_SECURE=true` is the default; set to `false` for plain HTTP.

### Security

- Login and the setup token are rate-limited automatically — both per-username and per-IP, no config needed.
- Optional two-factor authentication (TOTP) — enable per-account from Settings; an admin can reset a locked-out user's 2FA from the admin page.
- Optional CAPTCHA (Turnstile / hCaptcha / reCAPTCHA): set `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY` in `docker-compose.yml`.
- Sign out of every other device at once from Settings, or revoke a single device (e.g. a lost phone) individually.
- Security headers and a nonce-based Content-Security-Policy on every response.
- Container hardening: read-only root filesystem, all Linux capabilities dropped except the four the startup step needs, `no-new-privileges`, and a memory/CPU ceiling — all in `docker-compose.yml`.
- `/api/health` for uptime checks (also wired into the container's own healthcheck) — returns version, DB status, node/segment counts, and last backup timestamp.
- Activity log entries older than 180 days are purged automatically; expired auth sessions are swept daily.
- See [RESTORE_FROM_BACKUP.md](RESTORE_FROM_BACKUP.md) for a tested restore runbook.

### Backups

- On-demand: an admin can download a full database snapshot any time from the admin page. Taking it doesn't interrupt normal use.
- Automatic: a dated copy is also written daily to `./data/backups/` on the host, with copies older than 14 days pruned automatically. On by default, no config needed — it's local disk, not off-site, so it's cheap to leave running. Copy that folder elsewhere yourself for real off-site protection.
- Deleted nodes/paths land in a recoverable trash (auto-purged after 30 days), and every structural change is recorded in an admin-only activity log.

### Optional: automatic HTTPS

Built-in Caddy service, Let's Encrypt, disabled by default:

1. Point your domain's A/AAAA record at the server.
2. In `docker-compose.yml`, uncomment the `caddy:` service and the `volumes:` section at the bottom, and set `DOMAIN` to your real domain.
3. `docker compose up -d`

Needs ports 80/443 reachable from the internet. No separate file to edit — `Caddyfile` just reads `DOMAIN` from the environment.

### External services

Free, keyless, best-effort — the app degrades gracefully if any are unreachable.

| Service | Used for |
|---|---|
| `tile.openstreetmap.org` | street map tiles |
| `opentopomap.org` | hiking/topo tiles |
| ArcGIS World Imagery | satellite tiles |
| `waymarkedtrails.org` | marked-hiking-trail overlay |
| Open-Meteo | elevation lookup when missing from GPX |
| OSM Nominatim | junction name suggestions |
| GitHub Releases API | admin-only check for a newer version |

No API keys, no personal data sent. The only other outbound call is CAPTCHA verification, if enabled.

## Features

**Network**
- Draw on the map, import GPX, or record live by GPS while walking; junction detection with a configurable snap radius
- Junction names built from linked, reusable parts (OSM suggestions + nearby parts already in use); route text shortens itself where parts repeat
- Optional per-path names to disambiguate parallel paths between the same two junctions
- Click-to-edit via map popups — rename, move, reshape, split, delete, or lock a path out of route rotation for N days (construction, overgrown, whatever) — owner/admin-gated, read-only for everyone else
- Deleted items go to a recoverable trash, not straight to gone
- Switchable base layers (street / hiking / satellite) plus a hiking-trail overlay

**Routing**
- Suggests routes within a configurable length range, scored to favor real loops over backtracking or self-crossing paths, and under-walked ground over well-trodden
- Short/long presets, longer/shorter/another-route refinement, explorer mode (bias toward never-walked paths)
- Favorites — save, re-take without re-searching, optionally share a read-only link
- Cross-device active-route tracking, optional nickname per walk, optional live location and voice cues announcing the next station and its direction

**Accounts**
- First account is admin: creates/edits/locks/deletes other accounts, can impersonate for support
- Nodes/paths attributed to creator, editable by creator or admin only
- Self-service password, language, theme, sign-out-everywhere; self-deactivation (admin-reversible), permanent delete (admin-only)

**Mobile**
- Installable as a PWA; map tiles you've already viewed stay visible offline
- No reliable background GPS in browsers, so live recording needs the screen on and the app in the foreground
- **Android app** (separate repo): Route, Map, Stats, Settings, and GPS recording are native; only the Admin tab loads this server in a WebView. Browser users still get the full web UI at `/map`, `/settings`, etc.

**Other**
- Stats: totals, recent walks, streaks, weekly household leaderboard, tiered achievements, network-wide usage
- 6 themes (light/dark/auto/high-contrast + 2 playful ones), per profile
- DE/EN, JSON-file-based i18n, easy to extend
- Routing/matching parameters (merge radius, tolerance, fairness weighting, …) tunable in Settings

## Version numbers

Routy uses two independent release lines — same `MAJOR.MINOR` style, different suffix:

| Component | Repo | Form | Example |
|-----------|------|------|---------|
| **Server** | this repo | `MAJOR.MINORs` (git tag `v0.21s`, package.json `0.21.0`) | **0.21s** |
| **Android app** | [routy-android](https://github.com/Emil007/routy-android) | `MAJOR.MINORa` (git tag `v0.13a`) | **0.13a** |

Server patch in `package.json` stays `0`; the `s`/`a` suffix identifies which product shipped.

## Tech stack & development

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Database | SQLite via `better-sqlite3` |
| Maps | Leaflet / react-leaflet |
| Validation | Zod |
| GPX parsing | `fast-xml-parser` |
| Tests | Vitest, gating Docker publish via GitHub Actions |

```bash
npm install
npm run dev
```

DB path: `./data/routy.db` (override via `DATABASE_PATH`).

```
src/
  app/          Next.js App Router — pages, server actions, API routes
  components/   Client components (map, route generator, wizards)
  lib/          DB, geo math, GPX parsing, routing, i18n
public/
  sw.js         Service worker — offline tile caching
```
