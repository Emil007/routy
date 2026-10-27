# Routy Layout-Umbau: Vollbild-Karte, UI als Einblendung

**Status:** Verbindlicher Plan (Entscheidungen festgelegt durch Emil am 2026-10-27). Noch **keine Implementierung** — Umsetzung startet erst nach Freigabe, phasenweise reviewbar.
**Basis:** Synthese zweier Cursor-Pläne (Grok 4.7 Extra High = Architektur-Hauptquelle, Composer 2.5 = Detail-Beiträge), verifiziert gegen den Ist-Code.

Ziel ist ein Google-Maps-artiges Web-UI: eine Karte, die den Bildschirm beherrscht, Kern-Flows als Einblendungen (Bottom-Sheet auf Mobil, Seiten-Panel auf Desktop) darüber. Routy-Grün bleibt Identität. Stats, Settings und Admin bleiben eigene, app-gestaltete Seiten mit Rückweg zur Karte.

Prüfen nach jeder Phase:

```bash
npx tsc --noEmit
npx vitest run
npm run dev
```

Visuell immer Desktop (~1280px) und Mobil (~390px) prüfen, eingeloggt als normaler User und einmal als Admin; wenn eine Session `client === "app"` existiert (Android-Admin-WebView), auch diese Ansicht prüfen.

Nicht anfassen: `src/app/api/**`, `src/app/login/**`, `src/app/share/**`, SQLite-Schema, Routing-Algorithmen in `src/lib/routing.ts`.

---

## 1. Ist-Zustand (kurz, verbindlich)

`src/app/(app)/layout.tsx` (Server Component) lädt den User, baut fünf Links (route, map, stats, settings, admin nur bei `role === "admin"`) und rendert:

- `NavBar` (`src/components/NavBar.tsx`, Client). Bei `user.client === "app"` liefert `navChromeVisibility` (`src/lib/navChrome.ts`) `showHeaderChrome: false` und `showUserbar: false`. Die WebView hat dann **keine** eigene Navigation. Native Android-Tabs laden diese Seiten nicht; nur der Admin-WebView teilt das Session-Cookie (`src/lib/session.ts`, Feld `client`).
- Impersonation-Streifen, falls `isImpersonating()`.
- `<main class="container page-dense">`. `.container` ist max-width 1320px mit Padding (`src/app/globals.css`). Das ist die fixe Hülle, die weg muss — Stats/Settings/Admin behalten `.container.page-dense` aber als eigenen Seitenstandard (nur nicht auf dem Atlas).

Eingeloggte Start-URL: `src/app/page.tsx` leitet nach `/route`.

| URL | Rolle heute | Karte |
| --- | --- | --- |
| `/route` | `RouteGenerator.tsx` (~1180 Zeilen, Client). Start/Ziel, Länge, Generieren, Vorschläge, aktive Route, Punkte, Favoriten. `FreeRoamCard` steckt in `<details>`, nur solange `mode === "suggesting" && !result`. | Eigene `MapViewLazy`, Höhe 360 / im Desktop-Grid sticky |
| `/map` | `OverviewMapClient.tsx`. Netz, `NodePopup` / `SegmentPopup`, Draw / GPX / Record / `SegmentGeometryEditor`. Darunter `SegmentsTable`, `TrashPanel`, Proposal-Listen. | Eigene `MapViewLazy`, Höhe 560. Moduswechsel **demontiert** die Karte und merkt sich `lastView`. |
| `/stats` | Server-Seite, Tabellen und Karten, keine Weltkarte. | — |
| `/settings`, `/settings/account` | Server-Seiten, Forms (`LocaleSelectForm`, Theme, Zeitzone, `MapPreferencesForm`, Walk-Speed, Account). | — |
| `/admin`, `/admin/activity`, `/admin/insights`, `/admin/track-geometry`, `/admin/[id]` | Server-Seiten. Track-Review: `TrackGeometryReview.tsx` mit **eigener** Karte. | nur Review |

`MapView` (`src/components/MapView.tsx`) ist die einzige Karten-API: `markers`, `lines`, `circles`, Klick/Drag, `fitKey`, `initialView`, `onViewChange`, `baseLayerId`, `showTrails`. `height` ist eine **Zahl** und wird inline gesetzt; CSS kann die volle Höhe nicht zuverlässig überschreiben. `FitBounds` nutzt festes Padding `[24, 24]`. Zoom-Control ist Leaflet-Default (oben links). Layer-Prefs: `useMapPreferences` liest `localStorage` `routy.mapPreferences`.

Weitere eigene `MapViewLazy`-Instanzen: `FreeRoamCard`, `RecordTrackWizard`, `DrawPathWizard`, `SegmentGeometryEditor`, `GpxImportWizard` (kleine Vorschau, Klasse `gpx-track-compact`, 160px), `TrackGeometryReview`.

Thema: `data-theme` auf `<html>` (`auto` setzt kein Attribut). Akzent `#2e6b49`, Variablen in `globals.css`. Viewport heute nur `themeColor: "#2e6b49"` (`src/app/layout.tsx`).

i18n: `t(locale, "…")` aus `src/lib/i18n.ts`, Dictionaries `src/lib/i18n/de.json` und `en.json`. Neue Texte nur als Schlüssel `shell.*` in **beiden** Dateien. Bestehende `route.*` / `map.*` / `overview.*` / `nav.*` weiterverwenden.

---

## 2. Zielbild

Eine Leaflet-Karte, ein `MapContainer`, solange der Nutzer auf der Atlas-Seite bleibt. Moduswechsel blendet Einblendungen, er zerlegt die Karte nicht. Stats, Settings, Admin bleiben echte Routen (Server Actions, Tabellen), **aber optisch vollwertige routy-Seiten** (eigener Seitenstandard, nicht der WebView-Roh-Look), erreichbar aus dem Profil mit einer Zurück-Zur-Karte-Leiste.

### 2.1 ASCII — Mobil (unter 960px)

```
┌──────────────────────────────┐
│ [R]                      (o) │  schwebend, safe-area-inset-top
│                              │
│                              │
│         VOLLE KARTE          │
│         (full-bleed)         │
│                              │
│                              │
│ ╭──────────────────────────╮ │
│ │ ───                      │ │  Sheet: peek / half / full
│ │ Start · 4 km · Generieren│ │  nur der aktive Flow
│ ╰──────────────────────────╯ │
│  Erkunden  Plan  Gehen  Aufn.│  Dock, safe-area-inset-bottom
└──────────────────────────────┘
  [R] = Wortmarke, setzt Modus Erkunden, Sheet auf peek
  (o) = Profil (im WebView ausblenden, siehe §8)
```

Sheet zu (peek, nur Griff + eine Zeile Status):

```
│         VOLLE KARTE          │
│  ───   Runde · kurz          │
│  Erkunden  Plan  Gehen  Aufn.│
```

Sheet voll (Formular, Liste, Favoriten): Karte bleibt dahinter, Sheet max ~92dvh, Karte darüber ein schmaler Streifen. Schließen geht auf half, nicht auf einen anderen Modus.

### 2.2 ASCII — Desktop (ab 960px)

```
┌───────────────────────────────────────────────────┐
│ [R]  Erkunden  Plan  Gehen  Aufnahme         (o)  │
│ ┌─────────────────────┐                           │
│ │ Sheet links         │      VOLLE KARTE          │
│ │ max 400px           │                           │
│ │ Start / Ziel        │                           │
│ │ Länge   [Generieren]│                           │
│ │                     │                     [+]   │
│ │                     │                     [-]   │
│ └─────────────────────┘                           │
│ OSM-Attribution unten links, über dem Rand        │
└───────────────────────────────────────────────────┘
```

Kein zweites Menü. Werkzeuge der Übersicht (Zeichnen, GPX, Form bearbeiten, Segmentliste, Papierkorb, Proposals) sind Zeilen **im** Erkunden-Sheet, nicht im Dock.

### 2.3 Layer von unten nach oben

