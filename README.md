# Routy

Self-hosted route planner for dog walks (and any other walks you care to log). Everyone in the household adds paths they know — drawn on a map, imported from GPX, or recorded live with GPS. Routy suggests routes from that shared network, favoring ground you have not walked lately and clean loops over awkward out-and-backs.

Built as a hobby project by a sysadmin, not a product team. It works well for our household; it is not professionally audited. Read the code before you trust it with anything important.

**Server** (this repo) · current line **0.33s**  
**Android app** · [routy-android](https://github.com/Emil007/routy-android) · **0.31b** (separate release tags: `v0.33s` vs `v0.31b`)

---

## Get it running

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

Open the site (port **3000** by default). On first start, grab the one-time **setup token** from the logs:

```bash
docker compose logs -f
```

Use it on the login page to create the first account (that account becomes admin). No `.env` file required — tune via `docker-compose.yml` if needed.

| | |
|---|---|
| Data | SQLite under `./data` (bind-mounted) |
| Update | `docker compose pull && docker compose up -d` |
| Health | `GET /api/health` (version, DB, counts, backup time) |
| Restore | [RESTORE_FROM_BACKUP.md](RESTORE_FROM_BACKUP.md) |

Put a reverse proxy with HTTPS in front for production. `COOKIE_SECURE=true` is the default; set `false` only for plain HTTP on a LAN.

### Backups (worth doing)

- **Manual:** admin page → download a DB snapshot any time.
- **Automatic:** daily copy in `./data/backups/`, 14-day retention. Local only — copy the folder elsewhere if you want off-site protection.
- Deleted nodes and paths sit in **trash** for 30 days before purge.

### Optional extras

- **HTTPS:** uncomment the Caddy service in `docker-compose.yml`, set `DOMAIN`, open 80/443.
- **CAPTCHA** on login/setup: `CAPTCHA_PROVIDER` + site/secret keys in compose.
- **2FA (TOTP):** per user in Settings; admin can reset a lockout.

Login and setup are rate-limited out of the box. Container runs read-only root, dropped capabilities, memory/CPU limits — see compose file for details.

---

## What you can do

**Build the network** — Draw paths, import GPX, or record a track on the map. Junctions snap together; names can reuse linked parts (with OSM hints). Edit, split, rename, lock a path temporarily, or soft-delete into trash. Map layers: street / hiking / satellite, plus optional Waymarked Trails overlay.

**Plan a walk** — Pick a start (and optional waypoint). Routy suggests a route in your length band, scoring for loops, variety, and segments you have not used recently. Refine with short/long presets, explorer mode, favorites, and share links.

**Walk it** — Accept a route as your active walk; optional nickname, live location, and voice cues on the web. Complete the walk to log stats; streaks, achievements, and a household leaderboard follow from there.

**Accounts** — First user is admin (users, impersonation, backups, activity log). Paths belong to their creator; only the owner or admin can edit. DE/EN UI, several themes, tunable routing parameters in Settings.

**Clients**

| | Browser (PWA) | [Android app](https://github.com/Emil007/routy-android) |
|---|---|---|
| Route, map, stats | Full web UI | Native (MapLibre map, offline cache) |
| GPS recording | Foreground only (browser limits) | Native foreground service |
| Admin | Web | WebView tab |
| Account security (password, 2FA) | Settings page | Opens Settings in Custom Tab |

Map tiles and elevation/name lookups use public OSM-related services (no API keys). See compose comments if you need outbound allowlists.

---

## Develop locally

Node 20+, SQLite file at `./data/routy.db`:

```bash
npm install
npm run dev
```

Stack: Next.js (App Router), React, TypeScript, Leaflet, Zod, Vitest. HTTP API notes for the Android client: [docs/API.md](docs/API.md).

---

## Version numbers

Two independent lines, same `MAJOR.MINOR` idea:

| Component | Tag example | Shown as |
|-----------|-------------|----------|
| Server | `v0.33s` | **0.33s** (`package.json`) |
| Android | `v0.31b` | **0.31b** (`app/build.gradle.kts`) |

The `s` / `b` suffix tells them apart; bump each repo when that side changes.
