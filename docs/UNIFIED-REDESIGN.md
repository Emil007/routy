# Routy: verbindlicher Implementierungsplan Web + Android

**Status:** Einziger Umsetzungsplan. Ersetzt `REDESIGN-WEB.md` und `REDESIGN-ANDROID.md`. **Umsetzung abgeschlossen (J0–J7, alle Phasen), lokale Commits, kein Push.** Abnahme im Browser (Desktop + Telefon) gegen den Dev-Server und den Standalone-Produktions-Build verifiziert; Gates grün. Die Phasenliste §10 ist die einzige Abnahme-Quelle.
**Stand:** gegen den Code in diesem Workspace geprüft (Web Next.js 16.3.2 / React 19 / Leaflet; Android Jetpack Compose / MapLibre / Material3).
**Für wen:** Umsetzung in einem Rutsch, aber **phasenweise reviewbar**. Eine Phase ist fertig, wenn beide Plattformen das Abnahme-Kriterium der Phase erfüllen und die Gate-Kommandos grün sind.

Arbeitsverzeichnisse:

- Web: `web/` (`npx tsc --noEmit`, `npx vitest run`, `npm run dev` → Port 3000)
- Android: `android/` (`./gradlew :app:compileDebugKotlin :logic:test`)

Nicht anfassen, in keiner Phase:

- `web/src/app/api/**`, `web/src/app/login/**`, `web/src/app/share/**`, SQLite-Schema, `web/src/lib/routing.ts`
- `android/logic-kotlin/**` (byte-identisch; `:logic:test` ist das Regressionsnetz)
- Foreground-Service-**Interna**, Worker, Widget, Onboarding, Login-Flow, Captcha. Aufrufstellen dürfen umziehen (`LocationEffects`, `RecordingBinding`). `onDispose` der Service-Bindung darf **kein** `stopAll` dazubekommen: `ActiveRouteTrackingServiceEffect` löst beim Dispose nur `unbindService` aus (`android/app-kotlin/com/routy/app/route/RouteScreen.kt` um Zeile 1353).

---

## 1. Verbindliche Entscheidungen — wie dieser Plan sie erfüllt

Diese Punkte sind festgelegt und werden hier nicht neu verhandelt.

1. **Desktop-Panel rechts.** Web ab 960px und Android-Tablet ab 600dp: Seitenkarte **rechts**, 400px / 400dp, Karte vollflächig darunter. Das Mockup (`mockup-redesign.png`) trägt noch die Überschrift „Linkes Panel“ und die Bildunterschrift „Sheet als linkes Panel“; die Zeichnung und die Kundenentscheidung sind die rechte Kante. Umsetzen: rechts.
2. **Stats und Settings auf dem Web bleiben Server-Seiten** mit eigenem `h1`, denselben Tokens wie die Karte, `PageBackBar` „Zurück zur Karte“. Kein Karten-Overlay, auch bei `user.client === "app"` kein roher Browser-Look.
3. **Dock: vier Label-Chips** in dieser Reihenfolge: Erkunden · Planen · Gehen · Aufnahme. Auf dem Telefon unten, auf Desktop/Tablet als Leiste **oben** (so das Mockup). Der Profil-Knopf ist **kein** fünfter Chip.
4. **Parität.** Eine Farbtabelle (§6), eine Termliste (§5), dieselben Material-Metaphern, dieselben vier Modi und dieselben Ausschlussregeln (§7). Chrome darf abweichen, wo die Plattform es erzwingt (§4.4). Dark-Akzent der App wird von `#4C8B67` auf `#6FC08C` gestellt. Home-/Start-Marker bleibt `#A5711C` auf beiden Plattformen, in jedem Theme.
5. **Android ist nativ die Karte.** WebView nur für `/admin` und `/settings/account`. Stats, Settings, Sessions, Ebenen, Logout bleiben native Composables. Die Web-Atlas-Seite ist der Browser-Client, nicht die Android-Navigation.
6. **Einbetten, nicht neu schreiben.** `RouteGenerator`, `FreeRoamCard`, `RecordTrackWizard`, `OverviewMapClient` (bis er abgelöst ist), `MapView`; Android `RouteViewModel`, `MapViewModel`, `RecordingViewModel`. Logik, Fetches und Services bleiben. Neu ist Hülle, Modus, Sheet.
7. **Android-Route `recording` entfällt** (Phase J4). Hardware-Zurück schließt Stufen und **stoppt GPS nicht**. `rememberSaveable` für Modus und Stufe, weil `selectedTab` heute `remember` ist und nach Theme-/Sprach-`recreate()` auf Tab 0 (Route) fällt (`RoutyShellScreen.kt` Zeile 74).

Jede Phase endet mit einem Paritäts-Blick: gleiche Wörter, gleiche Farben, gleicher Modus-Sinn. Steht in der Phase absichtlich noch eine Lücke (Chips disabled), ist das im Abnahme-Kriterium benannt und auf beiden Seiten gleich, außer die Phase sagt etwas anderes.

---

## 2. Befunde: Widersprüche, Planfehler, Code

Zitate „Web-Plan“ = `REDESIGN-WEB.md`, „Android-Plan“ = `REDESIGN-ANDROID.md`. Zeilen am Code sind der Stand dieser Workspace-Kopie.

### 2.1 Widersprüche zwischen den beiden Plänen

| # | Web-Plan | Android-Plan | Verbindlich in diesem Dokument |
| --- | --- | --- | --- |
| W1 | Aktive Route bleibt im Modus **Planen**. `hasActiveRoute` startet `plan` (§3.1). Gehen = nur `FreeRoamCard`. | `accept()` geht nach **Gehen**. Versöhnung: `RouteMode.ACTIVE` oder `freeRoamActive` → `GO` (§2.4). | **Gehen besitzt die Fortbewegung** (angenommene Route **oder** freies Gehen, nie beides). **Planen** ist Entwurf und Vorschlag bis „Annehmen“. Kaltstart mit aktiver Route öffnet Gehen. Bis Phase J3 bleibt die bestehende UI vorübergehend im Plan-Sheet, damit niemand die Wanderung verliert; J3 zieht sie auf beiden Seiten gleichzeitig um. |
| W2 | Modus-Id `roam`. Dock-Wort „Gehen“. | Modus-Id `GO`. Dock-Wort „Gehen“. | Id überall `go` / `ShellMode.GO`. „Freies Gehen“ bleibt der Name der routenlosen Variante (`route.freeRoamStart` = „Freies Gehen“ / „Free roam“). |
| W3 | Verlassen von Aufnahme: Confirm, dann `clearWatch` (§3.1, §6.5: Aufnahme braucht den offenen Tab). | Moduswechsel bei `RECORDING/PAUSED/CONFIRM` **ohne** Service-Stopp, plus Pille (§2.3). | **Web:** Confirm, dann Watch stoppen. Es gibt kein Background-GPS (kein Polyfill). **Android:** Service läuft weiter, Pille „Aufnahme läuft“, Tipp holt den Modus zurück. Zurück stoppt den Service nie. Das ist die eine erlaubte Ablauf-Abweichung; die Wörter der Stopp-Dialoge bleiben dieselben, wenn der Nutzer explizit verwirft. |
| W4 | Dock immer sichtbar (ASCII §2). | Dock bei aktiver Wanderung und bei Aufnahme verdeckt (§2.3, §3.3). | Dock bleibt sichtbar (Mockup, Entscheidung 3). Wegwechseln aus einem Live-Modus läuft über §7, nicht über ein verstecktes Dock. |
| W5 | Icons: Erkunden 🧭, Planen 🗺️, Gehen 🚶, Aufnahme ⏺ (§0.2). | Erkunden = `Icons.Filled.Map`, Planen = `DirectionsWalk`, Gehen = `Navigation` (§0 und §3.3). | §5. Die Android-Zuordnung verdreht die Wörter (Wandern-Icon auf „Planen“). |
| W6 | Profil oben rechts, vier Dock-Chips (§2, §6.3). | Avatar als fünftes Element **in** der `DockBar` (§3.3). | Profil ist ein runder Knopf oben. Telefon: oben rechts, über den FABs. Desktop/Tablet: oben rechts in der Seitenkarte. |
| W7 | Desktop-Sheet rechts, 400px. Dateiliste §4.1 sagt bei `BottomSheet.tsx` trotzdem „Desktop: linke Spalte“. | Tablet-Seitenkarte **links** 400dp (`MapChrome`, „links 400 dp + 16 dp“, §3.2). | Rechts auf beiden (§4). |
| W8 | Stats/Settings = Server-Seiten, nie Karten-Overlay (§5.1). | `StatsSheet` / `SettingsSheet` als native Stufen (§3.9). | Beides gilt, für je eine Plattform. Web lädt `/stats` und `/settings` als Seiten. Android zeigt dieselben Inhalte nativ in der Schublade. Konto und Admin sind auf Android WebSheets. Wer „Stats in die WebView ziehen“ oder „Web-Stats ins Overlay“ umbaut, widerspricht der jeweiligen Entscheidung. |
| W9 | §8 baut den Atlas-Dock für `client === "app"`, weil die WebView sonst keine Modi hätte. | Nach dem Login gibt es keine Atlas-WebView mehr (§2.2). | Android öffnet die WebView nur für `/admin` und `/settings/account`. Der Web-Dock bei `embedded` bleibt ein Fallback, falls `/map` doch mit `client=app` geladen wird; er ist nicht die Android-Navigation. `PageBackBar` in der WebView darf `/map` nicht in die WebView laden (§8.3). |

### 2.2 Fehler im Plan oder am Code, die sonst falsch umgesetzt würden