1. Kachel-Layer (OSM / Hiking / Satellit) plus optional Waymarked Trails. Unverändert aus `TILE_LAYERS`.
2. Netz-Polylines und Knoten (Basis, immer, solange Atlas offen ist).
3. Overlay des aktiven Flows (Route, Live-Track, GPS-Punkt, Zeichenpfad, Edit-Linie). Genau ein Schreiber.
4. Leaflet-Popups nur im Modus Erkunden (bestehende `NodePopup` / `SegmentPopup`).
5. Schweben: Wortmarke, Profil, Dock/Desktop-Leiste, Sheet. z-index über Leaflet (siehe §8).
6. Modale, die es schon gibt: `RouteCompletionDialog` (`.completion-overlay`), Impersonation-Streifen, `window.confirm` bei Moduswechsel mit laufender Session.

---

## 3. Zustände

Kein neues State-Paket. Zustand und React Context reichen. Generieren, Check-in, Aufnahme-Logik bleiben in den bestehenden Komponenten.

### 3.1 Was die Shell besitzt

Neues Modul `src/lib/mapMode.ts` (rein, vitest-tauglich, kein DOM):

```ts
export type AtlasMode = "explore" | "plan" | "roam" | "record";
export type SheetSnap = "peek" | "half" | "full";
export type ExploreTool =
  | null
  | "draw"
  | "gpx"
  | "editShape"
  | "segments"
  | "trash"
  | "proposals";

export type LiveSession =
  | { kind: "none" }
  | { kind: "activeRoute" }
  | { kind: "roam" }
  | { kind: "record" };

export function initialMode(opts: {
  requested: AtlasMode | null;
  hasActiveRoute: boolean;
}): AtlasMode;

export function requestModeChange(
  from: AtlasMode,
  to: AtlasMode,
  live: LiveSession,
): { allow: true } | { allow: false; reason: "stop-live" };
```

Regeln:

- `hasActiveRoute` → Startmodus `plan`, auch wenn die URL Erkunden will.
- Ohne aktive Route: `requested` oder sonst `explore`.
- Wechsel auf einen anderen Modus, während `live.kind` `roam` oder `record` ist: nicht still wechseln (`reason: "stop-live"`). Die Shell zeigt einen Confirm (bestehende i18n-Texte wo vorhanden, sonst neue `shell.stopLiveTitle` / `shell.stopLiveBody`). Erst nach Bestätigung stoppt die Kind-Komponente und der Modus wechselt.
- Wechsel weg von `plan` bei `activeRoute`: ebenfalls Confirm. Nicht automatisch `discard` aufrufen. Abbrechen lässt den Modus auf `plan`.
- `explore` bei `live.kind === "none"` ist immer erlaubt.
- `ExploreTool` ist kein Modus. Werkzeug schließen setzt `tool` auf `null` und bleibt in `explore`.

Shell-Context `MapShellContext` (Client):

| Feld | Lebensdauer | Speicher |
| --- | --- | --- |
| `mode`, `sheet`, `tool` | solange `/map` gemountet ist | React-State. Zusätzlich `history.pushState` (nicht `router.push`), damit Android-Zurück zuerst Sheet/Werkzeug/Modus schließt. |
| Kamera `{ center, zoom }` | über Stats/Settings hinweg | `onViewChange` → `sessionStorage` Schlüssel `routy.mapCamera`. Beim Mount als `initialView`. |
| `selection` `{ kind: "node" \| "segment", id }` | Plan- und Erkunden-Klicks | nur RAM. Moduswechsel löscht sie. |
| Basislayer | schon heute | `useMapPreferences`, nicht duplizieren. |

GPS hat genau einen Besitzer: `plan-follow` oder `roam` oder `record` oder keiner. Die Shell startet `watchPosition` nicht selbst. Die bestehende Komponente des aktiven Modus tut das, und nur sie.

### 3.2 Was in den bestehenden Komponenten bleibt

Nicht in den Context heben (sonst wird `RouteGenerator` neu geschrieben):

- Plan: Preset, Start/Ziel, Schleife, Must-visit, Required/Excluded, Explorer, Golden, Result, Nickname, Follow, Voice, Completion. Bleibt in `RouteGenerator`.
- Roam: Token, Track, reached, Phase. Bleibt in `FreeRoamCard`. Token-Rotation (`checkinSeqRef`) nicht anfassen.
- Record: Punkte, Pause, Endpoint-Entscheidungen. Bleibt in `RecordTrackWizard`.
- Draw / Edit-Shape: Punktlisten bleiben in `DrawPathWizard` / `SegmentGeometryEditor`.

Mount-Regel:

- `RouteGenerator` beim ersten Öffnen von `plan` mounten und **gemountet lassen** (per `hidden` / `display:none`, nicht unmount). Sonst gehen Must-visits verloren. Neue Prop `active: boolean`. Bei `active === false` laufendes `watchPosition` aus Follow beenden (Cleanup, den es für `watchId` schon gibt).
- `FreeRoamCard` und `RecordTrackWizard` nur mounten, solange ihr Modus aktiv ist. Verlassen = unmount = bestehender `clearWatch`-Cleanup. Session ist dann beendet (nach Confirm).
- Draw, GPX, Edit-Shape nur mounten, solange `tool` gesetzt ist. Kamera nicht zurücksetzen.

### 3.3 URL ohne Server-Roundtrip

`/map` ist die einzige Atlas-URL.

- `src/app/page.tsx`: eingeloggt weiter nach `/map` (heute `/route`).
- `src/app/(app)/route/page.tsx` wird ein Redirect nach `/map`. Die Page darf `searchParams` nicht bei jedem Klick neu lesen.
- Optional einmalig: `/map?mode=plan|explore|roam|record` nur als **Startwert**. `map/page.tsx` liest das beim ersten Render und übergibt `initialMode`. Danach gehört der Modus dem Client.
- Moduswechsel: `history.pushState({ routy: true, mode, tool, sheet }, "")` plus `popstate`-Listener in der Shell. **Nicht** `useRouter().replace` und nicht `next/navigation`, sonst läuft die Server Component erneut (`listNodes`, `listSegments`, `getActiveRoute`) bei jedem Chip.

Zurück-Reihenfolge auf der Atlas-Seite: `tool` → Sheet von `full` auf `half` → Sheet von `half` auf `peek` → vorheriger `mode` → dann normaler History-Eintrag (Stats/Login). Ein `pushState` pro Stufe, die der Nutzer geöffnet hat. Peek ist der Ruhezustand und erzeugt keinen extra Eintrag.

`popstate` ohne `state.routy` nicht abfangen.

### 3.4 Server-Daten, einmal pro Besuch

`src/app/(app)/map/page.tsx` bleibt Server Component und wird der Bootstrap. Sie vereinigt, was heute `route/page.tsx` und `map/page.tsx` laden:

- User, Locale, `homeNodeId`, Rolle, `walkSpeedKmh` via `effectiveWalkSpeedKmh`.
- `listNodes`, `getUserHomeNode`, `listSegments` + canonical, `getUsageMap`, `listActiveConditions`, `listAvoidSegmentIds`, `getTodayGoldenSegmentIds`, `disconnectedCanonicalSegmentIds`, `loadGraphContext`.
- Aktive Route: `getActiveRoute` + `buildActiveRouteDisplay`, Nickname, Favoriten (`listFavorites` + `buildRouteDisplay`), `segmentGeometries`, `segmentNames`, `lengthBandForUser`.
- Gelöschte Nodes/Segmente für `TrashPanel` (gleiche Filter wie heute: Admin oder Ersteller).
- `deleteError` aus `searchParams` nur für die bestehenden Alerts.

Die Lade-Logik der Map-Page in eine gemeinsame Server-Funktion `src/lib/mapBootstrap.ts` ziehen (Idee aus Composer-Plan; vermeidet Doppel-Queries, falls später sowohl `/map` als auch eine Karten-Ansicht an anderer Stelle braucht). Typ `AtlasBootstrap` in `src/lib/atlasTypes.ts` (nur Types und serialisierbare Felder, **kein** Import von `better-sqlite3`). Client-Komponenten importieren diesen Typ, nicht `@/lib/segments` oder `@/lib/nodes` als Wert, wenn das Modul die DB zieht. `NodeRow` / `SegmentRow` sind schon als Types im Client im Einsatz; das so lassen. Die lokale `isLocked`-Kopie in `OverviewMapClient` (Kommentar: sqlite nicht in den Client) in `src/lib/segmentLock.ts` als reine Funktion ziehen und von Shell und Overview gemeinsam nutzen, sobald Overview gelöscht wird.

