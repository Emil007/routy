# Routy

Self-hosted dog-walk route planner. A household submits paths it knows (draw on a map or import GPX) into a shared network; Routy suggests routes from that network, weighted toward paths not walked recently.

> Built end-to-end with [Claude Code](https://claude.ai/code) by a non-professional developer, as a hobby project. Not audited for production use — review the code before relying on it.

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
| Config | none required — no API keys, no `.env` file (env vars go in `docker-compose.yml`) |
| Update | `docker compose pull && docker compose up -d` |
| Build locally instead | comment out `image:`, uncomment `build: .` in `docker-compose.yml`, then `docker compose up -d --build` |

First launch prints a one-time **setup token** to the console (`docker compose logs -f`). Enter it to create the first account, which becomes admin.

Assumes a reverse proxy terminating HTTPS in front. `COOKIE_SECURE=true` is the default; set to `false` for plain HTTP.

### Security

- Login and the setup token are rate-limited automatically, no config needed.
- Optional CAPTCHA (Turnstile / hCaptcha / reCAPTCHA): set `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY` in `docker-compose.yml`.

### Backups

- On-demand: an admin can download a full database snapshot any time from the admin page. Taking it doesn't interrupt normal use.
- Automatic: a dated copy is also written daily to `./data/backups/` on the host, with copies older than 14 days pruned automatically. On by default, no config needed — it's local disk, not off-site, so it's cheap to leave running. Copy that folder elsewhere yourself for real off-site protection.

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

No API keys, no personal data sent. The only other outbound call is CAPTCHA verification, if enabled.

## Features

**Network**
- Draw paths on the map or import GPX; junction detection with a configurable snap radius
- Junction names built from linked, reusable parts (OSM suggestions + parts already used nearby); route text shortens itself where parts repeat
- Optional per-path names to disambiguate parallel paths between the same two junctions
- Click-to-edit via map popups — rename, move, reshape (add/remove points), split, delete — gated to owner/admin, read-only for everyone else
- Switchable base layers (street / hiking / satellite) plus a hiking-trail overlay
- Edits blocked on paths currently in use by an active route

**Routing**
- Suggests routes within a configurable length range, avoiding backtracking, favoring under-used paths
- Longer / shorter / another-route refinement, randomized results
- Explorer mode: bias toward never-walked paths
- Favorites: save and re-take a route without re-searching
- Cross-device active-route tracking, explicit walked/discard step, optional live location

**Accounts**
- First account is admin: creates/edits/locks/deletes other accounts, can impersonate for support
- Nodes/paths attributed to creator, editable by creator or admin only
- Self-service password, language, theme; self-deactivation (admin-reversible), permanent delete (admin-only)

**Other**
- Stats: totals, recent walks, streaks, tiered achievements, network-wide usage
- 6 themes (light/dark/auto/high-contrast + 2 playful ones), per profile
- DE/EN, JSON-file-based i18n, easy to extend
- Routing/matching parameters (merge radius, tolerance, fairness weighting, …) tunable in Settings

## Tech stack & development

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Database | SQLite via `better-sqlite3` |
| Maps | Leaflet / react-leaflet |
| Validation | Zod |
| GPX parsing | `fast-xml-parser` |

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
```

**Versioning:** `0.N` = Nth merged PR. Not semver.
