# Routy

> Der selbst-hostenbare Routenplaner für Hundespaziergänge — und für jede andere Runde, die du aufzeichnen möchtest.

**Routy** baut eine geteilte Karte der Wege, die dein Haushalt kennt: zeichnen, GPX importieren oder per GPS aufzeichnen. Aus diesem gemeinsamen Wegnetz schlägt Routy täglich Routen vor — bevorzugt Strecken, die du lange nicht gelaufen bist, und saubere Runden statt unbequemer Hin- und Rückwege.

<details open>
<summary><b>So sieht Routy aus</b></summary>

| Routenplanung (Web) | Geteiltes Wegnetz (Web) |
|-|-|
| ![Routenplanung](docs/screenshots/web-route.png) | ![Wegnetz-Karte](docs/screenshots/web-map.png) |

| Login | Statistiken & Spiel-Hub | Einstellungen |
|-|-|-|
| ![Login](docs/screenshots/web-login.png) | ![Spiel-Hub](docs/screenshots/web-stats.png) | ![Einstellungen](docs/screenshots/web-settings.png) |

</details>

---

## Was Routy kann

- **Wegnetz aufbauen** — Wege per Klick zeichnen, GPX importieren oder unterwegs mit GPS aufnehmen. Kreuzungen rasten automatisch aneinander ein; Namen können Bausteine wiederverwenden (mit OSM-Vorschlägen). Wege bearbeiten, teilen, umbenennen, sperren und in den Papierkorb legen.
- **Routen planen** — Startpunkt (und optional Wegpunkte, Pflicht-/Verbotswege) wählen. Voreinstellungen **Kurz / Normal / Lang / Überraschung** schlagen eine Route in deiner Wunschlänge vor, bewertet nach Runden-Qualität, Abwechslung und einer **Punkte-Vorschau** (tägliche goldene Wege boosten die Punktzahl).
- **Losgehen** — Route als aktive Wanderung übernehmen, optional mit Spitzname, Live-Standort und Sprachansagen. Nach Abschluss gibt es Punkte (Vorschau-Bonus × Streak), golden-Hit-Celebration und geloggte Statistiken — Streaks, Errungenschaften und ein Haushalts-Ranking schließen sich an.
- **Wege einschränken** — zeitlich begrenzt meiden (selbst) oder sperren (Eigentümer/Admin; andere stellen Sperr-Vorschläge). Weiche Abzüge und Sperren fließen ins Routing ein.
- **Konten & Rechte** — erster Benutzer ist Admin (Benutzer, Vorgaben, Backups, Aktivitätslog). Wege gehören ihrem Ersteller; nur Eigentümer/Admin darf fremde Wege bearbeiten. DE/EN-UI, mehrere Themes und Routing-Parameter in den Admin-Einstellungen.

**Clients**