Nach Mutationen weiter `router.refresh()` wie heute. Die Shell bekommt neue Props. **Keinen** `key` auf `MapShell` setzen, sonst stirbt Kamera, Plan-Formular und GPS. Frische Props fließen in `RouteGenerator` über die bestehenden `initial*` nur beim ersten Mount; nach `refresh` aktualisiert heute schon der Client seinen eigenen State (Accept/Complete). Das nicht „reparieren“, außer ein Feld kommt nachweislich nicht an. Netzwerk-Linien aus den neuen `segments`-Props neu berechnen (`useMemo`), das ist korrekt.

Leeres Netz (`nodes.length === 0`): keine kaputte Karte. Shell zeigt die Karte mit Default-Zentrum (bestehend: `[51.1657, 10.4515]`) und ein Peek-Sheet mit `t(locale, "import.noTracks")`. Dock-Chips Plan/Gehen/Aufnahme disabled.

---

## 4. Dateien und Komponenten

### 4.1 Neu

```
src/lib/mapMode.ts                 reine Übergänge, vitest
src/lib/mapMode.test.ts
src/lib/atlasTypes.ts              AtlasBootstrap, serialisierbar
src/lib/mapBootstrap.ts            Server-only: gemeinsamer Lader (Composer-Beitrag)
src/lib/segmentLock.ts             isLocked, rein (wenn Overview entfällt)

src/components/map-shell/MapShell.tsx          Client, eine Karte, Dock, Sheet, Profil
src/components/map-shell/MapShellContext.tsx   State + registerLayers
src/components/map-shell/MapCanvas.tsx         MapViewLazy fill, invalidateSize
src/components/map-shell/MapDock.tsx           vier Modi (Label-Chips)
src/components/map-shell/ProfileMenu.tsx       Links raus aus der Karte
src/components/map-shell/BottomSheet.tsx       peek/half/full, Desktop: linke Spalte
src/components/map-shell/PageBackBar.tsx       Zurück zur Karte auf den anderen Routen
src/components/map-shell/AppChrome.tsx         Client, pathname-Weiche

src/components/map-shell/sheets/ExploreSheet.tsx
src/components/map-shell/sheets/PlanSheet.tsx      dünner Host um RouteGenerator
src/components/map-shell/sheets/RoamSheet.tsx      dünner Host um FreeRoamCard
src/components/map-shell/sheets/RecordSheet.tsx    dünner Host um RecordTrackWizard
```

### 4.2 Übernehmen, kaum ändern

| Datei | Verwendung |
| --- | --- |
| `MapView.tsx`, `MapViewLazy.tsx` | Eine Instanz in `MapCanvas`. Kleine API-Erweiterung, Phase 0. |
| `NodePopup.tsx`, `SegmentPopup.tsx` | Weiter als Leaflet-`popup` im Modus Erkunden. Nicht als Sheet nachbauen. |
| `RouteGenerator.tsx` | Logik bleibt. Karten-JSX entfällt im Host-Betrieb. |
| `FreeRoamCard.tsx` | Logik bleibt. Innere `MapViewLazy` entfällt im Host-Betrieb. |
| `RecordTrackWizard.tsx`, `DrawPathWizard.tsx`, `SegmentGeometryEditor.tsx` | Wie Roam: Layer nach oben, Steuerelemente im Sheet. |
| `GpxImportWizard.tsx` | Bleibt mit **eigener** kleiner Vorschaukarte im Sheet. Nicht in die Weltkarte heben. |
| `RouteCompletionDialog.tsx` | Bleibt Modal über allem. |
| `SegmentsTable.tsx`, `TrashPanel.tsx`, `map/actions.ts` | Im Erkunden-Sheet als Slot, Pfade bleiben. |
| `EndpointFields`, `NamePartsInput`, Forms unter Settings | unverändert. |
| `src/lib/navChrome.ts` | Sichtbarkeit Profil/Logout. Tests anpassen, nicht löschen. |

### 4.3 Slots statt Import-Verbot

`TrashPanel.tsx` ist eine Server Component (kein `"use client"`). `MapShell` ist Client und darf sie nicht importieren. `map/page.tsx` reicht sie als Prop hinein:

```tsx
<MapShell bootstrap={bootstrap} embedded={user.client === "app"} initialMode={initialMode}>
  {{
    segments: <SegmentsTable {...} />,
    trash: <TrashPanel {...} />,
  }}
</MapShell>
```

`SegmentsTable` ist schon Client; als Slot zu übergeben ist trotzdem richtig, weil `deleteSegmentAction` aus `./actions` am Ort bleibt.

### 4.4 Layer-Vertrag (eine Funktion, vier Komponenten)

Host-Betrieb über eine optionale Prop, Default so, dass alte Aufrufer in Phase 2–4 noch kompilieren, bis der letzte Aufrufer weg ist:

```ts
type MapLayerSink = {
  markers: MapMarker[];
  lines: MapLine[];
  circles?: MapCircle[];
  fitKey?: string | number;
  onMarkerClick?: (id: number | string) => void;
  onMarkerDragEnd?: (id: number | string, lat: number, lng: number) => void;
  onLineClick?: (id: number | string, lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
};

// Neue optionale Props an RouteGenerator, FreeRoamCard,
// RecordTrackWizard, DrawPathWizard, SegmentGeometryEditor:
hosted?: boolean;          // default false
active?: boolean;          // default true; nur RouteGenerator nutzt es dauerhaft
onLayersChange?: (layers: MapLayerSink) => void;
```

`hosted === true`: kein `MapViewLazy` rendern, `onLayersChange` aus dem bestehenden `useMemo` der Linien/Marker aufrufen (`useEffect`). `initialView` / `onViewChange` / `height` / `mapPrefs` im Host ignorieren. Die Shell setzt `baseLayerId` und `showTrails`.

`MapShell` mischt:

- Basis-Netz immer (Farben wie heute in `OverviewMapClient`: Golden `#c99a2e` gestrichelt, disconnected `#c53030`, locked gestrichelt, Home-Knoten `--waymark` `#a5711c`, sonst `--accent`).
- Darüber die Layer des **einen** Schreibers: `plan` → RouteGenerator, `roam` → FreeRoam, `record` → Record, `tool === "draw" | "editShape"` → das Werkzeug, sonst nur Basis plus Popups.
- Bei aktiver Route die Basis-Linien dünner (`weight: 2`, Opacity gibt es in `MapLine` nicht — `weight` reicht). Die Routenlinie bleibt `weight` 5, Farbe `var(--accent)` bzw. das bestehende Grün `#2e6b49`.

`registerLayers` letzte Meldung gewinnt. Unmount des Schreibers setzt seine Layer auf leer.

### 4.5 MapView-API (Phase 0, klein)

In `MapView`:

- `fill?: boolean`. Bei `true`: Wrapper `height: 100%`, kein numerisches Inline-Height. Parent muss eine Höhe haben.
- `fitPadding?: [number, number]` durchreichen an `fitBounds`. Default bleibt `[24, 24]`. Die Shell übergibt unten mehr, wenn das Sheet auf `half` steht (z. B. `[24, 220]`), damit eine neue Route nicht unter dem Sheet landet.
- `zoomControlPosition?: "topleft" | "topright" | "bottomleft" | "bottomright"`. Auf der Atlas-Seite `bottomright`, sonst verdeckt die Wortmarke das Plus. `MapContainer` von react-leaflet nimmt `zoomControl={false}`; Position über `useMap()` + `L.control.zoom({ position })` in einer inneren Komponente, analog zu `ViewTracker`.
- `className` gibt es schon. Shell setzt `map-box map-box-fill` ohne Border-Radius.

`MapViewLazy`-Loading-Placeholder: bei `fill` dieselbe Klasse, sonst bleibt das leere `map-box`.