1. **`src/lib/i18n.ts` gibt es nicht.** Übersetzung liegt in `web/src/lib/i18n/index.ts`. `t()` splittet Schlüssel an Punkten und läuft über verschachtelte JSON-Objekte (`de.json` / `en.json`). Neue Texte sind ein Objekt `"shell": { "explore": "…" }`, in **beiden** Dateien. Ein flacher Schlüssel `"shell.explore"` wird nie gefunden.
2. **`nav.map` ist nicht „Erkunden“.** `de.json`: `nav.map` = „Übersicht“, `nav.route` = „Route“. `en.json`: „Overview“ / „Route“. Dock-Labels sind neue `shell.*`-Schlüssel. Alte Nav-Schlüssel nicht wiederverwenden.
3. **Home-Marker an `--waymark` zu hängen verletzt `#A5711C`.** Hell ist `--waymark: #a5711c` (`globals.css` Zeile 11). Dunkel wird `--waymark` zu `#e3a94e` (Zeile 34 und 56), Kontrast `#7a4a00` (Zeile 78), Dog `#8a5a2b`, Cat `#d6336c`. Der Code malt Home/Start **fest** `#a5711c` (`FreeRoamCard.tsx` Zeile 94, `DrawPathWizard.tsx` Zeile 63, `RoutyMapView.kt` Zeilen 509, 582–584, 680). `--map-home: var(--waymark)` aus dem Web-Plan §7 wird nicht gebaut. Marker-Hex bleibt `#A5711C`.
4. **`--accent-strong: #1e4a32` ist nicht die App-Basis.** Web-Plan §0.1 behauptet das. App-Konstante `RoutyGreenDark` ist `#1D4A32` (`Color.kt` Zeile 9). Die Karte nutzt fürs Verschieben bereits `#1e4a32` (`RoutyMapView.kt` Zeile 579). `RoutyGreenDark` bleibt `#1D4A32` für gedrückte Zustände. Niemand gleicht die beiden Hex-Werte in diesem Umbau an.
5. **Dark-Primary der App ist heute `#4C8B67`.** `Theme.kt` Zeilen 23–24: `primary = RoutyGreenLight`. Sichtbarer Wechsel auf `#6FC08C` / `onPrimary #0E2418` in Phase J2, sobald der Dock zum ersten Mal da ist (nicht erst beim Aufräumen). Web-Linien laufen heute ebenfalls immer über `#2e6b49` (`MapView.tsx` Zeile 173, Default). `mapAccentHex` speist die **Routenlinie** ab J2.
6. **`.btn-primary` setzt `color: #fff` (`globals.css` Zeile 297–299) auch auf Dark-Akzent `#6fc08c`.** Weißer Text auf `#6FC08C` ist zu hell. Im Dark-Block (Media-Query und `[data-theme="dark"]`) wird die Button-Schrift `#0E2418`. Kontrast-Theme `#005a2b` behält Weiß. Dog/Cat behalten Weiß auf ihrem dunkleren Akzent.
7. **`fitPadding: [24, 220]` ist kein unterer Einschub.** `FitBounds` ruft `map.fitBounds(..., { padding: [24, 24] })` auf (`MapView.tsx` Zeilen 71–83). Leaflets `padding` ist ein `Point(x, y)` und gilt für **alle** Seiten. Eine hohe zweite Zahl vergrößert den Rand oben und unten. Richtig ist ein Objekt `{ top, right, bottom, left }`, umgesetzt als `paddingTopLeft: [left, top]` und `paddingBottomRight: [right, bottom]`. Mobil halb: `bottom` = Sheet-Höhe. Desktop/Tablet: `right` = 416. Folge-Modus setzt `autoFit={false}` (heute schon: `autoFit && !initialView`, Zeile 211).
8. **z-index-Lücke.** `.completion-overlay` ist 1000 (`globals.css` Zeile 1098–1101), gleichauf mit Leaflet-Controls und `.actions-menu-panel-fixed` (Zeile 1011–1013). Der Web-Plan hebt nur das Completion-Overlay auf 1300. `RouteGenerator.tsx` legt Ziel-Ersetzen auf **1001** (Zeile 1139) und Knoten-Nachziehen auf **1000** (Zeile 1158). Beides läge unter einem Sheet von 1100. Beide bekommen die Klasse `map-dialog` mit 1200. Completion bleibt 1300. Admin-Menü 1000 bleibt (keine Atlas-Seite).
9. **Doppeltes Netz, wenn `onLayersChange` die bestehenden Memos durchreicht.** `RouteGenerator` zeichnet im Vorschlagsmodus das ganze Netz (`networkMapLines`, ab Zeile 276). `OverviewMapClient` zeichnet dasselbe Netz (ab Zeile 192). `FreeRoamCard` legt `networkLines` unter den Track (Zeile 307). Im Host-Betrieb liefert jeder Schreiber **nur sein Overlay** (Route, Stationen, Track, Entwurf, GPS-Punkt, Reichweiten-Kreise). Das Basisnetz malt allein die Hülle.
10. **`initialMode` darf nach `router.refresh()` nicht neu gewinnen.** `useState(initialMode)` einmalig. Kein `useEffect`, der den Modus aus den Props zurücksetzt. Kein `key` auf `MapShell` / `MapChrome`. Server Actions rufen heute `revalidatePath("/map")` und `revalidatePath("/route")` (`web/src/app/(app)/map/actions.ts`). Das bleibt. `/route` wird zum Redirect; das Revalidate ist harmlos.
11. **`searchParams` ist in Next 16 ein Promise.** `map/page.tsx` Zeilen 17–24 wartet bereits mit `await searchParams`. Der Modus-Parameter wird in **denselben** Promise-Typ aufgenommen (`mode` neben `deleteError`). Nicht synchron lesen.
12. **Android-`rememberSaveable` auf einem `sealed interface` ohne `Saver` stellt nicht zuverlässig wieder her.** `ChromeState` besteht aus drei Strings (`mode`, `stage`, `webPath`) plus einem `listSaver`. Die versiegelte Stufe wird nur im Speicher daraus gebaut.
13. **Zurück-Funktion des Android-Plans schluckt den letzten Schritt.** Regel 12: bei `RECORDING` und schon Peek → `Stay`. Regel 13: `CONFIRM` immer `Stay`, Sheet klappt nicht zu. Regel 15: sonst `Stay`. Ein aktiver `BackHandler`, der Stay liefert, beendet die Activity nicht. Verbindliche Funktion: §7.3. Letzter Schritt bei Peek ohne Confirm-Dialog: Ereignis **nicht** verbrauchen (Activity in den Hintergrund, Service läuft). `CONFIRM` klappt zuerst Expanded → Half → Peek und verwirft nicht.
14. **`recordingActive` ist bei `CONFIRM` falsch.** `RecordingForegroundService.kt` Zeile 257: `recordingActive` ist nur `RECORDING || PAUSED`. Pille und Versöhnung lesen die gebundene `RecordingServiceState.phase`, inklusive `CONFIRM`.
15. **`PageBackBar` → `/map` in der Konto-WebView öffnet einen zweiten Atlas** über der nativen Karte. `RoutyWebView` lässt jede URL des Server-Hosts zu (`isAllowedWebNavigation`, `RoutyWebView.kt` Zeilen 100–107) und fängt nur `/login` ab (Zeile 76). Ergänzung: Navigation auf `/map` oder `/route` ruft `onDismiss` auf und lädt die URL nicht.
16. **`isLocked` existiert zweimal**, privat: `OverviewMapClient.tsx` Zeile 51 und `SegmentPopup.tsx` Zeile 9. Eine reine Funktion `web/src/lib/segmentLock.ts`. Beide nutzen sie, sobald die Overview-Kopie umzieht. `SegmentPopup` bleibt Leaflet-Popup.
17. **Split gehört zum Form-Editor, nicht zu einem fehlenden Modus.** `SegmentGeometryEditor.tsx` kann `lineAction === "split"` und postet `/api/segments/split`. Android hat `MapMode.SplitSegment` (`MapViewModel.kt` Zeile 60). Fähigkeit bleibt. Web: Split bleibt im Editor. Android: das bestehende Split-Panel bleibt die Stufe im Erkunden-Werkzeug. Kein zweites Split-UI auf dem Web.
18. **Android-Ressourcen und Unit-Tests liegen in diesem Schnappschuss nicht bei.** Kein `res/values/strings.xml`, keine `@Test`-Dateien unter `android/`. Strings dort ergänzen, wo `R.string.nav_route` schon steht (beide Locales). Testklasse ins Unit-Test-Source-Set des Moduls `:app`: `src/test/kotlin/com/routy/app/shell/SheetBackTest.kt`. Kotlin-Quellen dieses Plans: `android/app-kotlin/…` und `android/logic-kotlin/…`.
19. **Spiel-Themes gibt es nur auf dem Web.** `web/src/lib/theme.ts`: `auto | light | dark | contrast | dog | cat`. Android-`THEMES` ist nur auto/light/dark (`SettingsScreen.kt` Zeilen 59–63). `AccountTheme.isDarkTheme` behandelt alles außer `"dark"` / `"light"` als System (`AccountTheme.kt` Zeilen 15–18). Dog/Cat/Kontrast werden **nicht** in den Android-Picker aufgenommen. Keine Kartenlage wird orange oder lila.
20. **`TrashPanel` ist eine Server Component** (kein `"use client"`, importiert `./actions`). `SegmentsTable.tsx` ist Client (Zeile 1) und importiert `deleteSegmentAction` aus `./actions`. Die Hülle ist Client und importiert keines von beiden. `map/page.tsx` reicht beide als Slots hinein. Das Objekt-als-`children`-Muster aus dem Web-Plan ist gültiges React; im Code hier als Prop `slots` tippen, damit es lesbar bleibt.
21. **Karte lässt sich mit CSS nicht auf volle Höhe ziehen.** `MapView` setzt `style={{ height }}` mit `height?: number` (Zeilen 113, 130, 156). `fill` lässt das Inline-Height weg. Der Parent (`.atlas-frame`) hat die Höhe.
22. **Leeres Netz:** Route-Seite nutzt `t(locale, "import.noTracks")` (`route/page.tsx` Zeilen 61–64). Dieselbe Zeile im Peek, Zentrum `[51.1657, 10.4515]` (`MapView.tsx` Zeile 149). Dock-Chips Planen/Gehen/Aufnahme disabled. Karte bleibt da.
23. **GPX-Minikarte und Track-Review bleiben eigene `MapView`.** `.gpx-track-compact .map-box` ist 160px (`globals.css` Zeile 1093). `TrackGeometryReview.tsx` nutzt `height={420}`. Nicht in die Weltkarte heben.
24. **Web-Plan-Tippfehler „Der Docker“** (§5.1) ist kein Bauteil. Gemeint ist der Nutzer in der nativen Hülle.

### 2.3 Was an den Plänen stimmt und bleiben soll

- Eine Weltkarte pro Atlas. Moduswechsel zerlegt sie nicht. `OverviewMapClient` merkt sich `lastView`, weil jeder Modus heute ein eigenes `MapContainer` baut (Kommentar Zeilen 180–183). Das entfällt mit dem Host.
- `RouteGenerator` (1179 Zeilen) bleibt der Planungs- und Folge-Client. Fetches (`/api/route/generate`, accept, complete, adjust, reverse), Token-Rotation in `FreeRoamCard`, Endpoint-Logik in `RecordTrackWizard` bleiben.
- Popups der Web-Übersicht bleiben Leaflet-Popups (`NodePopup`, `SegmentPopup`), nicht als Sheet nachgebaut. Android behält die bestehenden Panels (`MapNodePanel`, `MapSegmentPanel`, …), weil es keine Leaflet-Popups hat. Dieselben Aktionen, unterschiedliches Chrome (§4.4).
- `router.refresh()` nach Mutationen, History für den Modus nur über `pushState` / `popstate`. Kein `router.push` für Chips.
- Slots für Papierkorb und Segmentliste. Proposals weiter per Fetch aus `OverviewMapClient` (`/api/app/proposals`, `/api/app/proposals/accept`, `/api/app/proposals/dismiss`, `/api/app/lock-proposals`, approve, dismiss).
- Android: ein `RoutyMapView`, `mapBinding`, `contentPadding` → `MapLibreMap.setPadding`. Heutiger Fit-Rand ist fest `64` (`RoutyMapView.kt` Zeile 265). Der feste 64er wird auf 24 reduziert, sobald `setPadding` den Sheet-Einschub trägt, sonst doppelt sich der Rand.
- Services, ViewModels, `BootstrapLoader`, `CookieBridge`, Deep Links (`routy://share/…`, `https://…/share/{token}` → `DeepLinkHolder`) bleiben.

---

## 3. Zielbild

Nach dem Login (Android) bzw. auf `/map` (Web): eine Karte bis an die Ränder. Vier Modi. Der aktive Flow liegt im Sheet. Stats und Settings: Web als Seite, Android als Stufe. Admin und Konto: Web immer Seiten; Android zusätzlich als WebView-Stufe über der nativen Karte.

### 3.1 Web, Telefon unter 960px

```
┌──────────────────────────────┐
│ [R]                      (o) │  schwebend, safe-area oben
│                              │
│         VOLLE KARTE          │
│                              │
│ ╭──────────────────────────╮ │
│ │ ───                      │ │  peek / half / full
│ │ Start · 4 km · Generieren│ │
│ ╰──────────────────────────╯ │
│ Erkunden Planen Gehen Aufn.  │  Dock, safe-area unten
└──────────────────────────────┘
```

`[R]` setzt Erkunden und Peek. `(o)` ist das Profil (bei `embedded` weg). Peek zeigt Griff plus eine Statuszeile. Full ist höchstens 92dvh. Schließen geht eine Stufe zurück (full → half → peek), nicht in einen anderen Modus.

### 3.2 Web, Desktop ab 960px

```
┌──────────────────────────────────────────────────┐
│ [R]  Erkunden  Planen  Gehen  Aufnahme           │
│ ┌───────────────────────────────┐ ┌────────────┐ │
│ │                               │ │ (o)  Runde │ │
│ │         VOLLE KARTE           │ │ Start/Ziel │ │
│ │                    [+] [-]    │ │ Generieren │ │
│ │  © OSM                        │ │            │ │
│ └───────────────────────────────┘ └────────────┘ │
└──────────────────────────────────────────────────┘
         Karte liegt unter dem Panel          Panel RECHTS, 400px
```

