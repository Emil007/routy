# Routy

Eine eigenständige Web-Plattform, die aus eingereichten Wegabschnitten (GPX-Dateien)
Hundespaziergang-Routen generiert, passend zur gewünschten Länge oder Dauer. Nachfolger
des ursprünglichen Discord-Bots (siehe [`legacy/`](./legacy)), diesmal als selbst
gehostetes Web-Portal mit Login.

## Features (aktueller Stand)

- **Login mit mehreren Profilen** — getrennte Konten, gemeinsames Wegenetz.
- **GPX-Import mit Knotenpunkt-Bestätigung** — beim Hochladen erkennt Routy, ob Start-
  oder Endpunkt eines Tracks in der Nähe eines bereits bekannten Knotens liegt
  (konfigurierbarer Radius), und lässt dich das pro Track bestätigen oder einen neuen
  Knoten benennen. Für jedes Segment wird automatisch die Gegenrichtung angelegt.
- **Routen-Generator** — Ziel-Distanz oder -Dauer eingeben, Start/Ziel frei wählen
  (Rundweg oder Strecke A→B, optional mit einem dritten Wegpunkt), Route auf der Karte
  ansehen und mit „Neue Route“ / „Diese nehmen“ / „Abbrechen“ bestätigen.
  - Kein sofortiges Umdrehen auf demselben Weg — außer an einer echten Sackgasse
    (z. B. Stichweg zu einem Aussichtspunkt), dort ist es ausdrücklich erlaubt.
  - Jede Wegrichtung höchstens einmal pro Route.
  - Faire Auswahl: bevorzugt selten genutzte Wege, bestraft heute schon gegangene
    Segmente zusätzlich und vermeidet Überlappung mit zuvor in der Sitzung gezeigten
    Alternativen.
- **Netzwerk-Übersicht** — alle Knoten und Wegabschnitte auf einer Karte, inkl.
  Umbenennen und Zuhause-Punkt festlegen.
- **Einstellungen** — Zusammenführungs-Radius, Toleranzen, Diversitäts-Gewichtung usw.
  direkt in der Oberfläche änderbar.
- **Mehrsprachig** — Deutsch/Englisch, dateibasiert (`src/lib/i18n/*.json`) und ohne
  Code-Änderung um weitere Sprachen erweiterbar.
- **Höhenprofil** — wenn die GPX-Datei Höhendaten enthält, werden Anstieg/Abstieg pro
  Segment und pro generierter Route angezeigt.

Geplant für spätere Ausbaustufen: freies Zeichnen von Wegen direkt auf der Karte
(mit Snapping an bestehende Segmente), Statistik-Dashboard und Achievements pro Profil.

## Betrieb (Docker, empfohlen)

Jeder Push auf `main` baut das Image automatisch (per GitHub Actions) und
veröffentlicht es unter `ghcr.io/emil007/routy` — dein NAS muss also nichts
selbst kompilieren:

```bash
git clone https://github.com/Emil007/routy.git
cd routy
docker compose pull
docker compose up -d
```

Das läuft bereits ohne `.env` mit sinnvollen Standardwerten — es gibt keine
Zugangsdaten oder API-Keys zu konfigurieren. Falls du den Datenordner an
deiner gewohnten Stelle für App-Daten liegen haben willst (statt im
`data`-Unterordner dieses Checkouts), leg eine `.env` an:

```bash
cp .env.example .env
# DATA_DIR darin z. B. auf /volume1/docker/routy setzen
```

Für ein Update später reicht `docker compose pull && docker compose up -d`.

> Falls das Paket beim ersten Mal noch als privat markiert ist, meldet
> `docker compose pull` einen Zugriffsfehler — dann einmalig unter
> github.com/Emil007/routy → Packages → routy → Package settings die
> Sichtbarkeit auf „Public" stellen (unkritisch, das Image enthält nur den
> App-Code, keine Nutzerdaten).
>
> Alternativ lässt sich das Image auch lokal bauen: in `docker-compose.yml`
> die `image:`-Zeile aus- und die `build: .`-Zeile einkommentieren, dann
> `docker compose up -d --build`.

Der Container hört auf Port `3000`. Ein Reverse Proxy mit HTTPS davor wird
vorausgesetzt (`COOKIE_SECURE=true` ist der Standard — auf `false` setzen, falls du
nur unverschlüsselt im Heimnetz zugreifst).

Alle Daten (SQLite-Datenbank) liegen im gemounteten Volume (`DATA_DIR`, Standard
`./data`). Backup = diesen Ordner sichern.

**Kartendaten:** Routy lädt Kartenkacheln direkt von `tile.openstreetmap.org`
(mit Attribution) — kein API-Key nötig. Das ist der öffentliche, kostenlose
OSM-Tileserver; seine Nutzungsrichtlinie ist für kleine, private Projekte wie
dieses (ein Haushalt, ein paar Kartenaufrufe pro Tag) ausdrücklich gedacht.
Erst bei deutlich höherem Traffic würde sich ein eigener Tile-Anbieter
(z. B. MapTiler, mit kostenlosem Kontingent) lohnen.

Beim allerersten Öffnen der Seite fragt Routy nach den Daten für das erste Profil —
kein Setup per Umgebungsvariable nötig. Weitere Profile legt jede:r angemeldete
Nutzer:in über „Neues Profil“ im Menü an.

## Entwicklung

```bash
npm install
npm run dev
```

Die SQLite-Datei landet standardmäßig unter `./data/routy.db` (per `DATABASE_PATH`
änderbar).

## Projektstruktur

```
src/
  app/            Next.js App Router: Seiten, Server Actions, API-Routen
  components/     Client-Komponenten (Karte, Routen-Generator, Import-Assistent, …)
  lib/            Datenbank, Geo-Mathematik, GPX-Parsing, Routing-Algorithmus, i18n
legacy/           Der ursprüngliche Discord-Bot-Prototyp (Referenz, nicht aktiv)
```