Nicht bauen: Marker-Clustering, Geocoder, Turn-by-Turn, eigene Tile-Server, Casing-Linien, WebGL.

### 4.6 Deprecated am Ende (Phase 7, nicht früher löschen)

- `src/components/NavBar.tsx` und `.topnav`-CSS, sobald `AppChrome` auf Nicht-Atlas-Seiten nur `PageBackBar` zeigt.
- `src/app/(app)/map/OverviewMapClient.tsx`, wenn Erkunden/Draw/Record/Edit in der Shell laufen.
- Der Karten-Zweig in `RouteGenerator` (das `route-map-pane`-JSX), wenn `hosted` der einzige Aufrufer ist.
- Layout-Klassen, die nur die alte Zweiteilung tragen: `.route-shell.has-map` Grid, `.map-overview-shell .map-box` Höhen, `.page-dense` auf der Atlas-Seite. `.page-dense` für Admin/Stats/Settings vorerst behalten.
- `navChromeVisibility` nicht löschen: sie entscheidet weiter, ob das Profil Logout zeigt.

`/route` als Redirect behalten (Lesezeichen, WebView-Einstiege).

---

## 5. Server und Client

| Stück | Art | Warum |
| --- | --- | --- |
| `src/app/layout.tsx` | Server | `data-theme`, Locale, Viewport `viewportFit: "cover"`. |
| `(app)/layout.tsx` | Server | `requireUser`, Impersonation, Links fürs Profil als Props. Rendert `AppChrome`. |
| `AppChrome.tsx` | Client | `usePathname()`. Atlas vs. Unterseite. |
| `map/page.tsx` | Server | Bootstrap, Slots. |
| `MapShell` und Sheets | Client | Leaflet, GPS, History. |
| `MapView` | Client, `ssr: false` über Lazy | unverändert. |
| `/stats`, `/settings`, `/settings/account`, `/admin/**` | Server | Forms und `requireAdmin` bleiben. Kein Umweg über Client-Fetch. |
| `route/page.tsx` | Server | nur `redirect("/map")`. |
| `login`, `share` | Server, außerhalb `(app)` | kein Dock, kein Vollbild-Zwang. |

`AppChrome`-Weiche:

- Pfad `/map`: Kinder in `.atlas-frame` (flex, `min-height: 0`, Höhe `100%`). Keine `NavBar`, kein `.container`.
- Jeder andere Pfad unter `(app)`: ab Phase 1 noch die bestehende `NavBar` plus `.container.page-dense`, damit Stats nicht in Phase 1 mitwandern. Ab Phase 5: `PageBackBar` (Link `/map`, Label `t(locale, "shell.backToMap")`) plus `.container.page-dense`. Logout sitzt dann nur noch im Profil auf der Karte und auf `/settings/account` nicht doppelt erfinden — Logout-Form aus der heutigen `NavBar` in `ProfileMenu` übernehmen (`logoutAction` aus `src/app/actions.ts`).

Impersonation bleibt **über** der Karte, volle Breite, kein Overlay auf der Karte. Rahmen:

```css
.app-frame {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.atlas-frame {
  flex: 1;
  min-height: 0;
  position: relative;
}
```

`min-height: 0` ist Pflicht, sonst wächst die Karte nicht in den Rest unter dem Impersonation-Streifen. Nicht `100vh` (Mobile-URL-Leiste). `html, body` sind schon `height: 100%`; `.app-frame` an `100dvh` hängen.

### 5.1 Stats, Settings, Admin — eigene Seiten im App-Stil (Entscheidung 2)

Diese Bereiche **bleiben echte Server-Routen** (nichts wird in ein Overlay auf der Karte gezwungen), aber sie sind **vollwertige routy-Seiten** — nicht der WebView-Roh-Look:

- Jede Seite: `PageBackBar` mit „Zurück zur Karte" (Link `/map`) + eigener `h1` + `.container.page-dense`, damit die Seite scrollbar und konsistent bleibt.
- Sie verwenden dieselben Design-Tokens wie die App (Akzent, Surface, Radius, Ink): bestehende `globals.css`-Variablen, keine separaten Browser-Defaults. Was heute unter der alten Fünf-Link-Nav nach „schlichter Webseite" aussieht (besonders `/settings` mit seinen Forms), bekommt das Routy-Panel-/Card-Erscheinungsbild konsistent zum Karten-UI (Border-Radius `--sheet-radius`, Schatten `--float-shadow`-Familie, Primärbuttons `--accent`).
- `/settings/account` behält sein Logout (nur „Konto"-Seite), das Profil auf der Karte bietet ebenfalls Logout — dort nicht doppelt erzwingen, aber das bestehende Account-Logout weitergeben.
- Admin bleibt schlichte, dichte Tabellen-Seite (dafür ist sie da) — aber auch hier `PageBackBar` als Rückweg und die Text-Links zwischen Admin-Unterseiten intakt.
- Wichtig für den WebView (`client === "app"`): Auch im Embedded-Modus rendern `/settings` etc. **dieselben app-gestalteten Seiten** mit `PageBackBar` (Browser-`NavBar` ist dort eh aus). Der WebView bekommt also nie eine rohe, ungestylte Seite; das ist genau der Unterschied, den Emil eingefordert hat. Der Docker erreicht Settings über die native Hülle/das native Menü; ein doppeltes Profil-Icon wird im Embedded-Modus bewusst nicht gerendert.

Datenfluss Atlas:

```
map/page.tsx (RSC)
  bootstrap props + slots
    → MapShell (client state: mode, sheet, tool, camera)
        → MapCanvas → eine MapViewLazy
        → ExploreSheet | PlanSheet | RoamSheet | RecordSheet
              → bestehende Komponente
                    onLayersChange → Context → MapCanvas
```

On-demand, nicht im Erst-Bundle der Karte erzwingen: `TrackGeometryReview` bleibt auf `/admin/track-geometry` und lädt mit dieser Route. `GpxImportWizard` und `DrawPathWizard` per dynamischem `import()` im Sheet, erst wenn `tool` gesetzt wird (`next/dynamic`, `ssr: false` nur falls Leaflet mitkommt; die Wizard-Module ziehen `MapViewLazy` erst im hosted-Modus nicht mehr). Solange sie noch `MapView` importieren, ist dynamic import trotzdem in Ordnung.

Die Weltkarte selbst ist immer da, sobald `/map` liegt. Kein Skeleton-Menü vor der Karte. Lazy-Placeholder von `MapViewLazy` füllt `.atlas-frame`.

---

## 6. UX und Mikrointeraktionen

### 6.1 Dock (Entscheidung 3: Label-Chips)

Vier **Label-Buttons** („Erkunden · Planen · Gehen · Aufnahme"), `aria-pressed` für den aktiven Modus. Reihenfolge: Erkunden, Planen, Gehen, Aufnahme. Eine primäre Aktion pro Sheet, nicht vier gleich laute Flächen auf der Karte. Labels setzen sich aus bestehenden i18n-Schlüsseln bzw. neuen `shell.*`-Schlüsseln zusammen.

| Modus | Peek-Zeile | Half-Inhalt | Full |
| --- | --- | --- | --- |
| Erkunden | Netzhint (`overview.interactionHint` gekürzt auf eine Zeile) | Werkzeug-Buttons: Zeichnen, GPX, Aufnahme ist schon ein Dock-Modus — hier nicht noch einmal. Zusätzlich Segmentliste, Papierkorb, Proposals/Lock-Proposals (die `<details>` aus `OverviewMapClient`). | Liste/Papierkorb/Proposals scrollen im Sheet. |
| Planen, kein Result | Startname + Preset | bestehende Steuerleiste: Presets, Generieren-Pfeil, Favoriten, Mehr-Optionen | Favoriten und Mehr-Optionen |
| Planen, Vorschlag | km-Chip + Annehmen | Shorter / Again / Longer / Reverse / Accept / Cancel | unverändert die Action-Bar |
| Planen, aktiv | Follow-Status | Complete, Discard, Nickname, Voice | dieselbe Leiste, scrollbar |
| Gehen, idle | `route.freeRoamStart` | Start-Button, Punkte-Hinweis | — |
| Gehen, aktiv | Distanz + reached count | Stop / Fertig, Nachbar-Chips | Nachbarliste |
| Aufnahme | Phase (idle/recording/paused/confirm) | die bestehende Wizard-Leiste | Endpoint-Felder in `confirm` |

Modus tippen: Sheet geht auf `half`, außer es ist schon `full`. Erneuter Tipp auf den aktiven Modus klappt `half` ↔ `peek`. Das ist der einzige Toggle. Nicht die Karte wechseln.

Klick auf die Karte außerhalb des Sheets: `full` → `half`, `half` → `peek`. Modus bleibt. Im Planen ohne Result bleibt der Klick für Start/Ziel/Segment erhalten (`handleMarkerClick` / `handleLineClick`) und öffnet das Sheet auf `half`, damit die bestehende `route-selection-bar` sichtbar ist. Im Erkunden öffnet der Klick das Leaflet-Popup und lässt das Sheet auf `peek`, damit der Popup nicht unter `half` liegt.

Schließen-Kreuz im Sheet-Header: eine Stufe zurück (`full`→`half`→`peek`), nicht Modus wechseln. `aria-label` aus `common.cancel` nur wenn es wirklich abbricht; sonst neuer Schlüssel `shell.collapse`.

Werkzeug „Form bearbeiten": `SegmentPopup` ruft weiter `onEditShape`. Die Shell setzt `tool: "editShape"` und `editingSegmentId`. Zurück-Button im Editor ruft `onDone` → `tool: null`.

### 6.2 Bewegung

CSS only, 200ms `transform` auf dem Sheet. `@media (prefers-reduced-motion: reduce)` ohne Transform, nur ein-/ausblenden. Dock-Indikator: aktiver Chip Hintergrund `var(--accent)`, Text weiß; inaktiv `var(--surface)` und `var(--ink-soft)`.

Keine Seite-rutscht-weg-Animation zwischen Modi. Der Nutzer soll keinen Seitenwechsel spüren: Karte steht, Sheet-Inhalt tauscht, Dock-Chip wandert.

### 6.3 Profil

Runder Button oben rechts, 40px, Initialen oder `RoutyLogo` klein. Menü:

- Statistik → `/stats` (Kamera ist vorher in `sessionStorage`)
- Einstellungen → `/settings`
- Konto → `/settings/account`
- Admin → `/admin` nur wenn `role === "admin"`
- Abmelden → bestehende `logoutAction`-Form

Im Embedded-Modus (`client === "app"`) das ganze Profil **nicht** rendern. Die native Hülle hat Navigation und Logout — und der Zugang zu Stats/Settings läuft dort über die native Navigation (die Seiten selbst sind trotzdem vollständig routy-gestaltet, siehe §5.1). Der Dock bleibt: die WebView hat sonst keinen Weg zwischen Planen, Gehen, Aufnahme und Erkunden, weil `NavBar` heute komplett verschwindet.

Escape schließt Profil, dann eine Sheet-Stufe. Fokus: erster Menüeintrag beim Öffnen, Fokus zurück auf den Button beim Schließen. Kein volles Focus-Trap-Library. Tab-Reihenfolge: Wortmarke, Dock, Sheet, dann Profil.

Touch-Ziele mindestens 44×44px auf Dock und Profil.

### 6.4 Tastatur und Kontrast

Leaflet-Karte ist nicht vollständig per Tastatur bedienbar (bestehende Grenze, nicht Teil dieses Umbaus). Alle neuen Aktionen sind echte `<button>` oder `<a>`.

`data-theme="contrast"`: die bestehende Regel für `:focus-visible` (3px schwarz) um `.map-dock button`, `.map-fab`, `.sheet` erweitern. Keine halbtransparenten Flächen in Contrast (siehe Farben). Golden und Disconnected nicht nur über Farbe: gestrichelte Linie beibehalten, im Sheet den Text aus den bestehenden Chips.

`RouteCompletionDialog` bleibt `z-index` über dem Sheet. Darunter nicht weiterklicken.

### 6.5 Was bewusst nicht wie Google Maps wird

- Kein Adress-Suchfeld. Start und Ziel sind Knoten im Netz. Der Plan-Sheet ist das Suchfeld.
- Keine Wegbeschreibung, kein Kompass-FAB, kein Street View.
- Keine Dauer-Ortung im Erkunden. GPS nur Follow (aktive Route), Gehen, Aufnahme.
- Aufnahme und Gehen brauchen den offenen Tab. Texte in `RecordTrackWizard` nicht verschärfen oder abschwächen.
- Satellit bleibt eine Layer-Option aus den Einstellungen, kein FAB auf der Karte. Layer wechseln weiter in `/settings` über `MapPreferencesForm`. Ein kleiner Layer-Button auf der Karte ist optional in Phase 5, nicht nötig für die erste benutzbare Version.

---

## 7. Farbe

Bestehende Variablen nicht umbenennen. Neue nur ergänzen, in **jedem** Block: `:root`, Dark-Media-Query, `[data-theme="dark"]`, `contrast`, `dog`, `cat`. Dog/Cat/Contrast erben die Logik, nicht eine zweite grüne Palette.

Licht (`:root`):

```css
:root {
  --float: #fffcf8;
  --float-solid: #ffffff;
  --scrim: rgba(24, 32, 24, 0.28);
  --float-shadow: 0 1px 2px rgba(24, 32, 24, 0.06), 0 8px 28px rgba(24, 32, 24, 0.14);
  --sheet-radius: 16px;
  --dock-gap: 0.4rem;
  --fab-size: 2.5rem;
  --map-ink: var(--accent);          /* #2e6b49, Routenlinie */
  --map-ink-strong: var(--accent-strong);
  --map-home: var(--waymark);         /* #a5711c */
  --map-live: #9a3b29;                /* schon Track-Farbe in Record/Draw */
}
```

Dunkel (dieselben zwei Stellen wie heute, Media-Query und `[data-theme="dark"]`):

```css
--float: rgba(23, 29, 20, 0.94);
--float-solid: #171d14;
--scrim: rgba(0, 0, 0, 0.45);
--float-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
--map-live: #e08669;
```

Contrast: `--float` und `--float-solid` beide `#ffffff`, `--scrim: rgba(0,0,0,0.55)`, `--float-shadow: 0 0 0 2px #000`, `--sheet-radius: 6px`. Kein `color-mix` und keine Alpha-Fläche auf Buttons. Rahmen `2px solid #000` an `.sheet` und `.map-dock`.

Dog und Cat: `--float: var(--surface)`, `--map-ink: var(--accent)`, `--map-home: var(--waymark)`, `--map-live: var(--danger)`. Schatten die bestehenden `--shadow`. So bleiben die Spiel-Themes stimmig, ohne die Karte orange oder lila einzufärben. Kacheln (OSM) werden nicht getönt.

Einbindung:

- Sheet, Dock, Profil-Menü, FABs: Hintergrund `var(--float-solid)`, Schatten `var(--float-shadow)`, Text `var(--ink)`, Radius `var(--sheet-radius)` fürs Sheet, FABs Kreis.
- Primärbutton und aktiver Dock-Chip: `var(--accent)` / `var(--accent-strong)`, wie `.btn-primary` heute.
- Karte: kein Rahmen, kein Radius, Hintergrund während Tiles laden `var(--bg)`.
- Routenlinie: `#2e6b49` im Light (oder `var(--accent)` aus dem bereits berechneten Inline-Style; Leaflet nimmt kein CSS-`var()` in allen Pfaden zuverlässig an — **Hex aus dem bestehenden Code weitergeben**, nicht `var(--accent)` ins `color`-Prop von `MapLine` schreiben). Dark-Mode-Linie: `#6fc08c` nur wenn `document.documentElement.dataset.theme === "dark"` oder die Media-Query matcht und Theme `auto` ist. Kleine Hilfsfunktion `mapAccentHex(theme: string | undefined): string` in `src/lib/mapAccent.ts`, Werte 1:1 aus `globals.css` kopieren (`light/auto-light #2e6b49`, `dark #6fc08c`, `contrast #005a2b`, `dog #c9791f`, `cat #a855c9`). Theme kommt als Prop aus der Server-Page (`user.theme`), nicht aus einem zweiten Kontext.

Attribution von OSM/Esri/OpenTopoMap sichtbar lassen. CSS:

```css
.atlas-frame .leaflet-bottom.leaflet-right {
  /* Zoom sitzt bottomright; Attribution nach links */
}
.atlas-frame .leaflet-bottom.leaflet-left {
  margin-bottom: calc(0.5rem + env(safe-area-inset-bottom));
}
.atlas-frame[data-sheet="half"] .leaflet-control-attribution,
.atlas-frame[data-sheet="full"] .leaflet-control-attribution {
  /* auf Desktop unverändert; auf Mobil bei half/full aus dem Sheet heben: */
}
```

Konkret mobil: Attribution `max-width: 55vw`, Schrift 10px, Hintergrund `var(--float-solid)`. Bei `data-sheet="full"` Attribution ausblenden ist **nicht** erlaubt (Lizenz). Sie bleibt am oberen Rand des Sheets als eine Zeile im Sheet-Header rechts, oder Leaflet-Control bekommt `margin-bottom` gleich der Sheet-Höhe. Zweiteres ist weniger DOM-Umzug: CSS-Variable `--sheet-cover` setzt die Shell (peek `4.5rem`, half `46dvh`, full `92dvh`) und `.leaflet-bottom { margin-bottom: calc(var(--sheet-cover) + env(safe-area-inset-bottom)); }` nur unter 960px. Desktop: Sheet ist links, Attribution unten links ohne Extra-Margin, Zoom unten rechts.

Nach jedem Snap und nach `resize`: `map.invalidateSize()` in `MapCanvas` (sonst graue Ränder, bekannter Leaflet-Fall bei flex).

---

## 8. WebView, z-index, bekannte Kartenlücken

Embedded (`user.client === "app"`), weitergereicht als Prop `embedded`:

- Kein Profil, kein Logout, keine Wortmarke als Link auf eine zweite Startseite. Ein kleines `[R]` darf bleiben als Button „Erkunden + peek", ohne `<Link href="/route">`.
- Dock und Sheets bleiben.
- Karte full-bleed unter der Statusleiste; FABs und Dock mit `env(safe-area-inset-*)`. Dafür `viewportFit: "cover"` in `src/app/layout.tsx`.
- Kein `position: fixed` auf `body`-Höhe mit `100vh`.
- Keine zweite untere Nav, die native Tabs nachbaut. Native Tabs laden diese Seiten nicht; der Dock ist die Navigation **innerhalb** der WebView.
- Stats/Settings/Admin **werden auch im Embedded-Modus als vollständig routy-gestaltete Seiten gerendert** (§5.1) — der WebView bekommt nie eine rohe, ungestylte Seite. Zugang dort über die native Hülle.
- Geolocation: weiter `navigator.geolocation`. Kein Background-Geolocation-Polyfill.

z-index, verbindlich:

| Schicht | z-index |
| --- | --- |
| Leaflet-Panes | unverändert (Popup ~700, Controls 1000) |
| Dock, FABs, Sheet, Profil | 1100 |
| Impersonation | im Dokumentfluss, nicht fixed |
| `.completion-overlay` | von 1000 auf **1300** |
| `.actions-menu-panel-fixed` | bleibt 1000 (Admin-Tabellen, nicht über dem Sheet nötig) |

Ein `MapContainer` pro Atlas. Vor dem Merge einer Phase im DOM prüfen: `document.querySelectorAll(".leaflet-container").length === 1` auf `/map`, solange kein GPX-Tool offen ist. GPX-Vorschau darf eine zweite, kleine Karte im Sheet sein (`=== 2`). Draw/Record/Roam/Edit dürfen **keine** zweite Weltkarte mehr erzeugen, sobald sie `hosted` sind.

`FitBounds` feuert bei `fitKey`-Wechsel. Folge-Modus (`followEnabled`) darf danach nicht von `fitBounds` überschrieben werden: im Follow `autoFit={false}` lassen, wie die Route heute den eigenen Marker setzt. Das Verhalten in `RouteGenerator` beim Rauslösen der Linien beibehalten, nicht neu erfinden.

`popup` in Markern nur setzen, wenn `mode === "explore"` und `tool === null`. Im Planen sind Klicks Selektion, kein Popup. Sonst fängt Leaflet den Klick.

Drag eines Knotens (Move-Modus in `NodePopup`) bleibt Erkunden-only, API `onMarkerDragEnd` wie in `OverviewMapClient` (`POST /api/nodes/move`, Admin-Confirm über `REPOSITION_OFF_PATH_THRESHOLD_M`).

Proposals (`/api/app/proposals`, `/api/app/lock-proposals`) weiter clientseitig fetchen, Code aus `OverviewMapClient` nach `ExploreSheet` verschieben, nicht neu designen.

---

## 9. Fahrplan

Jede Phase endet grün: `tsc`, `vitest`, ein Blick auf Port 3000. Keine Phase mit den nächsten vermischen. Alte Seiten bleiben benutzbar, bis die Phase sie ausdrücklich umhängt.

### Phase 0 — Tokens und Karten-API, kein sichtbarer Umbau

- `src/app/globals.css`: neue Variablen in allen Theme-Blöcken (§7). Noch keine Layout-Umbauten.
- `src/components/MapView.tsx`: `fill`, `fitPadding`, `zoomControlPosition`. Defaults = heutiges Verhalten (`fill` false, Padding `[24,24]`, Zoom topleft über Leaflet-Default — wenn das Custom-Control den Default ersetzt, Default-Position `topleft`, damit `/route` und `/map` gleich aussehen).
- `src/components/MapViewLazy.tsx`: `fill` an den Placeholder.
- `src/lib/mapMode.ts` + `src/lib/mapMode.test.ts`: `initialMode`, `requestModeChange`. Fälle: aktive Route erzwingt `plan`; roam→plan ohne Live blockt mit `stop-live`; explore→plan bei `none` erlaubt; from === to ist allow (no-op).
- `src/lib/mapAccent.ts`: Hex-Tabelle, ein vitest dass dark ≠ light.

Testbar: bestehende `/route` und `/map` sehen gleich aus. Zoom-Control noch oben links. `vitest` inklusive der zwei neuen Dateien. Kein manueller GPS-Test.

### Phase 1 — Hülle und eine volle Erkunden-Karte

- `src/app/layout.tsx`: `viewportFit: "cover"`.
- `src/app/(app)/layout.tsx`: `.app-frame`, Impersonation oben, `AppChrome` statt festem `NavBar`+`container`. `NavBar` nur noch für Nicht-`/map`.
- `src/components/map-shell/AppChrome.tsx`, `MapShell.tsx`, `MapCanvas.tsx`, `MapDock.tsx`, `ProfileMenu.tsx`, `BottomSheet.tsx`, `sheets/ExploreSheet.tsx`.
- `src/app/(app)/map/page.tsx`: Bootstrap aus heutiger Map-Page + `mapBootstrap.ts`. Route-Daten (aktive Route, Favoriten) schon mitladen, auch wenn Phase 1 sie nur für `initialMode` nutzt. `OverviewMapClient` noch nicht löschen: ExploreSheet übernimmt erst die **Ansicht** (Marker, Linien, Popups, Drag). Draw/GPX/Record-Buttons im Sheet dürfen in Phase 1 noch `setMode` lokal fehlen und disabled sein mit `shell.comingNext`, oder sie rendern weiter `OverviewMapClient` nicht — besser disabled, damit nicht zwei Karten entstehen.
- `src/lib/atlasTypes.ts`.
- `src/lib/navChrome.ts`: Funktion erweitert, alte Rückgabe bleibt.
- i18n `shell.explore`, `shell.plan`, `shell.roam`, `shell.record`, `shell.profile`, `shell.backToMap`, `shell.collapse`, `shell.stopLiveTitle`, `shell.stopLiveBody`, `shell.comingNext` in `de.json` und `en.json`.
- CSS: `.atlas-frame`, `.map-box-fill`, `.map-dock`, `.sheet`, `.map-fab`. `.map-box` auf der alten `/route`-Seite nicht auf `height: 100%` zwingen.

Verhalten Phase 1:

- `/map` ist full-bleed, keine Top-Nav, Dock sichtbar, nur Erkunden aktiv, andere drei Chips disabled.
- Knoten-Popup, Segment-Popup, Knoten verschieben (Admin) funktionieren.
- Profil öffnet `/stats` (alte Seite mit NavBar — das ist ok bis Phase 5).
- Embedded: kein Profil.
- Impersonation: Streifen oben, Karte füllt den Rest, kein Überlapp.
- Eine `.leaflet-container`.

`/route` bleibt in Phase 1 die alte Seite, damit Generieren nicht zwischen zwei Welten hängt.

### Phase 2 — Planen auf derselben Karte

- `RouteGenerator.tsx`: Prop `hosted` und `active`. `mapLines` / `mapMarkers` (existieren schon) via `onLayersChange`. Den Block `route-map-pane` bei `hosted` nicht rendern. Follow-`watchPosition` stoppt, wenn `active` false wird.
- `sheets/PlanSheet.tsx`: rendert `RouteGenerator` `hosted active={mode==="plan"}`.
- `MapShell`: Dock-Chip Planen an. `initialMode` aus aktiver Route.
- `src/app/(app)/route/page.tsx`: `redirect("/map")`.
- `src/app/page.tsx`: Redirect-Ziel `/map`.
- CSS: Selection-Bar und Action-Bar im Sheet (`route-action-bar` darf bleiben).

Testbar auf `/map`:

- Preset, Generieren, Vorschau-Linie auf der **einen** Karte, Annehmen, kürzer/länger/umdrehen, Favorit laden, aktive Route mit Follow (GPS-Berechtigung), Complete öffnet `RouteCompletionDialog`, Discard zurück zum Formular.
- Wechsel Planen → Erkunden bei aktiver Route fragt nach. Abbrechen bleibt auf der Route.
- DOM: eine Leaflet-Karte. `fitKey` legt die Route nicht dauerhaft unter das Half-Sheet (Padding).
- `/route` landet auf `/map` im Modus Planen (Redirect `/route` → `/map?mode=plan`). Ohne aktive Route öffnet `/route` trotzdem den Planer; `/` (eingeloggt, keine aktive Route) öffnet Erkunden — das ist der gewollte Unterschied: die Karte ist der Eingang, Planen ist ein Modus.
- Deep-Link einmal prüfen: `/map?mode=plan` öffnet das Plan-Sheet auf half. Danach einen Chip tippen und im Netzwerk-Tab sehen, dass **kein** neues RSC-Document für `/map` geladen wird (History-API, nicht Next-Navigation).

### Phase 3 — Freies Gehen

- `FreeRoamCard.tsx`: `hosted`. Die innere `MapViewLazy` (heute ab der Roaming-Phase) weglassen, Track/Position/Reached als Layer nach oben. Idle-UI (Start-Button) bleibt.
- `sheets/RoamSheet.tsx`.
- Dock-Chip Gehen aktiv.
- `RouteGenerator`: den `<details>`-Block mit `FreeRoamCard` bei `hosted` nicht rendern (Gehen ist ein Modus, kein Klappmenü im Planer).

Testbar:

- Start, Live-Track auf der Weltkarte, erreichter Knoten, Finish, Abbruch.
- Während Gehen Chip Planen: Confirm. Bestätigen beendet den Watch (in den Devtools `watchPosition` nicht weiter feuern) und zeigt den Planer. Abbrechen lässt den Track laufen.
- Gehen und Follow einer aktiven Route nie gleichzeitig: die aktive Route blockt den Wechsel schon in Phase 2.
- Token-Check-in weiter gegen `/api/route/free-roam/checkin`. Keine zweite Karte.

### Phase 4 — Aufnahme, Zeichnen, GPX, Form

- `RecordTrackWizard.tsx`, `DrawPathWizard.tsx`, `SegmentGeometryEditor.tsx`: dieselbe `hosted` / `onLayersChange`-Prop. Klicks (`onMapClick`) und Drag müssen durch die Shell an den Schreiber gehen. Dafür die Handler aus `MapLayerSink` auf `MapCanvas` legen, Basis-Popups in diesem Zustand nicht mounten.
- `sheets/RecordSheet.tsx`. Dock-Chip Aufnahme.
- `ExploreSheet`: Buttons Zeichnen und GPX setzen `tool`. Segmentliste rendert den Slot `segments`, Papierkorb den Slot `trash`. Proposals aus `OverviewMapClient` hierher kopieren (Fetch bleibt).
- Edit-Shape aus `SegmentPopup`.
- `GpxImportWizard` unverändert importieren, eigene Mini-Karte ok.

Testbar:

- Aufnahme: Start, Pause, Punkte auf der Weltkarte, Confirm mit `EndpointFields`, Speichern, zurück zu Erkunden, Kamera unverändert (`sessionStorage`).
- Zeichnen: Tap setzt Punkte, Snap, Speichern, eine Leaflet-Weltkarte plus keine zweite volle Karte.
- GPX: Mini-Karte im Sheet, Weltkarte bleibt darunter sichtbar (zwei Container nur hier).
- Form bearbeiten: Linie ziehen, Speichern, `onDone`, Popups wieder da, Zoom gleich.
- Segmentliste löschen (Server Action) und Papierkorb wiederherstellen. `router.refresh()` lässt den Modus Erkunden stehen (kein Remount-`key`).
- Lock- und Pfad-Proposals annehmen/verwerfen wie bisher.

Danach `OverviewMapClient` von `map/page.tsx` abhängen. Datei erst in Phase 7 löschen, falls ein Import übrig ist.

### Phase 5 — Stats, Settings, Admin anbinden und im App-Stil gestalten (Entscheidung 2)

- `AppChrome.tsx`: für alle Pfade außer `/map` die `NavBar` entfernen, `PageBackBar` zeigen. `.container.page-dense` bleibt für diese Seiten.
- `ProfileMenu.tsx`: Ziele `/stats`, `/settings`, `/settings/account`, `/admin`.
- **Design-Pass:** `/stats`, `/settings`, `/settings/account`, `/admin/**` auf den Routy-Seitenstandard heben — identische Tokens wie das Karten-UI (Karten/Cards mit `--sheet-radius`-Radius, Panels mit der `--float-shadow`-Familie, Primärbuttons `--accent`), eigene `h1`, `PageBackBar`. Besonders `/settings` darf nicht mehr wie der rohe WebView-Look wirken; es wird zu einer vollwertigen routy-Seite (Server-rendered, aber gestaltet). Jede Seite scrollbar.
- Achtung Diff-Größe: `NavBar`-Aufruf muss Phase 5 weg, sonst ist die alte Leiste noch da; Datei selbst erst Phase 7 löschen.
- `globals.css`: `.topnav` ungenutzt lassen bis Phase 7.
- Optional, klein: Layer-Button auf der Karte, der dasselbe schreibt wie `MapPreferencesForm` (`localStorage` `routy.mapPreferences`). Wenn er mehr als ein Popover mit drei Radios wird, weglassen. Einstellungen bleiben die Quelle.

Testbar:

- Von der Karte nach Stats, Settings, Account, Admin. Jede Seite scrollbar, eigene `h1`, Button zurück auf `/map`. Kamera (Zentrum/Zoom) nach Rückkehr gleich.
- Theme wechseln auf `/settings`: `data-theme` kippt, Rückkehr zur Karte zeigt Sheet-Farben und Linien-Hex aus `mapAccentHex`.
- Sprache wechseln: Dock-Labels über `t()`.
- Logout nur im Profil (Browser). Embedded weiter ohne Profil; Logout dort nicht neu einbauen.
- Admin-Unterseiten `/admin/activity`, `/admin/insights`, `/admin/[id]`: Zurück-Leiste zeigt auf `/map`, die bestehenden Text-Links zwischen Admin-Seiten bleiben (nicht abreißen).
- Kontrast-Theme: Fokusring auf Dock und Zurück-Button sichtbar.
- WebView (`client === "app"`): `/settings` etc. erscheinen als vollwertige routy-Seiten (kein Roh-Look), Zugang über die native Hülle.

### Phase 6 — Track-Geometrie als Admin-Einblendung

`TrackGeometryReview` nicht in die Weltkarte einbauen. Zwei Karten übereinander (offiziell vs. Vorschlag) sind ein Prüfwerkzeug, keine Spazier-Karte. Einbindung:

- `ProfileMenu` und `ExploreSheet` (nur Admin): Link `/admin/track-geometry`.
- Diese Seite nutzt `PageBackBar` plus die bestehende Komponente mit eigener `MapView`. Das ist die Einblendung: volle Ansicht über dem Atlas, ein klarer Rückweg, keine zweite globale Nav.
- Nicht tun: Review-Zustand in `MapShellContext` heben.

Testbar: Admin öffnet Review von der Karte, akzeptiert oder verwirft einen Vorschlag (oder sieht die leere Liste), zurück, Weltkarte eine Instanz, Modus der vor dem Weggang aktiv war ist weg — das ist ok, weil die Atlas-Seite neu mountet. Kamera aus `sessionStorage` stimmt. User ohne Admin sieht den Eintrag nicht.

### Phase 7 — Aufräumen

- Löschen, wenn unreferenziert: `NavBar.tsx`, `OverviewMapClient.tsx`, ungenutzte CSS (`.topnav`, `.route-shell.has-map`, `.map-overview-shell` Höhen, `.page-dense`-Sonderregeln nur soweit nichts auf Stats/Admin sie braucht).
- `hosted`-Default bleibt `true` nur wenn kein Aufrufer mehr `false` braucht. Sonst Default `false` lassen.
- `navChrome.test.ts` muss zur finalen Funktion passen.
- Toter i18n-Schlüssel nicht aus Prinzip löschen.

Abschlussprüfung:

- `npx tsc --noEmit` und `npx vitest run` grün.
- `/map`: eine Weltkarte, vier Modi, Popups, Generieren, eine echte Runde nur wenn GPS vorhanden ist — sonst Follow-Checkbox sichtbar und ohne Berechtigung eine Fehlermeldung der bestehenden Logik, kein neuer Fehlertext.
- `/stats`, `/settings`, `/admin` ohne Fünf-Link-Leiste, mit Rückweg und Routy-Seitenstandard (eigene `h1`, Tokens, nicht WebView-Roh).
- `/route` → `/map?mode=plan`.
- Eingeloggt `/` → `/map`.
- Ausgeloggt `/` → `/login`, Login-Layout unverändert (kein Dock).
- Share-Seite unverändert.
- Embedded: kein Profil, Dock da, Safe-Area kein abgeschnittener Chip (im Browser mit Device-Toolbar simulieren; echte WebView nur falls zur Hand), Settings/Stats als gestaltete Seiten.

---

## 10. Risiken und Abkürzungen

| Risiko | Umgang |
| --- | --- |
| Mehrere `MapContainer` auf einem Knoten („already initialized") | Ein Schreiber, `hosted`, DOM-Check in jeder Phase ab 2. |
| `100vh` / Flex-Kind ohne `min-height: 0` schneidet die Karte ab | `.app-frame` + `.atlas-frame` wie §5. Nach Impersonation noch einmal schauen. |
| `invalidateSize` vergessen nach Sheet-Snap | `MapCanvas`-Effekt auf `--sheet-cover` und `ResizeObserver`. |
| `router.replace` für den Modus lädt SQLite neu und kann State verwerfen | Nur `pushState`. `router.refresh()` nur nach Mutationen, ohne `key` auf der Shell. |
| `RouteGenerator` beim Umbau versehentlich neu schreiben | Nur JSX der Karte und die FreeRoam-`<details>` verzweigen. Fetch zu `/api/route/generate`, accept, complete, adjust, reverse nicht anfassen. |
| GPS-Watch überlebt den Moduswechsel | `active` bei Plan-Follow; Unmount bei Roam und Record; Confirm davor. |
| Sheet verdeckt OSM-Attribution | `--sheet-cover` als `margin-bottom` der Leaflet-Controls, nicht `display:none`. |
| Leaflet-Controls z-index 1000 überdecken das Sheet nicht, umgekehrt schon | Shell ab 1100, Dialog 1300. Popup bei `half` vermeiden, indem Erkunden das Sheet auf `peek` legt. |
| `color: var(--accent)` an `Polyline` | Hex über `mapAccentHex`. |
| Client importiert `db` | Keine neuen Imports aus `@/lib/segments` oder `@/lib/nodes` in Client-Dateien außer Types. `isLocked` nach `segmentLock.ts`, wenn die Overview-Kopie umzieht. |
| Android-Zurück schließt die WebView statt des Sheets | `pushState`-Stufen in Phase 1 schon fürs Sheet einbauen, nicht erst in Phase 4. |
| WebView `client=app` ohne Profil verliert Stats | Akzeptiert. Native Hülle hat die Nav; die Seiten selbst sind trotzdem vollwertig gestaltet. Diesen Plan nicht um native Tabs erweitern. |
| Zwei Nutzer, kein Produkt | Kein Clustering, kein Suchfeld, kein Parallel-Route-`@sheet`, kein Zustand-Store, keine Animationsbibliothek. |
| GPX-Mini-Karte und Track-Review-Karte | Absichtlich eigene `MapView`. Nicht in Phase 4 „der Einheitlichkeit wegen" verschmelzen. |
| Startseite wird Erkunden statt Planer | Gewollt. Lesezeichen `/route` öffnen weiter den Planer. |
| Dog/Cat-Theme auf OSM-Tiles sieht bunt aus | Nur Chrome folgt dem Theme, Tiles nicht. |
| Hoher Kontrast und Schatten-Ästhetik | Contrast-Block ohne Transparenz, Fokusring 3px. Nicht die Light-Floats wiederverwenden. |
| `FitBounds`-Padding vergisst das Sheet | `fitPadding` aus der Shell. Follow schaltet autoFit aus. |
| Serverseitige Actions in `TrashPanel` | Als Slot aus `map/page.tsx`, nicht aus `MapShell` importieren. |
| Settings im Embedded-Modus wirkt roh | §5.1: auch im WebView vollwertige routy-Seite mit `PageBackBar`, Tokens, eigener `h1`. |

Abkürzungen, die gelten:

- Popups der Übersicht bleiben Leaflet-Popups.
- Generieren, Punkte, Golden, Favoriten, Nickname bleiben unangetastete Client-Logik.
- Settings und Stats bleiben Server-Seiten — aber optisch vollwertige routy-Seiten.
- Track-Review bleibt eine Admin-Seite mit eigener Karte und einem Rückweg.
- CSS-Transition statt Framework.
- `sessionStorage` für die Kamera statt einer neuen Tabelle.

---

## 11. Abnahme pro Phase (Haken)

Phase 0: `tsc`, `vitest`, `/route` und `/map` optisch wie vorher.

Phase 1: `/map` vollflächig, eine Karte, Dock, Profil, Popups, Embedded ohne Profil, Impersonation staucht die Karte korrekt. Planen/Gehen/Aufnahme disabled.

Phase 2: Generieren und aktive Route auf dieser Karte. `/route` redirected. Kein RSC-Refetch beim Chip. Confirm bei laufender Route.

Phase 3: Gehen auf dieser Karte, Watch endet beim Verlassen.

Phase 4: Aufnahme, Zeichnen, GPX-Mini-Karte, Form, Liste, Papierkorb, Proposals. `OverviewMapClient` nicht mehr gemountet.

Phase 5: Keine Fünf-Link-Nav. Rückweg von Stats, Settings, Account, Admin. **Stats/Settings im Routy-Seitenstandard** (eigene `h1`, Tokens, kein WebView-Roh-Look — verifizieren im Embedded-Modus). Theme und Sprache wirken aufs Dock nach der Rückkehr. Kamera wiederhergestellt.

Phase 6: Admin erreicht Track-Review von der Karte und kommt zurück.

Phase 7: ungenutzte Nav-Dateien und CSS weg, Tests grün, Login und Share unverändert.