Die Dock-Leiste sitzt oben auf der Karte, nicht unten. Zoom sitzt unten rechts **in der Kartenfläche links vom Panel** (Leaflet-Control `bottomright` plus `margin-right: var(--panel-cover)`). Attribution unten links, immer sichtbar.

### 3.3 Android, Telefon

```
┌──────────────────────────────┐
│▓▓ Status-Scrim ▓▓▓▓▓▓▓  (o) │
│                    (Kompass) │  nur im Modus Gehen, mit Standort
│                    (Standort)│
│                    (Ebenen)  │
│         RoutyMapView         │
│         volle Fläche         │
│ ╭──────────────────────────╮ │
│ │ Peek: Name / km / Phase  │ │
│ ╰──────────────────────────╯ │
│ Erkunden Planen Gehen Aufn.  │  Dock über der Gestenleiste
└──────────────────────────────┘
```

Kein Wortmarken-Knopf. Profil oben rechts. Die drei FABs (Kompass, Standort, Ebenen) bleiben, sie existieren fachlich schon in `RouteScreen` / `MapStyleSwitcher`. Update-, Upload- und Offline-Hinweise schweben oben links unter dem Scrim und schieben die Karte nicht nach unten.

### 3.4 Android, Tablet ab 600dp

Dieselbe Anordnung wie Web-Desktop: Dock-Chips **oben**, Seitenkarte **rechts** 400dp, Karte vollflächig darunter, `setPadding` rechts 416dp. FABs links der Karte (oben links), damit sie nicht unter der Karte liegen. Profil oben in der Seitenkarte.

### 3.5 Schichten von unten nach oben

1. Kacheln (OSM / Hiking / Satellit) und optional Waymarked Trails. Unverändert aus `TILE_LAYERS` bzw. `BaseMapStyle`.
2. Basisnetz, solange der Atlas offen ist. Farben wie heute in `OverviewMapClient`: Golden `#C99A2E` gestrichelt, disconnected `#C53030`, locked gestrichelt, sonst Akzent-Hex. Home-Knoten `#A5711C`.
3. Genau ein Overlay-Schreiber (§7.4).
4. Web: Leaflet-Popups nur bei Erkunden, Werkzeug `null`, keine Auswahl im Planen. Android: Knoten-/Segment-Aktionen als Stufe, wie die Panels heute.
5. Wortmarke (nur Web), Profil, Dock, Sheet, FABs. z-index über der Karte (§8.1).
6. Dialoge, die es schon gibt: `RouteCompletionDialog`, Ziel-Ersetzen, Nachziehen, Discard, Retag, Impersonation im Dokumentfluss über der Karte (nicht `position: fixed` auf der Karte).

---

## 4. Architektur

### 4.1 Web

```
(app)/layout.tsx          Server: User, Impersonation, AppChrome
  AppChrome               Client: usePathname()
    /map → .atlas-frame
      map/page.tsx        Server: AtlasBootstrap + Slots
        MapShell          mode, sheet, tool, profile, pushState
          MapCanvas       eine MapViewLazy, fill, invalidateSize
          MapDock         vier Chips
          ProfileMenu
          BottomSheet     Telefon unten, ab 960px rechts
          Explore | Plan | Go | Record
    andere (app)-Pfade → PageBackBar + .container.page-dense
```

`/map` ist die einzige Atlas-URL. `web/src/app/page.tsx` leitet Eingeloggte nach `/map` (heute `/route`, Zeile 6). `web/src/app/(app)/route/page.tsx` wird `redirect("/map?mode=plan")`. Lesezeichen bleiben. Hat der Nutzer eine aktive Route, ignoriert `initialMode` das Query und öffnet Gehen (§7.1) — ab Phase J3. In J2 öffnet `/route` noch Planen, inklusive aktiver Route, weil der Gehen-Modus noch nicht da ist.

Bootstrap einmal pro Besuch, Server-only in `web/src/lib/mapBootstrap.ts`. Typen in `web/src/lib/atlasTypes.ts` (serialisierbar, **kein** Import von `better-sqlite3`). Der Loader vereint, was heute `route/page.tsx` und `map/page.tsx` laden:

- User, Locale, Rolle, `homeNodeId`, `effectiveWalkSpeedKmh`
- `listNodes`, `getUserHomeNode`, `listSegments` + `isCanonicalSegment`, `getUsageMap`, `listActiveConditions`, `listAvoidSegmentIds`, `getTodayGoldenSegmentIds`, `disconnectedCanonicalSegmentIds`, `loadGraphContext`
- `getActiveRoute`, `buildActiveRouteDisplay`, Nickname, `listFavorites` + `buildRouteDisplay`, `segmentGeometries`, `segmentNames`, `lengthBandForUser`
- gelöschte Nodes/Segmente mit dem heutigen Filter (Admin oder Ersteller)
- `deleteError` aus `searchParams`

Client-Komponenten importieren aus `nodes.ts` / `segments.ts` nur Typen, die sie schon importieren. Neue Client-Dateien importieren keine Laufzeit-DB.

### 4.2 Android

```
MainActivity / RoutyNavHost
  onboarding, login, shell          recording entfällt in J4
    RoutyShellScreen                dünn: Session, Cookie, Sign-out, Snackbar
      MapChrome                     eine RoutyMapView
        DockBar, ProfileButton, MapFabColumn, Sheet, FloatingNotices
        ExploreSheet, PlanSheet, GoSheet, RecordSheet
        Profile / Stats / Settings / Web(path)
```

ViewModels bleiben am `NavBackStackEntry` der Shell. Moduswechsel disposed sie nicht.

| ViewModel | Wann erzeugt | Bleibt zuständig für |
| --- | --- | --- |
| `ShellViewModel` | immer | Session, Rolle, `signOut`, Cookie |
| `RouteViewModel` | immer | Planung, Vorschlag, `SUGGESTING`/`ACTIVE`, Guide, Free-Roam, Track, Kompass, Share, Abschluss |
| `MapViewModel` | immer | Netz, Tippen, Zeichnen, GPX, Form, Split, Restriktionen, Proposals, Papierkorb |
| `RecordingViewModel` | Modus RECORD oder Service-Phase ≠ IDLE | nur Confirm (Endpunkte, GPX-Commit) |
| `SettingsViewModel` | Stufe Settings oder Profil | Sprache, Theme, Tempo, Sessions |
| `StatsViewModel` | Stufe Stats oder Profil-Teaser | Hero, Touren, Leaderboards |

`RecordingForegroundService` und `RouteTrackingForegroundService` bleiben die GPS-Quelle. `MapViewModel` bekommt keine eigene Location-Pipeline.

Versöhnung in `MapChrome`, nur wenn die gespeicherte Stufe `Hidden` ist (ein bewusster Wechsel wird nicht zurückgerissen):

- `RouteMode.ACTIVE` oder `freeRoamActive` → `GO` + Peek (ab J3; in J2 → `PLAN` + Peek)
- Service-Phase `RECORDING`, `PAUSED` oder `CONFIRM` → `RECORD` + Peek (ab J4; davor bleibt die alte Destination)
- `pendingShareToken != null` → `PLAN` + Half

Effekte, die heute in `RouteScreen` leben, wandern nach `android/app-kotlin/com/routy/app/route/LocationEffects.kt` und laufen in `MapChrome`, solange die Shell lebt: `ActiveRouteLocationEffect`, `ActiveRouteTrackingServiceEffect`, `ActiveTrackingEffects`. Die Aufnahme-`ServiceConnection` aus `RecordingScreen` wandert nach `recording/RecordingBinding.kt` und läuft ebenfalls in `MapChrome`. Confirm überlebt einen Moduswechsel.

### 4.3 Was die Hülle besitzt — und was in den alten Komponenten bleibt

Hülle: Modus, Sheet-Stufe, Werkzeug, Profil auf/zu, Kamera (Web: `sessionStorage` `routy.mapCamera`; Android: die eine `RoutyMapView`-Instanz plus `fitKey`).

Nicht in die Hülle heben: Presets, Must-visits, Golden, Nickname, Follow, Voice, Free-Roam-Token, Aufnahme-Punkte, Draw-Punkte, Edit-Vertices. Das bleibt in der jeweiligen Komponente / im ViewModel.

Mount-Regel Web:

- `RouteGenerator` beim ersten Öffnen von Planen **oder** Gehen mounten und gemountet lassen (`hidden` / `display:none`). Sonst gehen Must-visits verloren. Prop `section`: `"plan" | "go" | "hidden"`.
- `FreeRoamCard` und `RecordTrackWizard` nur mounten, solange ihr Modus aktiv ist. Unmount ruft den bestehenden `clearWatch` auf. Vorher Confirm (§7.2), außer der Nutzer hat selbst gestoppt.
- Draw, GPX, Edit nur mounten, solange das Werkzeug gesetzt ist.

Mount-Regel Android: Composables dürfen aus dem Baum, ViewModels und Services nicht. `RecordingViewModel` überlebt CONFIRM, auch wenn der Dock woanders steht.

### 4.4 Erlaubte Chrome-Unterschiede (kein Paritätsbruch)

| Thema | Web | Android |
| --- | --- | --- |
| Karte | eine Leaflet-`MapView` | eine MapLibre-`RoutyMapView` |
| Knoten-Aktionen | Leaflet-Popup | bestehende Panels als Stufe |
| Stats / Settings | Server-Seite + `PageBackBar` | native Stufe, Inhalt aus `StatsScreen` / `SettingsScreen` |
| Konto / Admin | Seiten | `AuthenticatedWebSheet`, Höhe füllt die Stufe (die festen 560dp in `AuthenticatedWebSheet.kt` Zeile 40 entfallen) |
| Hintergrund-GPS | nicht vorhanden; Verlassen stoppt den Watch | Services laufen; Pille nur für Aufnahme |
| FABs Kompass / Standort / Ebenen | nicht nachbauen. Folge-Schalter und Sprache bleiben im Gehen-Sheet. Ebenen bleiben in `/settings` (`MapPreferencesForm`). Ein Drei-Radio-Popover auf der Karte ist in J5 erlaubt, kein Muss | die drei FABs bleiben |
| Themes contrast / dog / cat | bleiben | nicht im Picker |
| Widget, Update-Banner, Upload-Queue, Battery-Prompt | gibt es auf dem Web als `UpdateBanner` wo er schon eingehängt ist; nichts Neues | unverändert, nur schwebend |
| Impersonation | Streifen über der Karte | gibt es nativ nicht |

### 4.5 Host-Prop (Web), Default erhält alte Aufrufer bis J4

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

