# Routy

Routy is a self-hosted web app that suggests dog-walk routes from a shared
network of paths — built by walking (or driving) around and submitting the
paths you know, then letting Routy pick a fresh combination of them each
time, favoring the ones you haven't walked in a while. Multiple people can
share one instance, each with their own profile and stats, all drawing from
the same path network. The first account becomes the admin, who manages who
else gets access.

> **A note on how this was built.** Routy is 100% "vibecoded" — written
> end-to-end with [Claude Code](https://claude.ai/code), by someone who isn't
> a professional software developer. It's a hobby project for a shared dog
> walk, not audited production code. That said, the process has been
> genuinely surprising: describing what's needed in plain language and
> iterating on the result has gotten Routy further, faster, than expected.
> Use it, fork it, judge the code however you like — just don't assume
> enterprise-grade rigor behind it.

## What it does

**Build the network.** Draw paths directly on the map (click to place
points, with snapping to nearby known junctions you can toggle off when
needed) or upload a GPX file — both live right on the Übersicht (network
overview) page, no separate screen needed. Either way, Routy asks you to
confirm whether each path's start and end point is an existing junction or
a new one. For a new junction, it offers multiple name suggestions at once —
from OpenStreetMap data nearby *and* from name pieces already used by other
junctions close by (so "Dellacher Weg" typed once becomes a one-click,
reusable building block for every junction along it) — combined into up to
two linked parts (e.g. "Dellacher Weg / Ginhartweg"). Route summaries later
shorten themselves mechanically wherever consecutive stations share a linked
part, never by guessing from text. Every path automatically gets its reverse
direction created too, so it can be walked either way.

**Get a route.** No need to type an exact distance — set a preferred length
range once in Settings, and Routy suggests a route from within it, picking
the option that avoids doubling back on itself and favors paths you haven't
used in a while over the one closest to a specific number. Don't like it?
"Longer", "Shorter", or "Another route" get you a different one; each
suggestion is randomized, so you don't keep seeing the same one. An
"Explorer mode" toggle biases suggestions even more strongly toward path
segments nobody has walked at all yet. Found a route you want to keep
walking? Save it as a favorite and take it again anytime without a fresh
search. Accept a route and it becomes your active route — visible on
`/route` on any device you sign into — until you confirm it as walked
(which updates your stats) or discard it.

**Edit the network.** Everything happens right on the Übersicht map: click a
node or path to open a popup with its details, and — if you own it or are an
admin — actions for it. From a node's popup: rename it (same two-part
suggestion UI as creating one), move it, set it as home, or delete it. From a
path's popup: give it its own name (handy when two paths connect the same
two junctions, e.g. a straight route vs. one that loops around — the name
disambiguates them in route summaries), edit its shape, or delete it.
Editing a shape lets you drag points, click the path to insert a new point,
click an interior point to remove it again, or split the path into two at a
new junction. Switch the base map to a hiking/topo layer if street tiles
aren't detailed enough for a particular area. Anyone without edit rights
just sees the read-only info — no buttons. Editing paths mid-walk (yours or
someone else's) is blocked with an explanation instead of silently
corrupting an active route.

**Track it.** A stats page shows your personal totals and recent walks
(each removable, in case one was logged by mistake), your current and
longest walking streak, a set of tiered achievements (walk count, distance,
streak length, and how much of the network you've explored, each ranked
Stone through Diamond) plus a few one-off badges, and which paths are used
most and least across the whole network — so you know what to prioritize
walking next.

**Manage accounts.** The admin (the very first account) gets a "Users" page
to create, edit, lock, or permanently delete other accounts, and can log in
as any of them to help troubleshoot without needing their password.
Everyone else manages their own password, language, and theme, and can
deactivate their own account from Settings — only the admin can bring it
back or delete it for good. Locking or deleting keeps a departed member's
name on whatever they built, so the network's history stays intact.

## Features

- Multiple profiles, one shared path network, each with separate stats and
  an optional personal walking pace (used to estimate durations)
- Admin-managed accounts: the first account becomes admin and is the only
  one who can create, edit, lock, or permanently delete other accounts, or
  log in as one of them; everyone manages their own password and can
  deactivate their own account
- Nodes and paths are attributed to whoever created them and only editable
  by that person or the admin, visible to everyone else
- One map-centric Übersicht page for everything network-related: freehand
  drawing, GPX upload, and click-a-popup editing (rename, move, split, add or
  remove shape points, delete), each gated to owner/admin with read-only info
  for everyone else
- Linked, reusable name parts for junctions — multiple suggestions offered
  at once (OpenStreetMap data + nearby parts already in use), and route
  summaries shorten themselves mechanically wherever consecutive stations
  share a linked part
- Optional per-path names to disambiguate two paths connecting the same
  two junctions (e.g. "straight" vs. "the long way around")
- Switchable map tiles (streets or a hiking/topo layer) everywhere a map
  is shown
- Route suggestions from a configurable length range, with "Longer" /
  "Shorter" / "Another route" refinement, randomized results, and an
  opt-in Explorer mode that prioritizes never-walked paths
- Favorite routes: save a suggestion by name and take it again later without
  searching, or delete it
- Persistent, cross-device active-route tracking with an explicit
  walked/discard step, and optional live-location display on the map
  (browser geolocation, opt-in)
- Elevation (ascent/descent) shown per path — in the network table and on
  every route — read from GPX files that have it, or looked up automatically
  otherwise
- Stats: personal totals, recent walks (deletable), walking streaks, tiered
  achievements, network-wide most/least-used paths
- Sortable, compact path table and alphabetically sorted node/path pickers
  throughout
- Six themes (auto, light, dark, high-contrast, plus two playful bonus ones —
  dog and cat), picked per profile in Settings
- All the tunable numbers (merge radius, suggestion length range, tolerance,
  fairness weighting, walking speed default, …) are adjustable in Settings
- German and English, file-based (`src/lib/i18n/*.json`) and easy to extend
  with another language without touching any code
- Login is rate-limited automatically; CAPTCHA (Turnstile/hCaptcha/reCAPTCHA)
  is available as an opt-in on top, and a one-time setup token protects the
  first-account setup screen
- Optional, disabled-by-default automatic HTTPS for a public domain via a
  Caddy profile in `docker-compose.yml`

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
profile. To stop a stranger from claiming that account if the site is
reachable before you get to it, setup asks for a one-time token that's
printed to the console on first start — run `docker compose logs -f` to read
it. That first account becomes the admin, and creates further accounts from
the "Users" page.

### Security

- **Login is rate-limited automatically** — no configuration, no external
  service. After a handful of failed attempts for a username, further tries
  are throttled with a growing delay. The same throttle also covers the
  first-time setup token above.
- **CAPTCHA is optional, off by default.** If you want one on top of the
  rate-limiting (e.g. because the instance is on the public internet), set
  `CAPTCHA_PROVIDER` to `turnstile`, `hcaptcha`, or `recaptcha` plus the
  matching `CAPTCHA_SITE_KEY`/`CAPTCHA_SECRET_KEY` in `docker-compose.yml`
  (commented-out examples with signup links are already there) — no code
  changes, no rebuild.

### Optional: automatic HTTPS for a public domain

`docker-compose.yml` includes a disabled-by-default Caddy service that gets
and renews a Let's Encrypt certificate automatically. To use it:

1. Point your domain's A/AAAA record at this server's public IP.
2. Edit `Caddyfile` and replace the placeholder domain with your real one.
3. Start Compose with the extra profile: `docker compose --profile ssl up -d`

That's it — no certificates to manage by hand. Ports 80 and 443 need to be
reachable from the internet for Let's Encrypt's verification to succeed.
`COOKIE_SECURE=true` (already the default) is correct in this setup, since
Caddy is the one terminating HTTPS.

### External services

Routy calls a few free, public, keyless services over the internet:

- **Map tiles** from `tile.openstreetmap.org` (streets) and
  `opentopomap.org` (hiking/topo, switchable per map via the layer control),
  both with attribution — standard public tile servers whose usage policy is
  explicitly intended for light, small-scale use like this. A dedicated tile
  provider (e.g. MapTiler, which has a free tier) would only be worth
  setting up at significantly higher traffic.
- **Elevation lookups** from the Open-Meteo API, for paths that don't already
  have elevation data.
- **Junction name suggestions** from OpenStreetMap's Nominatim reverse
  geocoding service, when creating a new junction.

All three are best-effort: if the container has no outbound internet access,
or a service is unreachable, saving or editing a path still works fine — a
missing elevation lookup just leaves that path without elevation data, and a
missing name suggestion just leaves the name field empty for you to fill in
yourself.

None of them require an API key or send any personal data. The only other
external call Routy can make is the CAPTCHA verification described above —
and only if you've explicitly turned that on.

## Development

```bash
npm install
npm run dev
```

The SQLite file lands under `./data/routy.db` by default (changeable via
`DATABASE_PATH`).

**Versioning:** the version shown in the nav bar (and in `package.json`)
follows the pull request count — `0.N` for the Nth merged PR. It's a simple
progress counter, not semver.

## Project structure

```
src/
  app/            Next.js App Router: pages, server actions, API routes
  components/     Client components (map, route generator, import/edit wizards, …)
  lib/            Database, geo math, GPX parsing, routing algorithm, i18n
```
