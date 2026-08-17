# Routy

Routy is a self-hosted web app that suggests dog-walk routes from a shared
network of paths — built by walking (or driving) around and submitting the
paths you know, then letting Routy pick a fresh combination of them each
time, favoring the ones you haven't walked in a while. Multiple people can
share one instance, each with their own profile and stats, all drawing from
the same path network.

## What it does

**Build the network.** Submit paths either by uploading a GPX file or by
drawing them directly on the map (click to place points, with snapping to
nearby known junctions you can toggle off when needed). Either way, Routy
asks you to confirm whether each path's start and end point is an existing
junction or a new one — every path automatically gets its reverse direction
created too, so it can be walked either way.

**Get a route.** No need to type an exact distance — set a preferred length
range once in Settings, and Routy suggests a route from within it, picking
the option that avoids doubling back on itself and favors paths you haven't
used in a while over the one closest to a specific number. Don't like it?
"Longer", "Shorter", or "Another route" get you a different one; each
suggestion is randomized, so you don't keep seeing the same one. Accept a
route and it becomes your active route — visible on `/route` on any device
you sign into — until you confirm it as walked (which updates your stats) or
discard it.

**Edit the network.** Click a path on the map to correct its shape or split
it into two at a new junction (e.g. once a crossing path appears). Click a
node to rename it, drag it to reposition it, or delete it. Editing paths
mid-walk (yours or someone else's) is blocked with an explanation instead of
silently corrupting an active route.

**Track it.** A stats page shows your personal totals and recent walks
(each removable, in case one was logged by mistake), plus which paths are
used most and least across the whole network — so you know what to
prioritize walking next.

## Features

- Multiple profiles, one shared path network, each with separate stats and
  an optional personal walking pace (used to estimate durations)
- GPX upload and freehand map drawing, both with junction detection/snapping
- Route suggestions from a configurable length range, with "Longer" /
  "Shorter" / "Another route" refinement and randomized results
- Persistent, cross-device active-route tracking with an explicit
  walked/discard step, and optional live-location display on the map
  (browser geolocation, opt-in)
- Interactive network map: click-to-edit paths (reshape, split), click-to-edit
  nodes (rename, move, delete), all with active-route-aware protection
- Elevation (ascent/descent) shown per path and per route — read from GPX
  files that have it, or looked up automatically otherwise, with a
  Settings action to backfill it for paths that predate this feature
- Route summaries name only the real decision points along the way, not
  every waypoint passed through
- Stats: personal totals, recent walks (deletable), network-wide
  most/least-used paths
- All the tunable numbers (merge radius, suggestion length range, tolerance,
  fairness weighting, walking speed default, …) are adjustable in Settings
- German and English, file-based (`src/lib/i18n/*.json`) and easy to extend
  with another language without touching any code

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

The very first time you open the site, Routy asks you to set up the first
profile — no setup via environment variable needed. Any signed-in user can
create further profiles from the Settings page.

### External services

Routy calls two free, public, keyless services over the internet:

- **Map tiles** from `tile.openstreetmap.org` (with attribution) — that's
  the standard public OSM tile server, whose usage policy is explicitly
  intended for light, small-scale use like this. A dedicated tile provider
  (e.g. MapTiler, which has a free tier) would only be worth setting up at
  significantly higher traffic.
- **Elevation lookups** from the Open-Meteo API, for paths that don't already
  have elevation data. This is best-effort: if the container has no outbound
  internet access, or the service is unreachable, saving or editing a path
  still works fine — it's just saved without elevation data.

Neither requires an API key or sends any personal data.

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
  components/     Client components (map, route generator, import/edit wizards, …)
  lib/            Database, geo math, GPX parsing, routing algorithm, i18n
```