// RouteGenerator, FreeRoamCard, RecordTrackWizard,
// DrawPathWizard, SegmentGeometryEditor:
hosted?: boolean;                 // default false
section?: "plan" | "go" | "hidden"; // nur RouteGenerator, default "plan"
onLayersChange?: (layers: MapLayerSink) => void;
```

`hosted === true`: kein `MapViewLazy`. `onLayersChange` im `useEffect` aus dem Overlay-Memo. `height`, `initialView`, `onViewChange`, `mapPrefs` ignoriert der Schreiber; die Hülle setzt `baseLayerId` und `showTrails`. `section === "hidden"`: kein Formular, Follow-Watch aus (der Cleanup an `watchId` in `RouteGenerator.tsx` Zeilen 417–421 bleibt die Stelle). `section === "go"` ab J3: nur der heutige `mode === "active"`-Zweig plus Folge-Leiste. `section === "plan"`: der `suggesting`-Zweig. Internes `mode` von `RouteGenerator` (`"suggesting" | "active"`, Zeile 114) bleibt. Ein Callback `onPhaseChange(phase)` sagt der Hülle Bescheid, wenn Annehmen auf `active` kippt oder Verwerfen zurück auf `suggesting` geht — die Hülle setzt dann den Dock (ab J3: active → Gehen, suggesting → Planen).

`GpxImportWizard` behält die eigene kleine Karte.

---

## 5. Termliste und Icons

Eine Liste. Web: `shell.*` in `de.json` und `en.json`. Android: neue `R.string`-Schlüssel in beiden vorhandenen Locales, neben `nav_route`. Bestehende fachliche Schlüssel (`route.*`, `map.*`, `record_*`, `stats_*`) bleiben die Sheet-Texte.

| Schlüssel Web | Schlüssel Android | de | en | Material (Android) | Lucide (Web, dieselbe Metapher) |
| --- | --- | --- | --- | --- | --- |
| `shell.explore` | `shell_mode_explore` | Erkunden | Explore | `Icons.Filled.Explore` | `Compass` |
| `shell.plan` | `shell_mode_plan` | Planen | Plan | `Icons.Filled.Map` | `Map` |
| `shell.go` | `shell_mode_go` | Gehen | Go | `Icons.AutoMirrored.Filled.DirectionsWalk` | `Footprints` |
| `shell.record` | `shell_mode_record` | Aufnahme | Record | `Icons.Filled.FiberManualRecord` | `Circle` |
| `shell.profile` | `shell_profile` | Profil | Profile | `Icons.Filled.AccountCircle` | `User` |
| `shell.backToMap` | — (nativ schließt die Stufe) | Zurück zur Karte | Back to map | `Icons.AutoMirrored.Filled.ArrowBack` | `ArrowLeft` |
| `shell.collapse` | contentDescription aus bestehendem Collapse, sonst neu | Einklappen | Collapse | `Icons.Filled.ExpandMore` | `ChevronDown` |
| `shell.stopLiveTitle` | bestehender `route_back_active_confirm` für die Route; fürs freie Gehen der bestehende Abbruch-Text | Live-Modus beenden? | Stop the live session? | — | — |
| `shell.stopLiveBody` | wie oben, plattformspezifisch ausformuliert, gleicher Sinn | Die laufende Tour wird beendet. | This ends the current outing. | — | — |
| `shell.comingNext` | nicht anzeigen, Chip weglassen oder disabled ohne neuen Satz | Kommt im nächsten Schritt. | Available in the next step. | — | — |
| `shell.recordingPill` | `shell_recording_pill` | Aufnahme läuft | Recording | — | — |
| `shell.layers` | `shell_layers` | Ebenen | Layers | `Icons.Filled.Layers` | optional |
| `shell.editNetwork` | `shell_edit_network` | Netz bearbeiten | Edit network | `Icons.Filled.Edit` | `Pencil` |
| `shell.destinationHint` | `shell_destination_hint` | Ziel oder Knoten | Destination or junction | — | — |

Nicht verwenden: „Entdecken“, „Übersicht“ als Dock-Wort, „Route“ als Dock-Wort für Planen. „Freies Gehen“ / „Free roam“ bleibt `route.freeRoamStart`.

Freies-Gehen-Zeilen, die heute per String-Konkatenation entstehen, werden beim Umzug zu Ressourcen mit Platzhalter (de und en). Web hat dafür schon `route.freeRoamReached` mit `{name}`.

Weitere Glyphen, wenn eine Aktion ein Icon braucht: Zurück `ArrowBack`, Umdrehen `SwapHoriz` / `ArrowLeftRight`, Favorit `Star`, Teilen `Share`. Kürzer / Nochmal / Länger bleiben Textbuttons.

---

## 6. Farbtabelle (eine Quelle)

Werte, die beide Plattformen malen. Web-CSS-Variablen nicht umbenennen; nur ergänzen, und zwar in **jedem** Block: `:root`, `prefers-color-scheme: dark`, `[data-theme="dark"]`, `[data-theme="contrast"]`, `[data-theme="dog"]`, `[data-theme="cat"]`.

| Rolle | Hell | Dunkel | Web | Android |
| --- | --- | --- | --- | --- |
| Akzent, Routenlinie, Knoten-Default | `#2E6B49` | `#6FC08C` | `--accent`, `mapAccentHex` | `RoutyGreen`; Dark-`primary`. `RoutyGreenLight` wird Alias von `#6FC08C` |
| Text auf Akzent | `#FFFFFF` | `#0E2418` | `.btn-primary` und aktiver Chip; Dark-Schrift nur in den Dark-Blöcken | `onPrimary` |
| Akzent gedrückt, Web | `#1E4A32` | `#8FDA9F` | bestehendes `--accent-strong` | nicht als Token nachziehen |
| Akzent gedrückt, App | `#1D4A32` | — | — | `RoutyGreenDark` bleibt |
| Home / Start | `#A5711C` | `#A5711C` | Hex im Marker, nicht `--waymark` | unverändert `#a5711c` |
| Golden | `#C99A2E` | `#C99A2E` | gestrichelte Linie | unverändert |
| Disconnected | `#C53030` | `#C53030` | gestrichelt | unverändert |
| Aufnahme-Track | `#9A3B29` | `#9A3B29` | wie `RecordTrackWizard` / `DrawPathWizard` heute | wie die Recording-Farbe heute. Nicht auf `#E08669` umbiegen |
| Danger-Text | `#9A3B29` | `#E08669` | bestehendes `--danger` | `RoutyError #B3261E` bleibt der Form-Fehler. Track und Form-Fehler nicht in einen Topf |
| Kontrast-Akzent | `#005A2B` | — | nur Web-Theme | kein Picker |
| Dog-Akzent | `#C9791F` | — | nur Web-Theme | Konstante erlaubt, keine Karte, kein Picker |
| Cat-Akzent | `#A855C9` | — | nur Web-Theme | ebenso |
| Required / Must-visit | `#2B6CB0` | `#2B6CB0` | schon in `RouteGenerator` | schon in `RoutyMapView` |
| Verschieben-Knoten | `#1E4A32` | `#1E4A32` | — | `RoutyMapView.kt` Zeile 579, lassen |

`mapAccentHex(theme, prefersDark)` in `web/src/lib/mapAccent.ts`:

| Situation | Hex |
| --- | --- |
| `light`, oder `auto`/`undefined` bei hellem System | `#2E6B49` |
| `dark`, oder `auto`/`undefined` bei `prefers-color-scheme: dark` | `#6FC08C` |
| `contrast` | `#005A2B` |
| `dog` | `#C9791F` |
| `cat` | `#A855C9` |

Theme kommt als Prop vom Server (`user.theme` auf `<html data-theme>`, siehe `web/src/app/layout.tsx` Zeilen 24–27). `auto` setzt kein Attribut; die Funktion braucht deshalb das Media-Query-Flag. Ein vitest: dark ≠ light, contrast ≠ light, dog ≠ cat.

Chrome-Tokens, neu, gleiche Bedeutung:

| Token | Web-Variable | Hell | Dunkel |
| --- | --- | --- | --- |
| Schwebende Fläche | `--float-solid` | `#FFFFFF` | `#171D14` |
| Translucent (nur Android-Scrim-Fläche, nicht die Buttons) | `--float` | `#FFFCF8` | `rgba(23,29,20,0.94)` |
| Scrim | `--scrim` | `rgba(24,32,24,0.28)` | `rgba(0,0,0,0.45)` |
| Schatten | `--float-shadow` | `0 1px 2px rgba(24,32,24,0.06), 0 8px 28px rgba(24,32,24,0.14)` | `0 8px 28px rgba(0,0,0,0.45)` |
| Sheet-Radius | `--sheet-radius` | `16px` | `16px` |
| Kontrast-Fläche | `--float-solid` | `#FFFFFF`, `--scrim` 0.55, Schatten `0 0 0 2px #000`, Radius `6px`, Rahmen `2px solid #000` | — |
| Dog/Cat-Fläche | `--float` | `var(--surface)`, Schatten das bestehende `--shadow` | — |

Android in `Color.kt`, gelesen von den schwebenden Flächen direkt (kein `surfaceTint` über die Kacheln):

| Token | Hell | Dunkel |
| --- | --- | --- |
| `ChromeCard` / `DockSurface` | `#FFFFFFF5` | `#1B1F19F0` |
| `ChromeScrim` | `#1A1A1A` bei 32 % | `#000000` bei 56 % |
| `ChromeTopScrim` | Schwarz 40 % → 0, 72dp | gleich |
| Hintergrund hinter der Karte | `#FAFAF7` / `#11140F` | unverändert |
| Fehler | `#B3261E` | unverändert |

Dock-Chip aktiv: Fläche Akzent, Text = „Text auf Akzent“ aus der Tabelle. Inaktiv: Fläche `--float-solid` / `ChromeCard`, Text `--ink` / `onSurface`.

Kontrast: die bestehende 3px-Regel (`globals.css` Zeilen 89–91) um `.map-dock button`, `.map-fab`, `.sheet`, `.page-back` erweitern. Keine Alpha-Flächen auf Buttons im Kontrast-Theme.

OSM-/Esri-/OpenTopoMap-Attribution nie `display: none`. Mobil: `--sheet-cover` (peek `4.5rem`, half `46dvh`, full `92dvh`) als `margin-bottom` von `.leaflet-bottom`. Desktop und Tablet: Panel rechts, Attribution unten links ohne diesen Extra-Rand, Zoom mit `margin-right: var(--panel-cover)` (`400px + 16px`).

---

## 7. Zustände

### 7.1 Startmodus

```ts
export type AtlasMode = "explore" | "plan" | "go" | "record";

export function initialMode(opts: {
  requested: AtlasMode | null;
  hasActiveRoute: boolean;
  freeRoamActive: boolean;
  recordingLive: boolean;
}): AtlasMode {
  if (opts.recordingLive) return "record";
  if (opts.freeRoamActive || opts.hasActiveRoute) return "go";
  return opts.requested ?? "explore";
}
```

Web hat heute kein persistiertes Free-Roam und keine Hintergrund-Aufnahme: `freeRoamActive` und `recordingLive` sind dort `false`. `hasActiveRoute` kommt von `getActiveRoute`. Android setzt die Flags aus ViewModel und Service.

`/map?mode=plan|explore|go|record` ist nur der Startwert. Danach gehört der Modus dem Client. Eine aktive Route oder eine laufende Aufnahme schlägt das Query (man landet auf der Tour, nicht im Formular darunter).

### 7.2 Moduswechsel

```ts
export type LiveSession =
  | { kind: "none" }
  | { kind: "activeRoute" }
  | { kind: "freeRoam" }
  | { kind: "record" };

export function requestModeChange(
  from: AtlasMode,
  to: AtlasMode,
  live: LiveSession,
  recordContinuesInBackground: boolean,
):
  | { allow: true }
  | { allow: false; confirm: "stop-route" | "stop-roam" | "stop-record" };
```

Regeln, in dieser Reihenfolge, vitest und `SheetBackTest`:

- `from === to`: erlauben. Die Hülle toggelt dann nur das Sheet (half ↔ peek), siehe unten.
- `live.kind === "record"` und Ziel ≠ `record`: Android (`recordContinuesInBackground === true`) erlauben, Service nicht stoppen, Pille zeigen. Web: `confirm: "stop-record"`. Erst nach Bestätigung unmounten.
- `live.kind === "activeRoute"` und Ziel ≠ `go`: `confirm: "stop-route"`. Bestätigung ruft den bestehenden Discard-Pfad (`discardActive` bzw. den Discard-Button in `RouteGenerator`) inklusive `RouteTrackingForegroundService.stopAll`. Abbrechen lässt den Modus.
- `live.kind === "freeRoam"` und Ziel ≠ `go`: `confirm: "stop-roam"`, danach `cancelFreeRoam` bzw. der Abbruch in `FreeRoamCard`.
- Sonst erlauben. Ein unangegenommener Vorschlag ist `live.kind === "none"`. `RouteGenerator` bleibt gemountet, Must-visits überleben den Abstecher nach Erkunden.

Gleichzeitigkeit, die beide UIs gleich benennen:

- Folge einer aktiven Route, freies Gehen und Aufnahme zeichnen nie gleichzeitig ins Overlay.
- Freies Gehen starten, während eine Route `ACTIVE` ist: Button disabled (heute schon getrennte Zweige).
- Aufnahme starten, während Route oder Free-Roam läuft: erst die Confirm aus `requestModeChange`. Auf Android bleibt eine bereits laufende **Aufnahme** im Service, wenn man nur den Dock verlässt; eine **neue** zweite Aufnahme gibt es nicht.

Dock-Tipp auf den aktiven Modus: Sheet `half` ↔ `peek` (Telefon) bzw. Panel offen ↔ zu einer schmalen Griffleiste (Desktop/Tablet). Das ist der einzige Toggle. Tipp auf einen anderen erlaubten Modus öffnet `half` bzw. das Panel.

Kartenklick neben dem Sheet: `full` → `half`, `half` → `peek`. Modus bleibt. Im Planen ohne Resultat bleibt der Klick Selektion (Start/Ziel/Segment) und öffnet `half`. Im Erkunden öffnet der Klick das Popup (Web) bzw. die Knoten-Stufe (Android) und legt das Sheet auf `peek`, damit das Popup nicht unter `half` liegt.

### 7.3 Zurück

Eine reine Funktion, auf Android `android/app-kotlin/com/routy/app/shell/SheetBack.kt` (kein Compose-Import). Das Web bildet dieselbe Reihenfolge mit `history.pushState` ab.

```ts
type Stage =
  | "hidden" | "peek" | "half" | "full"
  | "profile" | "stats" | "settings"
  | "web" | "editMenu" | "node" | "segment";

type BackResult =
  | { type: "web-history" }
  | { type: "apply"; stage: Stage; mode?: AtlasMode; clearTool: boolean }
  | { type: "confirm"; confirm: "stop-route" | "stop-roam" }
  | { type: "pass" };
```

`pass` heißt: `BackHandler` ist aus, das System macht weiter (Activity in den Hintergrund, Browser zum vorigen Eintrag). GPS läuft dabei weiter, wenn ein Service läuft. Web: `popstate` ohne `state.routy` nicht abfangen.

Reihenfolge:

1. Stufe `web` und `webCanGoBack` → `web-history`.
2. Stufe `web` → `profile`.
3. `stats` oder `settings` → `profile`. Auf dem Web sind das echte Routen: Browser-Zurück verlässt die Seite, `PageBackBar` geht nach `/map`. Dieselbe mentale Stufe.
4. `profile` → `peek`, Modus bleibt.
5. `full` → `half`. `half` → `peek`.
6. Werkzeug gesetzt (draw, gpx, editShape, split, segments, trash, proposals) → Werkzeug zu, Modus Erkunden, Stufe `half` (Werkzeugmenü).
7. `node` oder `segment` → `peek`, Auswahl leer.
8. `editMenu` → `peek`.
9. Peek, Modus Planen, kein Live-GPS → Modus Erkunden, Stufe `peek`.
10. Peek, Modus Gehen, kein `activeRoute` und kein `freeRoam` → Erkunden, `peek`.
11. `activeRoute` → `confirm stop-route`. State bleibt bis zur Antwort.
12. `freeRoam` → `confirm stop-roam`.
13. Modus Aufnahme, Phase `RECORDING` oder `PAUSED`, Stufe über Peek → auf `peek` reduzieren. Phase `CONFIRM`, Stufe über Peek → ebenso. **Nicht** verwerfen, **nicht** den Service stoppen.
14. Peek und (kein Confirm-Fall mehr) → `pass`. Das gilt auch für laufende Aufnahme und für `CONFIRM`. Verwerfen nur über den bestehenden Button (`record_discard` / die Discard-Aktion).

Peek ist der Ruhezustand und erzeugt keinen History-Eintrag. Jede vom Nutzer geöffnete Stufe darüber erzeugt genau einen `pushState({ routy: true, mode, tool, sheet })`. `popstate` wendet den State an.

Auf dem Web ab J1 fürs Sheet einbauen, nicht erst mit der Aufnahme. Android: ein `BackHandler` in `MapChrome`. Der WebView-`BackHandler` in `RoutyShellScreen.kt` Zeilen 100–102 wird davon abgelöst; `goBack` ist Regel 1, kein zweiter Handler.

### 7.4 Wer die Karte füttert

Web, in `MapShell`: Basisnetz immer. Darüber genau ein Schreiber.

| Zustand | Schreiber | Overlay |
| --- | --- | --- |
| `record` | `RecordTrackWizard` | Track `#9A3B29`, Entwurfspunkte, eigener Standort |
| `go` und interne Phase `active` | `RouteGenerator` `section="go"` | Routenlinie `mapAccentHex`, Stationen, Follow-Punkt |
| `go` und Free-Roam | `FreeRoamCard` | Track `#9A3B29`, erreichte Knoten, Start `#A5711C`, Kreise |
| `plan` | `RouteGenerator` `section="plan"` | Vorschau-Linie, Start/Ziel/Must-visit, Required `#2B6CB0` |
| Werkzeug `draw` oder `editShape` | der Wizard / Editor | Entwurf, Vertices |
| sonst | keiner | nur Basisnetz + Popups |

Bei liegender Routenlinie das Basisnetz dünner (`weight: 2`). `MapLine` hat kein `opacity`-Feld; `weight` genügt. `registerLayers`: letzte Meldung gewinnt, Unmount setzt leer.

Android, reine Funktion `mapBinding` in `shell/MapBinding.kt`:

1. Modus `RECORD` und Phase `RECORDING` / `PAUSED` / `CONFIRM` → Track, `routeColor "#9A3B29"`, `myLocation` aus dem Service, Klicks leer.
2. Modus `GO`, oder (nur J2) Modus `PLAN` und `route != null` → dieselben Argumente wie `RouteMapChrome` heute (`displayRouteGeometry`, Stationen, `followEnabled`, Kompass). Badges nur im Planen.
3. Sonst → Argumente wie `MapScreen` (`emphasizeNetworkSegments = true`, `overlayLine`, Edit-Vertices, `onMapClick` an `MapViewModel`).

`fitKey` wechselt bei Routen-Token, erster Netzladung, Aufnahmepunktzahl. Nicht beim Dock-Tipp. Follow schlägt `fitBounds`: `fitToRouteOnly` nur beim ersten Token, danach Kamera dem Follow überlassen.

Klicks:

- Erkunden / `MapMode` ≠ View → `MapViewModel.onMapClick`
- Planen → `onPlanningMapClick` (heute im Route-Screen)
- Gehen + ACTIVE, Long-Click → Retag (bestehender Dialog)
- Aufnahme schluckt Klicks

`contentPadding`: Telefon = Dock + Peek + Navigation-Bar-Inset unten. Tablet = 416dp rechts, FAB-Spalte links. Die Karte bekommt das IME nicht als Padding; Textfelder im Sheet nutzen `imePadding`.

---

## 8. Einbau-Details, die sonst danebengehen

### 8.1 z-index Web

| Schicht | z-index |
| --- | --- |
| Leaflet-Panes | unverändert (Popup ca. 700, Controls 1000) |
| Dock, FABs, Sheet, Profil, Wortmarke | 1100 |
| `.map-dialog` (Ziel-Ersetzen, Nachziehen) | 1200 |
| `.completion-overlay` | 1300 |
| Impersonation | im Fluss, nicht fixed |
| `.actions-menu-panel-fixed` | 1000 lassen |

Vor dem Merge ab J2 im DOM: `document.querySelectorAll(".leaflet-container").length === 1` auf `/map`, solange GPX zu ist. GPX-Vorschau darf `=== 2` sein. Draw, Record, Roam, Edit erzeugen keine zweite Weltkarte, sobald `hosted`.

### 8.2 Layout Web

```css
.app-frame { height: 100dvh; display: flex; flex-direction: column; min-height: 0; }
.atlas-frame { flex: 1; min-height: 0; position: relative; }
```

Nicht `100vh`. `html, body` sind schon `height: 100%`. `min-height: 0` ist Pflicht, sonst frisst der Impersonation-Streifen die Karte nicht sauber. `viewportFit: "cover"` in dem bestehenden `viewport`-Export von `web/src/app/layout.tsx` (heute nur `themeColor`).

`AppChrome`:

- Pfad `/map`: Kinder in `.atlas-frame`. Keine `NavBar`, kein `.container`.
- Jeder andere Pfad unter `(app)`: bis J5 noch `NavBar` plus `.container.page-dense`. Ab J5 `PageBackBar` plus `.container.page-dense`.

Nach jedem Snap und nach `resize`: `map.invalidateSize()` (`ResizeObserver` plus Effekt auf `--sheet-cover`).

Zoom-Control: `MapContainer` mit `zoomControl={false}`, Position über `useMap()` und `L.control.zoom({ position })`, analog zu `ViewTracker`. Default der neuen Prop: `topleft`, damit `/route` und die alte Übersicht bis zu ihrem Umbau gleich aussehen.

Sheet-Bewegung: 200ms `transform`. `prefers-reduced-motion: reduce` ohne Transform. Touch-Ziele mindestens 44×44px (Web) bzw. 48dp (Android-Primärbuttons). `CompactButton` (28–30dp, `RouteScreen` / `MapScreen` / `RecordingScreen`) wird ab J5 nicht mehr in die neuen Sheets übernommen; in J1–J2 sehen die ausgeschnittenen Screens noch aus wie vorher.

Escape schließt zuerst das Profil, dann eine Sheet-Stufe. Fokus: erster Menüeintrag beim Öffnen, zurück auf den Profil-Knopf. Keine Focus-Trap-Bibliothek.

### 8.3 Embedded und WebView

`embedded={user.client === "app"}` kommt schon aus `(app)/layout.tsx` Zeile 29. `navChromeVisibility` (`web/src/lib/navChrome.ts`) bleibt und entscheidet weiter, ob Profil und Logout im Web gerendert werden. Tests in `navChrome.test.ts` anpassen, Funktion nicht löschen.

Embedded auf `/map` (Fallback): kein Profil, kein Logout, kein Link der Wortmarke auf `/route`. `[R]` bleibt ein Button „Erkunden + Peek“. Dock und Sheets bleiben. Safe-Area über `env(safe-area-inset-*)`.

`PageBackBar`:

- Browser: `<Link href="/map">`.
- `embedded`: sichtbare Leiste, gleiche Schrift, gleiche Tokens, `h1` der Seite bleibt. Der Klick navigiert nicht selbst. `RoutyWebView` fängt `/map` und `/route` ab, ruft `onDismiss`, lädt die URL nicht. So landet „Zurück zur Karte“ auf der nativen Karte.
- Admin-Unterseiten behalten ihre Text-Links untereinander. Die Leiste zeigt zusätzlich nach `/map` (Browser) bzw. schließt das Sheet (embedded).

Logout: im Browser im Profil (`logoutAction` aus `web/src/app/actions.ts`, heute in `NavBar.tsx` Zeile 54) und weiterhin auf `/settings/account`. Auf Android `ShellViewModel.signOut`. Kein zweites Logout in der eingebetteten Konto-Seite erfinden; das bestehende Account-Logout bleibt, `RoutyWebView` fängt `/login` und meldet nativ ab.

Dauer-WebView des Admin-Tabs (`RoutyShellScreen.kt` Zeilen 96–159, per `zIndex` versteckt) entfällt in J2. Eine WebView entsteht nur, solange die Stufe `web` offen ist, und wird beim Schließen verworfen. State-Bundle im `DisposableEffect`, wie `RoutyWebView` es schon kann. `CookieBridge.installSessionCookie` einmal in der Shell und erneut im Sheet, vor `loadUrl`.

### 8.4 Android-Systemleisten

`enableEdgeToEdge` ist an (`MainActivity.kt` Zeile 39). Die Karte hat kein `statusBarsPadding`. FABs und Profil: `safeDrawing` oben und seitlich. Dock: `navigationBars` plus `displayCutout`. Sheet-Inhalt: `safeDrawing`.

