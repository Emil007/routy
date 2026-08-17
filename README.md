# Routy

A standalone web platform that suggests dog-walk routes from a shared network
of submitted path segments (uploaded as GPX files or drawn on the map),
favoring your preferred length and paths you haven't walked in a while.
Successor to the original Discord bot (see [`legacy/`](./legacy)) — this time
as a self-hosted web portal with login.

## Features (current state)

- **Login with multiple profiles** — separate accounts, shared path network.
  New profiles are created from Settings by any signed-in user.
- **Two ways to submit a path**: upload a GPX file, or draw it directly on
  the map by clicking points (with optional snapping to nearby known nodes,
  toggleable, and points can be dragged to place them more precisely before
  saving). Either way, Routy detects whether the start/end point is near an
  already-known node (configurable radius) and lets you confirm that, or
  name a new node — every path automatically gets its reverse-direction
  counterpart created too.
- **Route suggestions** — no need to type an exact distance: Routy suggests
  a route from a preferred length band (configurable in Settings), then
  "Longer" / "Shorter" refine it in that direction, or "Another route" tries
  a different one at roughly the same length. Preview on the map and confirm
  with "Take this one" / "Cancel".
  - Routes are scored to avoid re-walking the same physical path in both
    directions (no pointless out-and-back detours) ahead of preferring
    rarely used paths, additionally penalizing segments already walked
    today, and avoiding overlap with alternatives already shown earlier in
    the session.
  - The route summary only names actual decision points (real forks),
    skipping plain pass-through waypoints.
- **Network editing** — the network overview map is interactive: click a
  path to open its editor (drag points to correct its shape, or click along
  it to split it into two at a new junction — e.g. when a crossing path
  appears later), click a node to rename it, move it (drags the connected
  paths' endpoints along with it), or delete it. Paths and nodes can also be
  deleted/edited from the lists below the map.
- **Stats** — personal totals (distance, walk count, time, paths explored)
  and network-wide most/least-used paths.
- **Settings** — merge radius, route-suggestion length band and step size,
  tolerances, diversity weighting, etc., changeable directly in the UI.
- **Multi-language** — German/English, file-based (`src/lib/i18n/*.json`)
  and extensible with more languages without any code changes.
- **Elevation profile** — ascent/descent are shown per path and per
  generated route. If a GPX file has no recorded elevation, or a path was
  drawn on the map, elevation is looked up automatically (best-effort, via
  the free Open-Meteo API — never blocks saving if unreachable).

Planned for later stages: achievements per profile.

## Running it (Docker, recommended)

A prebuilt image is published to `ghcr.io/emil007/routy` on every push to
`main`, so no local build step is required:

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

This runs with sensible defaults out of the box — there are no credentials or
API keys to configure. To use a different data directory, edit the volume
path in `docker-compose.yml` directly (see the comment above the `volumes:`
line).

To update, run `docker compose pull && docker compose up -d` again.

> The image can also be built locally instead: in `docker-compose.yml`,
> comment out the `image:` line and uncomment `build: .`, then run
> `docker compose up -d --build`.

The container listens on port `3000`. A reverse proxy with HTTPS in front of
it is assumed (`COOKIE_SECURE=true` is the default — set it to `false` if you
access Routy over plain, unencrypted HTTP instead).

All data (the SQLite database) lives in the mounted volume (`./data` by
default, or wherever you pointed it). Back up that folder to back up Routy.

**External services:** Routy loads map tiles directly from
`tile.openstreetmap.org` (with attribution) — no API key needed. That's the
free, public OSM tile server; its usage policy is explicitly intended for
light, small-scale use like this. A dedicated tile provider (e.g. MapTiler,
which has a free tier) would only be worth setting up at significantly
higher traffic. Elevation lookups (for paths without recorded elevation) use
the free Open-Meteo API, also without a key; if the container has no
outbound internet access, or that service is unreachable, saving a path
still works fine — it's simply saved without elevation data.

The very first time you open the site, Routy asks you to set up the first
profile — no setup via environment variable needed. Any signed-in user can
create further profiles from the Settings page.

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