| | Browser (PWA) | [Android-App](https://github.com/Emil007/routy-android) |
|---|---|---|
| Route, Karte, Statistiken | Vollständige Web-UI + Spiel-Hub | Nativ (MapLibre-Karte, Offline-Cache) + Spiel-Hub |
| GPS-Aufnahme | Nur Vordergrund (Browser-Limit) | Nativer Vordergrund-Dienst |
| Admin | Web (kompaktes ⋮-Menü) | WebView-Tab (gleiche UI) |
| Kontosicherheit (Passwort, 2FA) | Einstellungen `#account` | Authentifiziertes WebView-Sheet in der App |

Kartenkacheln und Höhen-/Namensabfragen kommen aus öffentlichen OSM-bezogenen Diensten (ohne API-Schlüssel). Siehe Kompositions-Kommentare, wenn du eine Outbound-Allowlist brauchst.

---

## Loslegen (Docker)

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

Öffne die Seite (Port **3000**). Beim ersten Start holst du das **einmalige Setup-Token** aus den Logs:

```bash
docker compose logs -f
```

Damit legst du das erste Konto an (das wird Admin). Keine `.env` nötig — alles über `docker-compose.yml` steuerbar.

| | |
|---|---|
| Daten | SQLite unter `./data` (bind-mounted) |
| Aktualisieren | `docker compose pull && docker compose up -d` |
| Health | `GET /api/health` (Version, DB, Zähler, Backup-Zeit) |
| Wiederherstellen | [RESTORE_FROM_BACKUP.md](RESTORE_FROM_BACKUP.md) |

Für Produktion einen Reverse-Proxy mit HTTPS davor setzen. `COOKIE_SECURE=true` ist Standard; nur für reines HTTP im LAN auf `false` setzen.

### Backups (lohnt sich)

- **Manuell:** Admin-Seite → jederzeit DB-Snapshot herunterladen.
- **Automatisch:** tägliche Kopie in `./data/backups/`, 14 Tage Aufbewahrung. Nur lokal — für Off-Site-Schutz woanders hinkopieren.
- Gelöschte Knoten/Wege liegen **30 Tage im Papierkorb**, bevor sie endgültig gelöscht werden.

### Optionale Extras

- **HTTPS:** Caddy-Dienst in `docker-compose.yml` einkommentieren, `DOMAIN` setzen, Ports 80/443 öffnen.
- **CAPTCHA** auf Login/Setup: `CAPTCHA_PROVIDER` + Site/Secret-Keys in Compose.
- **2FA (TOTP):** pro Benutzer in den Einstellungen; Admin kann eine Sperre zurücksetzen.

Login und Setup sind standardmäßig rate-limited. Der Container läuft read-only als Root mit gedroppten Capabilities und Memory/CPU-Limits — Details in der Compose-Datei.

---

## Demo-Daten (für Ausprobieren & Entwicklung)

`scripts/seed-demo/seed.js` erzeugt eine **fiktive, wiederverwendbare Demo-Datenbank** — keine echten Standorte, sondern ein realistisches Spazier-Netz mit Londoner Straßennamen (Camden / Hampstead / Highgate), 14 Walk-Logs, Favoriten und goldenen Wegen. Perfekt zum Ausprobieren des Spiel-Hubs ohne echte GPS-Daten.

```bash
node scripts/seed-demo/seed.js
# → schreibt scripts/seed-demo/data/demo.db
DATABASE_PATH=scripts/seed-demo/data/demo.db npm run dev
```

**Login:** `demo` / `demo1234` (Benutzer "demo" ist Admin). Eine fertige DB liegt unter `scripts/seed-demo/data/demo.db` und kann direkt verwendet werden.

---

## Lokal entwickeln

Node 20+, SQLite unter `./data/routy.db`:

```bash
npm install
npm run dev
```

Stack: Next.js (App Router), React, TypeScript, Leaflet, Zod, Vitest. HTTP-API-Hinweise für den Android-Client: [docs/API.md](docs/API.md).

Geh-Sounds (*Purchase Success* / *Brass Fanfare Short* von Pixabay, bearbeitet) sind als MP3/OGG in `public/sounds/` (Android `res/raw` nutzt OGG).

---

## Versionsnummern

Server und Android haben für einen Release-Haufen den **gleichen Zahlenteil**, nur das Suffix unterscheidet sich:

| Komponente | Tag-Beispiel | Angezeigt als | Wo |
|-----------|-------------|--------------|-----|
| Server | `v0.58s` | **0.58s** | `package.json` |
| Android | `v0.58a` | **0.58a** | `app/build.gradle.kts` |

Muster ist immer `0.<nummer>s` / `0.<nummer>a` — Suffixe nie tauschen, keine `b`- oder semver-Patches wie `0.35.2`.

---

## Danksagung

Die Must-visit-Reihenfolge und die explizite Routenqualitäts-Messung wurden von Ideen aus **[Kōji](https://github.com/TurtIeSocks/Koji)** (TurtIeSocks) inspiriert — Pokemon-Mapping/Geofence-Routing. Nativ in Routys TypeScript-Graph-Stack umgesetzt; **kein Kōji-Code wurde übernommen**.