Solange `MapChrome` sichtbar ist, setzt ein `SideEffect` `isAppearanceLightStatusBars = false` (Scrim ist in beiden Themes dunkel). Onboarding und Login behalten das Verhalten aus `RoutyTheme` (`Theme.kt` Zeilen 49–53). Nach Sign-out setzt `RoutyTheme` den Wert wieder aus `darkTheme`.

Keine `statusBarColor`, kein `fitsSystemWindows`. Predictive Back läuft über den einen `BackHandler`.

---

## 9. Dateien

### 9.1 Web, neu

```
web/src/lib/mapMode.ts
web/src/lib/mapMode.test.ts
web/src/lib/mapAccent.ts
web/src/lib/mapAccent.test.ts
web/src/lib/atlasTypes.ts
web/src/lib/mapBootstrap.ts
web/src/lib/segmentLock.ts

web/src/components/map-shell/MapShell.tsx
web/src/components/map-shell/MapShellContext.tsx
web/src/components/map-shell/MapCanvas.tsx
web/src/components/map-shell/MapDock.tsx
web/src/components/map-shell/ProfileMenu.tsx
web/src/components/map-shell/BottomSheet.tsx      Telefon unten, ab 960px rechts
web/src/components/map-shell/PageBackBar.tsx
web/src/components/map-shell/AppChrome.tsx
web/src/components/map-shell/sheets/ExploreSheet.tsx
web/src/components/map-shell/sheets/PlanSheet.tsx
web/src/components/map-shell/sheets/GoSheet.tsx
web/src/components/map-shell/sheets/RecordSheet.tsx
```

### 9.2 Web, anfassen, Logik lassen

| Datei | Was sich ändert |
| --- | --- |
| `web/src/components/MapView.tsx` | `fill`, `fitPadding` als Viererkante, `zoomControlPosition`. Defaults = heutiges Bild |
| `web/src/components/MapViewLazy.tsx` | `fill` an den Placeholder (`loading` ist heute ein leeres `map-box`) |
| `web/src/components/RouteGenerator.tsx` | `hosted`, `section`, `onLayersChange`, `onPhaseChange`. Karten-JSX bei `hosted` weg. Free-Roam-`<details>` bei `hosted` ab J3 weg |
| `web/src/components/FreeRoamCard.tsx` | `hosted`, Overlay ohne Basisnetz |
| `web/src/components/RecordTrackWizard.tsx`, `DrawPathWizard.tsx`, `SegmentGeometryEditor.tsx` | dieselbe Prop |
| `web/src/components/SegmentPopup.tsx` | `isLocked` aus `segmentLock.ts` |
| `web/src/app/globals.css` | Tokens §6, Atlas-Klassen, z-index, Dark-Button-Schrift |
| `web/src/app/layout.tsx` | `viewportFit` |
| `web/src/app/(app)/layout.tsx` | `.app-frame`, `AppChrome` |
| `web/src/app/(app)/map/page.tsx` | Bootstrap, Slots, `mode` aus `searchParams` |
| `web/src/app/(app)/route/page.tsx` | ab J2 nur noch Redirect |
| `web/src/app/page.tsx` | Redirect-Ziel `/map` |
| `web/src/lib/i18n/de.json`, `en.json` | Objekt `shell` |
| `web/src/lib/navChrome.ts` + Test | Rückgabe bleibt; erweitern, nicht löschen |
| `web/src/app/(app)/stats/page.tsx`, `settings/page.tsx`, `settings/account/page.tsx`, `admin/**/page.tsx` | ab J5 `PageBackBar` und Token-Pass, Forms bleiben |

Unangetastet bis auf den Aufrufort: `GpxImportWizard.tsx`, `RouteCompletionDialog.tsx`, `EndpointFields.tsx`, `NamePartsInput.tsx`, `SegmentsTable.tsx`, `TrashPanel.tsx`, `map/actions.ts`, Settings-Forms.

### 9.3 Web, am Ende löschen (J7, nicht früher)

- `web/src/components/NavBar.tsx` und `.topnav`, sobald keine Seite sie nutzt
- `web/src/app/(app)/map/OverviewMapClient.tsx`, sobald Erkunden/Draw/Record/Edit in der Hülle laufen (ab J4 nicht mehr gemountet, gelöscht erst in J7)
- Karten-Zweig `route-map-pane` in `RouteGenerator`, wenn kein Aufrufer mehr `hosted={false}` braucht. Default von `hosted` bleibt `false`, solange ein Aufrufer das braucht
- CSS nur der alten Zweiteilung: `.route-shell.has-map`, `.map-overview-shell .map-box` Höhen. `.page-dense` für Stats/Settings/Admin behalten

### 9.4 Android, neu

```
android/app-kotlin/com/routy/app/shell/SheetBack.kt
android/app-kotlin/com/routy/app/shell/MapBinding.kt
android/app-kotlin/com/routy/app/shell/MapChrome.kt
android/app-kotlin/com/routy/app/shell/DockBar.kt
android/app-kotlin/com/routy/app/shell/MapFabColumn.kt
android/app-kotlin/com/routy/app/shell/ExploreSheet.kt
android/app-kotlin/com/routy/app/shell/PlanSheet.kt
android/app-kotlin/com/routy/app/shell/GoSheet.kt
android/app-kotlin/com/routy/app/shell/RecordSheet.kt
android/app-kotlin/com/routy/app/shell/ProfileMenuSheet.kt
android/app-kotlin/com/routy/app/shell/StatsSheet.kt
android/app-kotlin/com/routy/app/shell/SettingsSheet.kt
android/app-kotlin/com/routy/app/shell/LayersSheet.kt
android/app-kotlin/com/routy/app/shell/FloatingNotices.kt
android/app-kotlin/com/routy/app/route/LocationEffects.kt
android/app-kotlin/com/routy/app/recording/RecordingBinding.kt
android/app-kotlin/com/routy/app/map/MapPanels.kt
```

Test: `src/test/kotlin/com/routy/app/shell/SheetBackTest.kt` im Modul `:app`.

`MapPanels.kt` nimmt die bestehenden Funktionen aus `MapScreen.kt` auf, ohne sie neu zu erfinden: `MapNodePanel`, `MapSegmentPanel`, `MapDrawPanel`, `MapGpxPanel`, `MapEditShapePanel`, `MapSplitPanel`, `ProposalsPanel`, `LockProposalsPanel`, `TrashPanel`, `SegmentsTablePanel` (weiter 50 Zeilen plus Sort-Chips, `MapScreen.kt` um Zeile 813).

### 9.5 Android, anfassen

| Datei | Was sich ändert |
| --- | --- |
| `ui/theme/Color.kt` | Tokens §6. `RoutyGreen` bleibt `#2E6B49` |
| `ui/theme/Theme.kt` | in J2: Dark-`primary = #6FC08C`, `onPrimary = #0E2418`. `dynamicColor` bleibt false |
| `map/RoutyMapView.kt` | `contentPadding: PaddingValues = PaddingValues(0.dp)` → `setPadding`. `accentHex: String = "#2e6b49"` für Routenlinie, Default-Knoten, `updateSegments`-Zweig, `updateNodesLayer`-else, `updateStationsLayer`-else. Fit-Padding 64 → 24, sobald `setPadding` den Rest tut. Alle anderen Hex aus §6 bleiben |
| `webview/RoutyShellScreen.kt` | wird dünn. `TABS`, `NavigationBar`, versteckte WebView, Banner-Column weg |
| `webview/RoutyWebView.kt` | Callback `onDismissToMap` für `/map` und `/route` |
| `webview/AuthenticatedWebSheet.kt` | Höhe der Stufe statt 560dp |
| `MainActivity.kt` | in J4: `Routes.RECORDING` und der `composable`-Block weg. Deep-Link-Code bleibt |
| `route/RouteScreen.kt`, `map/MapScreen.kt`, `recording/RecordingScreen.kt` | in J1 zerschneiden, in J7 löschen, wenn nichts mehr ruft |
| `stats/StatsScreen.kt`, `settings/SettingsScreen.kt` | Körper wandert in die Sheets. `WalkPathThumbnail` bleibt |
| `recording/RecordingActiveBanner.kt` | ab J4 kein Aufrufer; die Pille liest die Phase |

Strings: `shell_mode_explore`, `shell_mode_plan`, `shell_mode_go`, `shell_mode_record`, `shell_profile`, `shell_destination_hint`, `shell_recording_pill`, `shell_layers`, `shell_edit_network`. In beiden Locales. Keine neuen hardcodierten deutschen Sätze.

---

## 10. Phasen

Gate jeder Phase, beide, bevor die Phase als fertig gilt:

```bash
# in web/
npx tsc --noEmit
npx vitest run
npm run dev          # Blick auf http://localhost:3000, Desktop ~1280px und Telefon ~390px
```

```bash
# in android/
./gradlew :app:compileDebugKotlin :logic:test
```

Android zusätzlich ab J0: `./gradlew :app:testDebugUnitTest --tests com.routy.app.shell.SheetBackTest`. Kein Diff unter `android/logic-kotlin`. Manuell ab der ersten sichtbaren Phase: de und en, hell und dunkel; Android ab J2 einmal Breite ≥ 600dp.

Alte Fähigkeit bleibt benutzbar, bis die Phase sie umhängt. Die Lücken unten sind die einzigen.

### J0 — Vertrag, nichts sieht anders aus

Web-Plan Phase 0. Android-Plan Phase 0.

Dateien:

- `globals.css`: Variablen aus §6 in allen Theme-Blöcken. Dark-`.btn-primary` Schrift `#0E2418`. Noch keine Layout-Umbauten.
- `MapView.tsx`, `MapViewLazy.tsx`: `fill` default false, `fitPadding` default `{ top: 24, right: 24, bottom: 24, left: 24 }`, Zoom default `topleft`.
- `mapMode.ts` + Test: `initialMode`, `requestModeChange`. Fälle: aktive Route → `go`; Query `plan` verliert gegen aktive Route; `record` mit `recordContinuesInBackground: false` → `stop-record`; mit `true` → allow; `from === to` allow; explore → plan bei `none` allow; freeRoam → plan → `stop-roam`.
- `mapAccent.ts` + Test.
- `Color.kt`: Konstanten anlegen. `Theme.kt` in dieser Phase **nicht** umstellen (Screens bleiben beim alten Dark-Primary, bis der Dock in J2 da ist).
- `SheetBack.kt` + `SheetBackTest`: alle 14 Regeln aus §7.3, plus Dock-Gleichwert (Moduswechsel ruft `requestModeChange`, nicht eine zweite Tabelle). Mindestens: Web-History vor Web-Schließen; Stats → Profil → Peek; Werkzeug räumt `MapMode`; aktive Route → Confirm, State unverändert; `RECORDING` über Peek → Peek; `RECORDING` auf Peek → `pass`; `CONFIRM` über Peek → Peek; `CONFIRM` auf Peek → `pass`.

Abnahme: `/route` und `/map` sehen aus wie vorher. Zoom oben links. Android-Screens unverändert, Dark-Primary noch `#4C8B67`. Parität: die Tabellen in §5 und §6 sind die einzigen neuen Wörter und Farben, noch nicht auf dem Schirm.

### J1 — Einbetten, Bild unverändert

Web: die Host-Props aus §4.5, Default so, dass jeder bestehende Aufrufer identisch rendert. `onLayersChange` wird im Default nicht gesetzt. Ein vitest ist hier nicht erzwungen; `tsc` muss grün sein.

Android-Plan Phase 1:

- Composables aus `RouteScreen` / `MapScreen` / `RecordingScreen` in die Dateien aus §9.4 schieben, **ohne** Layout-Änderung. 30dp-Buttons bleiben in dieser Phase.
- `LocationEffects.kt` und `RecordingBinding.kt` von den alten Screens aus aufgerufen, gleiches Verhalten. Service stoppt beim Tab-Wechsel nicht zusätzlich.
- `RoutyMapView.contentPadding` default 0. Kein Aufrufer setzt es.

