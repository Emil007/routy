# Routy

Self-hosted route planner for dog walks (and any other walks you care to log). Everyone in the household adds paths they know — drawn on a map, imported from GPX, or recorded live with GPS. Routy suggests routes from that shared network, favoring ground you have not walked lately and clean loops over awkward out-and-backs.

Built as a hobby project by a sysadmin, not a product team. It works well for our household; it is not professionally audited. Read the code before you trust it with anything important.

This repository is the **server** (web UI + API + database). There is also a companion **[Android app](https://github.com/Emil007/routy-android)** — same login, same path network, but native map, GPS recording while you walk, and offline cache. Use the browser alone or pair it with the app; the app cannot run without this server.

**Server** (this repo) · **0.42s** · [`Emil007/routy`](https://github.com/Emil007/routy)
**Android app** · **0.42a** · [`Emil007/routy-android`](https://github.com/Emil007/routy-android)
*(Aligned release batch: same number, `s` / `a` suffix by repo — tags `v0.42s` / `v0.42a`.)*

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

**Plan a walk** — Pick a start (and optional waypoints / required or excluded paths). Short / Normal / Long / Surprise presets suggest a route in your length band (personal taste after 3 rated walks, else network defaults), scoring for loops, variety, and a **point preview** (daily golden paths boost the score). **Favorites:** save only after a completed walk; on the generate screen a compact **Favorites** button opens Load + Delete.

**Walk it** — Accept a route as your active walk; optional nickname, live location, and voice cues on the web. Complete the walk to earn points (preview bonuses × streak), celebrate golden hits, and log stats; streaks, achievements, and household leaderboards follow from there.

**Restrict paths** — From the map, restrict a path for yourself (timed avoid) or everyone (owner/admin lock; others create a lock proposal for approval). Soft penalties and locks feed into routing.

**Accounts** — First user is admin (users, impersonation, backups, activity log). Paths belong to their creator; only the owner or admin can edit. DE/EN UI, several themes, tunable routing parameters in Settings (admin network card at the bottom).

**Clients**

| | Browser (PWA) | [Android app](https://github.com/Emil007/routy-android) |
|---|---|---|
| Route, map, stats | Full web UI + game hub | Native (MapLibre map, offline cache) + game hub |
| GPS recording | Foreground only (browser limits) | Native foreground service |
| Admin | Web (compact ⋮ user actions) | WebView tab (same UI) |
| Account security (password, 2FA) | Settings `#account` | Authenticated in-app WebView sheet |

Map tiles and elevation/name lookups use public OSM-related services (no API keys). See compose comments if you need outbound allowlists.

### Android app

Install from [routy-android](https://github.com/Emil007/routy-android) (GitHub Actions APK or a release tag). Point it at this server's URL after `docker compose up`. No extra server config beyond HTTPS and a reachable `/api/health`.

---

## Develop locally

Node 20+, SQLite file at `./data/routy.db`:

```bash
npm install
npm run dev
```

Stack: Next.js (App Router), React, TypeScript, Leaflet, Zod, Vitest. HTTP API notes for the Android client: [docs/API.md](docs/API.md).

Walk completion sounds (*Purchase Success* / *Brass Fanfare Short* from Pixabay, edited) ship as MP3/OGG in `public/sounds/` (Android `res/raw` uses OGG).

---

## Version numbers

Server and Android share the **same numeric part** for a release batch; only the suffix differs:

| Component | Tag example | Shown as | Where |
|-----------|-------------|----------|-------|
| Server | `v0.42s` | **0.42s** | `package.json` |
| Android | `v0.42a` | **0.42a** | `app/build.gradle.kts` |

Pattern is always `0.<number>s` / `0.<number>a` — never swap suffixes, never use `b` / semver patch like `0.35.2`.
