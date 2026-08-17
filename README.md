# Routy

A standalone web platform that generates dog-walk routes from submitted path
segments (GPX files), matching a target length or duration. Successor to the
original Discord bot (see [`legacy/`](./legacy)) — this time as a self-hosted
web portal with login.

## Features (current state)

- **Login with multiple profiles** — separate accounts, shared path network.
- **GPX import with node confirmation** — on upload, Routy detects whether a
  track's start or end point is near an already-known node (configurable
  radius) and lets you confirm that per track, or name a new node. Every
  segment automatically gets its reverse-direction counterpart created too.
- **Route generator** — enter a target distance or duration, freely choose
  start/destination (a loop or an A→B route, optionally with a third
  waypoint), preview the route on the map, and confirm with "New route" /
  "Take this one" / "Cancel".
  - No immediate doubling back on the same path — except at a genuine dead
    end (e.g. a spur trail to a lookout point), where that's explicitly
    allowed.
  - Each direction of a path is used at most once per route.
  - Fair selection: prefers rarely used paths, additionally penalizes
    segments already walked today, and avoids overlap with alternatives
    already shown earlier in the session.
- **Network overview** — all nodes and path segments on a map, including
  renaming and setting the home point.
- **Settings** — merge radius, tolerances, diversity weighting, etc.,
  changeable directly in the UI.
- **Multi-language** — German/English, file-based (`src/lib/i18n/*.json`)
  and extensible with more languages without any code changes.
- **Elevation profile** — if the GPX file contains elevation data, ascent/
  descent are shown per segment and per generated route.

Planned for later stages: freehand drawing of paths directly on the map
(with snapping to existing segments), a stats dashboard, and achievements
per profile.

## Running it (Docker, recommended)

Every push to `main` automatically builds the image (via GitHub Actions) and
publishes it to `ghcr.io/emil007/routy` — your NAS doesn't need to compile
anything itself:

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

This already runs with sensible defaults — there are no credentials or API
keys to configure. If you'd rather keep the data folder somewhere else (e.g.
alongside your other containers' appdata), just edit the volume path in
`docker-compose.yml` directly — see the comment above the `volumes:` line.

To update later, `docker compose pull && docker compose up -d` is enough.

> The image can also be built locally instead: in `docker-compose.yml`,
> comment out the `image:` line and uncomment `build: .`, then run
> `docker compose up -d --build`.

The container listens on port `3000`. A reverse proxy with HTTPS in front of
it is assumed (`COOKIE_SECURE=true` is the default — set it to `false` if you
access Routy over plain, unencrypted HTTP instead).

All data (the SQLite database) lives in the mounted volume (`./data` by
default, or wherever you pointed it). Back up that folder to back up Routy.

**Map data:** Routy loads map tiles directly from `tile.openstreetmap.org`
(with attribution) — no API key needed. That's the free, public OSM tile
server; its usage policy is explicitly intended for small, personal projects
like this one (one household, a handful of map loads a day). Only at
significantly higher traffic would a dedicated tile provider (e.g. MapTiler,
which has a free tier) be worth setting up.

The very first time you open the site, Routy asks you to set up the first
profile — no setup via environment variable needed. Any signed-in user can
create further profiles via "New profile" in the menu.

## Development

```bash
npm install
npm run dev
```

The SQLite file lands under `./data/routy.db` by default (changeable via
`DATABASE_PATH`).

## Project structure

```
src/
  app/            Next.js App Router: pages, server actions, API routes
  components/     Client components (map, route generator, import wizard, …)
  lib/            Database, geo math, GPX parsing, routing algorithm, i18n
legacy/           The original Discord bot prototype (reference, not active)
```