Abnahme: Route, Karte, Aufnahme, Stats, Settings, Admin bedienen sich wie vorher. Aktive Route mit Track überlebt Tab-Wechsel und Aufnahme-Öffnen. Web `/route` und `/map` sehen aus wie vorher, eine Verhaltensänderung ist ein Fehler dieser Phase. Parität: keine neue Divergenz.

### J2 — Eine Karte, Dock, Erkunden und Planen

Web-Plan Phasen 1 und 2, in einer Phase, damit `/route` erst umbiegt, wenn Planen auf der neuen Karte liegt. Android-Plan Phase 2, aber Gehen bleibt inhaltlich im Plan-Sheet bis J3, Aufnahme bleibt die alte Destination bis J4.

Web-Dateien: `layout.tsx` (`viewportFit`), `(app)/layout.tsx`, `AppChrome`, `MapShell`, `MapCanvas`, `MapDock`, `ProfileMenu`, `BottomSheet` (**rechts**), `ExploreSheet`, `PlanSheet`, `mapBootstrap.ts`, `atlasTypes.ts`, `map/page.tsx`, `route/page.tsx` (Redirect `/map?mode=plan`), `page.tsx` (Redirect `/map`), `shell`-Schlüssel, CSS `.atlas-frame`, `.map-box-fill`, `.map-dock`, `.sheet`, `.map-fab`, `.map-dialog`.

Android-Dateien: `MapChrome`, `DockBar`, `ExploreSheet`, `PlanSheet`, `FloatingNotices`, `MapBinding`. `RoutyShellScreen` ohne `NavigationBar`. Avatar öffnet `StatsScreen` / `SettingsScreen` als volle Stufe (Feinschliff J5). Admin-Zeile öffnet `AuthenticatedWebSheet` auf `/admin`. Dauer-WebView weg. Dock-Chip Aufnahme ruft noch `onStartRecording` → `Routes.RECORDING`. `ChromeState` als `rememberSaveable` aus drei Strings. `Theme.kt` Dark-Primary `#6FC08C`. `RoutyMapView.accentHex` aus dem Theme. Tablet-Zweig ≥ 600dp, Karte rechts.

Verhalten:

- Kaltstart: volle Karte, Modus Erkunden, Peek, eine Karteninstanz.
- Erkunden: Knoten und Segmente, Popup (Web) bzw. Panel (Android), Admin darf Knoten verschieben (`POST /api/nodes/move`, Confirm über `REPOSITION_OFF_PATH_THRESHOLD_M` = 25 in `web/src/lib/geo.ts`).
- Planen: Preset, Generieren, Vorschau-Linie auf **dieser** Karte, kürzer / nochmal / länger / umdrehen, Annehmen, Favorit, aktive Route mit Folge, Complete öffnet den bestehenden Abschluss-Dialog, Discard zurück zum Formular.
- In dieser Phase liegt die aktive Route noch im Plan-Sheet (der heutige `mode === "active"`-Zweig). Chip Gehen ist auf **beiden** Seiten disabled (`shell.comingNext` nur als `title`, nicht als zweite Navigation). Freies Gehen bleibt der `<details>`-Block in `RouteGenerator` bzw. der bisherige Block im Plan-Sheet. Fähigkeit bleibt, Dock-Wort „Gehen“ noch nicht.
- Chip Aufnahme: Web disabled. Android öffnet die alte `RecordingScreen`. Diese eine Lücke ist erlaubt und in der Review-Notiz zu nennen.
- Zeichnen, GPX, Form, Segmentliste, Papierkorb: auf dem Web in dieser Phase disabled (wie Web-Plan Phase 1). Auf Android im Erkunden-Werkzeug schon über die verschobenen Panels erreichbar, weil sie sonst mit dem Wegfall von `MapScreen` verschwänden. Web holt sie in J4 nach. Review-Notiz: Werkzeuge bis J4 nur auf Android im neuen Chrome; Web-Aufnahme und Web-Werkzeuge fehlen bis J4 bewusst.
- Profil: Web-Links auf die **alten** Seiten mit `NavBar` (das ist bis J5 in Ordnung). Embedded: kein Profil.
- Impersonation: Streifen oben, Karte füllt den Rest.
- Chip-Wechsel auf dem Web lädt kein neues RSC-Dokument (Netzwerk-Tab: kein Document für `/map`). `pushState` für Sheet-Stufen ist schon an.
- Deep-Link Share → Planen, Annahme-Zeile sichtbar.
- `fitKey` legt die Route nicht dauerhaft unter das Half-Sheet bzw. unter das rechte Panel (`fitPadding`).
- Folge-`watchPosition` auf dem Web läuft, solange `section` nicht `hidden` ist. In J2 ist die aktive Route `section="plan"` und Follow darf laufen.

Abnahme-Parität: Dock-Wörter und Reihenfolge gleich. Akzent hell `#2E6B49`, dunkel `#6FC08C` auf Dock-Chip und Routenlinie. Home-Marker `#A5711C`. Panel rechts, 400px/400dp. Telefon-Dock unten, Desktop/Tablet-Dock oben.

### J3 — Gehen auf beiden Seiten

Web-Plan Phase 3, plus das Umhängen der aktiven Route, das der Web-Plan nicht vorsah und das hier W1 schließt.

- `GoSheet` auf beiden Seiten.
- `RouteGenerator`: `section="go"` rendert den Active-Zweig. `section="plan"` rendert nur `suggesting`. `onPhaseChange("active")` setzt den Dock auf Gehen und das Sheet auf half/Peek. `onPhaseChange("suggesting")` nach Discard setzt Planen.
- Free-Roam-`<details>` bei `hosted` nicht mehr rendern. `GoSheet` mountet `FreeRoamCard` mit `hosted`, wenn keine aktive Route läuft. Start-Button ist `route.freeRoamStart` („Freies Gehen“), nicht ein zweites Dock.
- Chip Gehen an, auf beiden Seiten.
- `initialMode`: aktive Route → Gehen. `/` ohne Route → Erkunden. `/route` und `/map?mode=plan` → Planen, außer eine aktive Route schlägt das Query.
- Follow-Watch läuft nur bei `section="go"`. Wechsel weg aus Gehen bei aktiver Route oder Free-Roam: Confirm §7.2. Abbrechen bleibt. Bestätigen stoppt Watch bzw. Service und zeigt das Ziel.
- Android: `SuggestingMapLayout`-Inhalt bleibt `PlanSheet`. Active-Hälfte von `RouteWithMapLayout` wird `GoSheet`. Free-Roam-Start nicht mehr doppelt in beiden Layouts.
- Keine neue ETA-Rechnung. Peek im Gehen zeigt, was die Daten schon hergeben: `lengthM` in km, `durationMin`, Höhengewinn, nächste Station (`stations[completedWaypointIndex + 1]`). Web zeigt dieselben Felder aus dem bestehenden Route-Resultat, keine neue API.
- `CompletionStatsDialog` / `RouteCompletionDialog` bleibt über der Karte. Nach Schließen: Erkunden + Peek.
- Retag, Reposition, Ziel-Ersetzen, Battery-Prompt, Sprache, Track an/aus, Nickname, Bildschirm an: bleiben die bestehenden Dialoge und Schalter, nur im Gehen-Sheet.

Abnahme: Annehmen wechselt den Chip auf Gehen, auf beiden Seiten. Freies Gehen aus Gehen, ohne Stationsliste der festen Route. Folge und Free-Roam nie gleichzeitig. Wegwechseln fragt. Watch bzw. Service endet erst nach Bestätigung (Aufnahme-Service ist hier noch nicht das Thema). Parität: Peek-Zeile benutzt km / Minuten / Anstieg / nächste Station, dieselben Wörter aus den bestehenden Schlüsseln.

### J4 — Aufnahme, Zeichnen, GPX, Form

Web-Plan Phase 4. Android-Plan Phase 3.

- `RecordSheet` auf beiden Seiten. Drei Phasen aus dem bestehenden Screen, ohne `TopAppBar` und ohne Nav-Push: IDLE (Start, eine Zeile Hintergrund-Hinweis, Battery-Prompt auf Android), RECORDING/PAUSED (Punkte, km, Pause, Stopp, Verwerfen nur in Pause), CONFIRM (Endpunkte, `NamePartsInput`, Speichern, Verwerfen).
- `requestStart()` mit Standort- und Notification-Permission auf Android wörtlich mitnehmen. Web bleibt bei `navigator.geolocation.watchPosition` wie in `RecordTrackWizard.tsx`.
- Android: `MainActivity` verliert `Routes.RECORDING`. Binding läuft in `MapChrome`. Pille, wenn Phase ≠ IDLE (CONFIRM zählt) und Modus ≠ RECORD. Tipp auf die Pille setzt RECORD + Peek. Moduswechsel stoppt den Service nicht. Zurück bei RECORDING/PAUSED/CONFIRM stoppt ihn nicht (§7.3 Regeln 13–14).
- Web: Verlassen des Modus Confirm, dann Unmount, Watch aus. Keine Pille.
- Speichern → bestehender Commit-Pfad, dann Erkunden. Kamera unverändert (`sessionStorage` bzw. die eine Map-Instanz).
- `ExploreSheet`: „Netz bearbeiten“ öffnet Zeichnen, GPX, Vorschläge (nur wenn die Liste nicht leer ist), Papierkorb, Segmentliste. Slots `segments` und `trash` aus `map/page.tsx`. Proposals-Fetch aus `OverviewMapClient` hierher verschieben, nicht neu gestalten.
- Edit-Shape aus `SegmentPopup.onEditShape` bzw. dem Android-Panel. Split bleibt im jeweiligen Editor.
- `GpxImportWizard` unverändert importieren, Mini-Karte erlaubt. GPX-Launcher (`GetContent`) bleibt am Android-Panel.
- Danach `OverviewMapClient` von `map/page.tsx` abhängen. Datei erst in J7 löschen.
- `RecordingActiveBanner` hat keinen Aufrufer mehr.

Abnahme: Start → Pause → Stopp → Endpunkte → Speichern, auf dem Web ohne zweite Leaflet-Weltkarte, auf Android ohne Nav-Stack-Wechsel. Zeichnen: Tap setzt Punkte, eine Weltkarte. GPX: zwei Container nur hier. Form speichern, Popups/Panels wieder da, Zoom gleich. Segmentliste löschen und Papierkorb: `router.refresh()` lässt den Modus Erkunden stehen. Android: Hintergrund während RECORDING, Zurückholen zeigt RECORD. Verwerfen nur per Button. Trackfarbe `#9A3B29` auf beiden. Parität: dieselben Phasenwörter (idle / läuft / Pause / sichern), aus den bestehenden `record_*`- und `route.*`-Texten.

### J5 — Profil, Stats, Settings, Seitenstandard

Web-Plan Phase 5. Android-Plan Phase 4, Farbwechsel ist schon in J2 passiert und wird hier nur noch geprüft.

Web:

- `AppChrome`: `NavBar` für alle Pfade außer `/map` weg, `PageBackBar` hin. `.container.page-dense` bleibt.
- Profilziele: `/stats`, `/settings`, `/settings/account`, `/admin` nur bei `role === "admin"`.
- Design-Pass auf diesen Seiten: Karten mit `--sheet-radius`, Schatten aus der `--float-shadow`-Familie, Primärbuttons `--accent`, eigenes `h1`, scrollbar. Forms (`LocaleSelectForm`, `ThemeSelectForm`, `MapPreferencesForm`, `WalkSpeedSaveForm`, Account-Panel) nicht neu bauen. Admin bleibt dichte Tabellen, bekommt aber die Leiste und die Tokens.
- Optional, klein: Ebenen-Popover auf der Karte, drei Radios plus Waymarked, schreibt `localStorage` `routy.mapPreferences` wie `MapPreferencesForm`. Wird es mehr als das, weglassen.

Android:

- `ProfileMenuSheet`, `StatsSheet`, `SettingsSheet` mit dem heutigen Inhalt (§ Android-Plan 3.9, hier verbindlich): Profil zeigt Name, Punkte, Zeilen Statistik, Einstellungen, Konto (`web` `/settings/account`), Admin (`web` `/admin`, nur admin), Abmelden.
- Stats: `StatsHeroCard`, eigene Zahlen, Netz-Nutzung, beide Leaderboards, Achievements mit `tierColor`, Touren mit `WalkPathThumbnail` und Löschen-Dialog. Offline, Fehler, Retry bleiben die ersten Einträge. `StatsViewModel.refresh` und `StatsInvalidation` bleiben.
- Settings-Reihenfolge: Konto (öffnet die Web-Stufe), Sprache, Kartenstil (`LayersSheet`), Theme, Gehgeschwindigkeit, Crash-Consent, Sessions, überall abmelden, Abmelden. `needsRecreate` → `activity.recreate()` bleibt. `ChromeState` ist `rememberSaveable`, man landet wieder auf der Settings-Stufe. `WalkSpeedField` behält die Dezimal-Tastatur und `imePadding`.
- `LayersSheet` am FAB und in den Einstellungen, dieselbe `MapPreferencesStore` / `rememberMapPreferences`.
- `AuthenticatedWebSheet` ohne feste 560dp.
- Primäraktion pro Stufe ein gefüllter Button ≥ 48dp. `CompactButton` nicht mitziehen.
- Top-Scrim und `isAppearanceLightStatusBars = false` nur unter `MapChrome`.

Abnahme:

- Web: von der Karte nach Stats, Settings, Konto, Admin. Jede Seite scrollbar, eigenes `h1`, Zurück auf `/map`. Kamera nach Rückkehr gleich. Theme-Wechsel kippt `data-theme`, Rückkehr zeigt Sheet-Farben und `mapAccentHex`. Sprache kippt die Dock-Labels. Logout im Profil. Embedded: dieselben gestalteten Seiten, `PageBackBar` schließt über `onDismissToMap` auf die native Karte, lädt `/map` nicht in die WebView. Admin-Unterseiten `/admin/activity`, `/admin/insights`, `/admin/[id]`, `/admin/track-geometry`: Leiste da, Text-Links zwischen den Admin-Seiten da.
- Android: Sprache → recreate → Settings-Stufe noch da. Theme hell/dunkel/auto. Dark-Dock und Routenlinie `#6FC08C`. Golden, Home-Braun, Aufnahme-Rot, Fehlerrot unverändert. IME schiebt das Sheet, keine graue Kartenlücke. System-Navigation verdeckt kein Dock-Label.
- Parität: Profil-Reihenfolge Statistik, Einstellungen, Konto, Admin, Abmelden. Dieselben Wörter aus §5.

### J6 — Track-Review und eingebettete Rückkehr

Web-Plan Phase 6, plus die WebView-Lücke aus Befund 15, falls J5 sie noch nicht geschlossen hat.

- `TrackGeometryReview` nicht in die Weltkarte. Profil und Erkunden (nur Admin) verlinken `/admin/track-geometry`. Die Seite hat `PageBackBar` und die bestehende eigene Karte.
- Review-Zustand nicht in `MapShellContext` heben.
- `RoutyWebView`: `/map` und `/route` → `onDismiss`. `/login` → `signOut`, wie heute.
- Android-Admin und Konto nur als Stufe `web`.

Abnahme: Admin öffnet Review, akzeptiert oder verwirft (oder sieht die leere Liste), zurück, Weltkarte eine Instanz. Kamera aus `sessionStorage` stimmt. Modus darf neu starten, weil die Atlas-Seite neu mountet. User ohne Admin sieht den Eintrag nicht. In der Android-Konto-Stufe führt „Zurück zur Karte“ auf die native Karte, nicht auf einen Web-Atlas. Parität: der Review bleibt ein Admin-Werkzeug auf beiden Seiten über dieselbe URL.

### J7 — Aufräumen

- Löschen, wenn unreferenziert: `NavBar.tsx`, `OverviewMapClient.tsx`, `RouteScreen.kt`, `MapScreen.kt`, `RecordingScreen.kt` als Fassaden, `StatsScreen`/`SettingsScreen` nur wenn der Körper wirklich woanders lebt, `RecordingActiveBanner` wenn tot, `.topnav`, `.route-shell.has-map`, Overview-Höhen. `.page-dense` behalten, wo Stats/Admin sie nutzen.
- `RoutyShellScreen`-Kommentar („fünf Tabs“) auf Modus-Hülle umschreiben.
- `navChrome.test.ts` zur finalen Funktion.
- Tote i18n-Schlüssel nicht aus Prinzip löschen.
- Macht ein Löschen das Gate rot, bleibt das Symbol und der Grund in der Review-Notiz. Nicht mit einem Stub „reparieren“, der das alte Layout zurückholt.

Abschluss, beide Plattformen:

- Gates grün, `android/logic-kotlin` ohne Diff.
- Vier Modi, eine Karte, Popups bzw. Panels, Generieren, eine echte Runde nur mit GPS — sonst der bestehende Fehlertext, kein neuer.
- `/stats`, `/settings`, `/admin` ohne Fünf-Link-Leiste, mit Rückweg und Routy-Tokens.
- `/route` → `/map?mode=plan`, und bei aktiver Route landet man auf Gehen.
- Eingeloggt `/` → `/map`. Ausgeloggt `/` → `/login`. Login-Layout ohne Dock. Share-Seite unverändert.
- Embedded: kein Profil auf dem Atlas. Android: keine Route `recording` im NavHost. Hardware-Zurück auf Peek bei laufender Aufnahme beendet die Activity nicht über einen geschluckten Handler und stoppt den Service nicht.
- de und en, hell und dunkel, Telefon und Breite ≥ 960px / ≥ 600dp.

---

## 11. Risiken und Abkürzungen

| Risiko | Umgang |
| --- | --- |
| Zweites `MapContainer` („already initialized“) | Ein Schreiber, `hosted`, DOM-Zähler ab J2 |
| Flex-Kind ohne `min-height: 0` oder `100vh` schneidet die Karte ab | §8.2. Nach Impersonation noch einmal schauen |
| `invalidateSize` vergessen | Effekt auf `--sheet-cover` und `ResizeObserver` |
| `router.replace` für den Modus lädt SQLite neu | Nur `pushState`. `router.refresh()` ohne `key` |
| `initialMode`-Prop nach Refresh setzt den Modus zurück | `useState`-Initializer, kein Sync-Effekt |
| `RouteGenerator` wird beim Umbau neu geschrieben | Nur Karten-JSX, `section`-Zweige um bestehende Blöcke, Free-Roam-`<details>` ab J3. Fetches nicht anfassen |
| GPS-Watch oder Service an einer kurzen Composition | Web: Unmount nach Confirm. Android: Effekte in `MapChrome`. `onDispose` unbindet nur |
| CONFIRM verliert die Strecke, weil `recordingActive` false ist | Phase der Bindung lesen |
| Zurück stoppt die Tour aus Versehen | §7.3. Confirm-Dialoge sind die bestehenden, nicht `popBackStack` |
| `rememberSaveable` einer sealed class | drei Strings, `listSaver` |
| Sheet verdeckt Attribution oder Logo | `--sheet-cover` / `setPadding`, nie `display:none` auf der Attribution |
| Fit-Padding 64 plus Sheet-Padding | 64 auf 24, Sheet nur über `setPadding` / `fitPadding` |
| `var(--accent)` an Leaflet-`Polyline` | Hex aus `mapAccentHex`. Android `accentHex` |
| Client importiert `db` | Keine neuen Wert-Imports aus `nodes.ts` / `segments.ts` in Client-Dateien |
| WebView-History gegen Compose-Back | ein Handler, Regel 1 |
| `/map` in der Konto-WebView | `onDismissToMap` |
| Zwei Netz-Ladungen auf Android | bestehender `BootstrapLoader`-Cache. Kein dritter Loader, kein `MapSessionViewModel` |
| Kamera springt beim Dock-Tipp | `fitKey` ohne Modus |
| Prozess-Tod mitten in der Route | `RouteProgressStore` stellt das ViewModel her; Versöhnung zeigt Gehen |
| de/en | jeder neue Schlüssel in beiden Dateien / beiden `values` |
| J2 ist der große UX-Sprung | keine Datei-Löschung und kein Entfernen der Aufnahme-Route in J2 |
| Werkzeug-Lücke auf dem Web in J2–J3 | bewusst, in der Review-Notiz. Android behält die Panels, damit `MapScreen` weg kann |
| Dog/Cat auf OSM-Kacheln | Chrome folgt dem Theme, Kacheln nicht |
| Kontrast und Schatten | eigener Block, Fokusring 3px |
| Serverseitige Actions in `TrashPanel` | Slot aus `map/page.tsx` |
| Weiß auf `#6FC08C` | Dark-Button-Schrift `#0E2418` in J0 |
| Home-Marker folgt `--waymark` im Dark | nicht tun, Hex `#A5711C` |
| Falsche Icon-Zuordnung aus dem Android-Plan | §5, nicht §3.3 des Android-Plans |
| Linkes Panel aus Mockup-Überschrift oder Android-Plan | rechts |

Abkürzungen, die gelten:

- Kein Adress-Suchfeld, kein Geocoder, kein Turn-by-Turn, kein Clustering, kein Street View, kein zweites Karten-SDK, keine Animationsbibliothek, kein Zustand-Store, kein Marker-Clustering, keine Casing-Linien, kein eigener Tile-Server.
- Popups (Web) und Panels (Android) bleiben, was sie sind.
- Generieren, Punkte, Golden, Favoriten, Nickname, Guide, Voice bleiben die vorhandene Logik.
- Track-Review bleibt eine Admin-Seite mit eigener Karte.
- CSS-Transition auf dem Web, die vorhandenen Compose-Animationen auf Android. Keine Seite-rutscht-weg-Animation zwischen Modi.
- `sessionStorage` für die Web-Kamera. Die Android-Schublade bekommt keine neue Persistenz; Route liegt in `RouteProgressStore`, Aufnahme im Service plus `RecordingSnapshotStore`.
- Ebenen auf dem Web bleiben in den Einstellungen, das Popover ist optional.
- Spiel-Themes bleiben ein Web-Picker.

---

## 12. Abnahme, gesammelt

1. Login (Android) und `/map` (Web) sind eine Karte bis an die Ränder. Dock: Erkunden, Planen, Gehen, Aufnahme. Telefon unten, große Fläche oben. Panel rechts, 400px/400dp.
2. Erkunden: Tipp öffnet Popup (Web) oder Aktions-Stufe (Android). „Netz bearbeiten“ enthält Zeichnen, GPX, Vorschläge, Papierkorb, Segmentliste. Split bleibt im Editor.
3. Planen: Ziel aus eigenen Knoten, Länge, Erzeugen, Kürzer/Länger/Umdrehen, Annehmen. Linie `#2E6B49` / Dark `#6FC08C`.
4. Annehmen wechselt nach Gehen. Peek zeigt km, Minuten, Anstieg, nächste Station. Folge, Sprache, Track über die bestehende Logik. Zurück fragt. GPS stoppt erst nach Bestätigung.
5. Freies Gehen startet aus Gehen, ohne Stationsliste der festen Route, Start-Marker `#A5711C`.
6. Aufnahme startet, pausiert, sichert Endpunkte auf derselben Karte. Android: keine Destination `recording`, Pille holt zurück, Zurück stoppt den Service nicht. Web: Verlassen fragt und stoppt den Watch.
7. Profil → Statistik und Einstellungen (Web: Seite mit `h1` und Zurück; Android: Stufe mit dem heutigen Inhalt). Konto und Admin als Web-Seite bzw. Web-Stufe. Kein roher WebView-Look.
8. Tablet und Desktop: Seitenkarte rechts, eine Karte daneben bzw. darunter, Dock oben.
9. Gates grün, `android/logic-kotlin` unverändert, Login und Share unverändert.
10. Parität gegen §5 und §6: wer die eine Oberfläche bedienen kann, findet auf der anderen dieselben Wörter, Farben und Modi.
