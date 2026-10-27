# Routy Android: Layout-Umbau auf Google-Maps-artige UX (Jetpack Compose)

**Status:** Verbindlicher Plan (Entscheidungen Emil, 2026-10-27). Noch **keine Implementierung** — startet nach Freigabe, phasenweise reviewbar.
**Basis:** Synthese zweier Cursor-Pläne (Grok 4.7 Extra High = Architektur-Hauptquelle; Composer 2.5 = Beiträge wie `MapShellCoordinator`), verifiziert gegen den Ist-Code.
**Web-Pendant:** `docs/REDESIGN.md` — beide Pläne teilen Designsprache (**Parität**, s. §0 unten).

Ziel: Die native App navigiert und fühlt sich an wie Google Maps — nach dem Login ist der Screen eine Karte, alles andere liegt als Einblendung darüber. Nicht mehr „routy-Desktop-Usability" (feste Tab-Seiten, dichte Mini-Buttons), sondern **eine Karte, vier Modi, Sheets**.

Prüfen nach jeder Phase:

```bash
./gradlew :app:compileDebugKotlin :logic:test
```

`src/logic-kotlin` bleibt **byte-identisch** unverändert (`:logic:test` = Regressionsnetz). ViewModels und Foreground-Services bleiben Quelle der Wahrheit, werden nur anders eingebettet. Manuelle Abnahme auf Phone und ab Phase 2 einmal Tablet-Breite; Sprache de + en; Theme hell + dunkel.

**Anfassen:** `src/app-kotlin` (Navigation, Compose-Chrome, Theme).
**Nicht anfassen:** `src/logic-kotlin`, Services, Worker, Widget, Onboarding, Login.

---

## 0. Parität Web ↔ App (verbindliches Querschnitts-Prinzip, Decision 2026-10-27)

„Wer sich in der App auskennt, soll sich auch im Web auskennen und umgekehrt." Gleiche **Symbole, Farben, Bezeichnungen, Feature-Set** — Menüs dürfen leicht anders angeordnet sein (Web: Desktop-Panel rechts; App: native Navigation), aber die **Designsprache ist dieselbe**. Kein Lernaufwand beim Wechsel zwischen Web und App.

- **Farben — eine Quelle der Wahrheit**, wertegleich in `ui/theme/Color.kt` und Web-`globals.css`/`mapAccentHex`:
  - Akzent/Routenlinie `#2E6B49`, Dark `#6FC08C` (nicht das bisherige `#4C8B67`)
  - Waymark/Home `#A5711C` (brauner Start-/Home-Marker, wie heute und wie Web)
  - Golden `#C99A2E` · Disconnected `#C53030` · Recording-Track `#9A3B29` (Hell) / `#E08669` (Dunkel, falls nötig) — unverändert fachlich
  - Contrast-Akzent `#005A2B`; Dog `#C9791F`; Cat `#A855C9` — bereit für Web-Parität (die Spiel-Themes existieren in der App noch nicht als Farbauftrag; Tokens anlegen, keine Kartenlage neu einfärben)
- **Symbole:** gleiche Material-Glyphen für identische Aktionen (Erkunden 🗺 / Map, Planen 🚶, Gehen 🧭, Aufnahme ⏺, Profil 👤, Zurück, Kürzer/Länger/Reverse, Teilen, Favorit) — Web nutzt das Material-Pendant zu denselben Icons.
- **Bezeichnungen/i18n:** gleiche Begriffe pro Sprache (de/en) aus **einer** Termliste. App-Strings `shell_mode_explore/plan/go/record` etc. (s. §3.12) und Web-`shell.*`-Schlüssel aus demselben Vokabular — nicht „Erkunden" hier und „Entdecken" dort.
- **Feature-Set/Abläufe:** gleiche Modi (Erkunden · Planen · Gehen · Aufnahme), Marker-/Linienfarben identisch, „geht nicht gleichzeitig"-Regeln (Follow aktiver Route vs. Free-Roam vs. Aufnahme) identisch kommuniziert.
- **Abnahme-Kriterium:** jede Phase endet mit einem **Paritäts-Blick** — geänderte UI-Elemente gegen die Web-Seite abgeglichen (ikon-, farb-, begriffsgleich). Diskrepanzen sind Review-Befund, werden vor Phase-Abschluss behoben.

---

## 1. Ist-Analyse (kompakt, verbindlich)

### 1.1 Navigations-Graph heute

`MainActivity.kt` (`enableEdgeToEdge`, `RoutyTheme`), `RoutyNavHost`:

```
MainActivity
└── RoutyNavHost
    ├── onboarding → OnboardingScreen   (kein serverUrl)
    ├── login      → LoginScreen        (kein token)
    ├── shell      → RoutyShellScreen   (Start nach gültigem Token)
    └── recording  → RecordingScreen    (eigener Destination-Push)
```

`onStartRecording` macht `navigate("recording")`, Zurück ist `popBackStack()`. Deep Links (`routy://share/…`, `https://…/share/{token}`) → `DeepLinkHolder` → `RouteViewModel`. Daran ändert sich nichts.

### 1.2 Shell heute (`webview/RoutyShellScreen.kt`)

Material3-`Scaffold` mit fester `NavigationBar` (5 Tabs):

| Index | Pfad | UI | Datei |
|------:|------|----|-------|
| 0 | route | nativ, opake `Surface` | `route/RouteScreen.kt` |
| 1 | map | nativ, opake `Surface` | `map/MapScreen.kt` |
| 2 | stats | nativ, `LazyColumn` | `stats/StatsScreen.kt` |
| 3 | settings | nativ, `LazyColumn` | `settings/SettingsScreen.kt` |
| 4 | admin | `RoutyWebView`, nur `role == "admin"` | `webview/RoutyWebView.kt` |

`selectedTab` = `remember { mutableIntStateOf(0) }` — nach Rotation/Recreate (Sprache/Theme) steht der Nutzer wieder auf Route. Über dem Inhalt stapeln sich `UpdateBanner`, `PendingUploadBanner`, `RecordingActiveBanner`. Die Karte bekommt nur die Resthöhe. Die Admin-WebView wird immer erzeugt und per `zIndex` versteckt gehalten.

```
Mobil, Ist (Phone)

┌──────────────────────────────┐
│ Statusbar (Scaffold-Inset)   │
├──────────────────────────────┤
│ Update-Banner · Upload · „Aufnahme läuft“
├──────────────────────────────┤
│   Tab-Fläche, opaker Grund   │
│   Route | Karte | Stats |    │
│   Settings | (Admin-WebView) │
├──────────────────────────────┤
│ Gehen  Karte  Stats  Ein…    │  NavigationBar frisst Höhe
└──────────────────────────────┘
```

### 1.3 Wo das „routy-Desktop-Denken" sitzt

- **Feste Seiten statt Modi.** Route, Karte, Stats, Settings sind vier Vollflächen; die Karte ist ein Tab unter anderen. Google Maps hat eine Karte und betritt Modi.
- **Karte wird zusammengedrückt.** `RouteScreen` (`RouteMapChrome` + `RouteBottomDock`, `DockLevel COLLAPSED/EXPANDED`) gibt der Karte nie den vollen Screen. `MapScreen` legt Panels als `Column` unten an — näher am Ziel, aber unter Bannern + `NavigationBar`.
- **Zwei Karten.** `RouteMapChrome`, `MapScreen` und `RecordingScreen` erzeugen je ein `RoutyMapView`; Tab-Wechsel zerstört die Kamera.
- **Dichte Aktionen.** `RouteScreen.CompactButton` (28–30 dp, `labelSmall`, FlowRow kürzer/nochmal/länger/umdrehen/annehmen/abbrechen + Checkboxen); `MapScreen` hat eine Dauerleiste „Zeichnen · GPX · Aufnahme" + Burger-Menü (Proposals, Segment-Tabelle, Papierkorb).
- **Freies Gehen versteckt und doppelt.** `freeRoamActive` wird in `SuggestingMapLayout` und `RouteWithMapLayout` je gezeichnet; der Start sitzt im aufgeklappten Dock unter Favoriten.
- **Aufnahme verlässt die Karte.** `RecordingScreen` idle = `Scaffold` + `TopAppBar` + Erklärung + Button (obwohl Aktiv/Confirm schon kartenfüllend sind).
- **Stats/Settings = Listen-Screens.** `LazyColumn` aus `Card`s auf Vollflächen-Hintergrund; Chrome ist eine Seite mit Titel, kein Maps-Sheet.
- **Theme ohne Chrome-Tokens.** `Color.kt` hat `RoutyGreen #2E6B49`, `RoutyGreenLight #4C8B67`, `RoutyGreenDark #1D4A32`, Flächen `#FAFAF7`/`#11140F`; Dark-`primary` ist `#4C8B67` (Web nutzt `#6FC08C`). Keine Tokens für schwebende Karte, Scrim, Sheet. `RoutyMapView` malt Linien fest `"#2e6b49"`, unabhängig vom Theme.
- **WebView als mitlaufende zweite App.** Dauerhaft gemounteter Admin-Tab erzeugt zwei Gesten-Welten (Web-History vs. Compose-Back).

### 1.4 Was bleibt (richtige Logik, nur anders eingebettet)

| Baustein | Bleibt zuständig für |
|----------|----------------------|
| `RouteViewModel` + `RouteUiState` | Planung, Vorschlag, `SUGGESTING/ACTIVE`, Guide, Free-Roam, Sprache, Track, Kompass, Share-Deep-Link, Abschluss |
| `MapViewModel` + `MapUiState` + `MapMode` | Netzwerk laden, Tippen, Zeichnen, GPX-Import, Form, Split, Restriktionen, Proposals, Papierkorb |
| `RecordingViewModel` | nur Confirm (Endpunkte, GPX-Commit); Live-GPS im Service |
| `RecordingForegroundService` | Phase `IDLE/RECORDING/PAUSED/CONFIRM`, Notification, `recordingActive` |
| `RouteTrackingForegroundService` | Track + Sprache im Hintergrund, `needsForegroundService` |
| `SettingsViewModel`, `StatsViewModel`, `ShellViewModel` | Profil, Sessions, Bootstrap, Sign-out |
| `CookieBridge` | `routy_session` für Web-Seiten |
| `AccountTheme`, `AccountLocale` | auto/light/dark, de/en, Recreate |
| `rememberMapPreferences` / `MapPreferencesStore` | BaseMapStyle (STREETS/HIKING/SATELLITE) + Waymarked |
| `RoutyMapView` | Einziger Renderer (MapLibre) — kein zweites Karten-SDK |
| Onboarding, Login, Captcha, Widget | unverändert |

Enthält `RouteScreen` die Gesten/Dialoge, die der Umbau nur verschiebt: Discard bei Zurück (`route_back_active_confirm`), Track-Stopp, Ziel-Ersetzen, Retag (`NamePartsInput`), Reposition, `CompletionStatsDialog`, Permissions (Standort/Notifications/Battery).

---

## 2. Ziel-Architektur

### 2.1 Eine Karte, vier Modi

`RoutyNavHost` behält `onboarding`/`login`/`shell`; `recording` fällt weg (Phase 3). Die Shell komponiert **ein** `RoutyMapView`.

```
shell
└── MapChrome                          neu, shell/MapChrome.kt
    ├── RoutyMapView                   eine Instanz, volle Window-Größe
    ├── Top-Scrim + FloatingNotices    schwebend, karte nicht wegschieben
    ├── MapFabColumn                   Kompass, Standort, Ebenen
    ├── DockBar                        Erkunden · Planen · Gehen · Aufnahme
    ├── Avatar                         öffnet Profil-Stufe
    └── Sheet                          eine Stufe (s. 2.3)
```

Modus ist UI-Zustand, kein Nav-Ziel: `enum class ShellMode { EXPLORE, PLAN, GO, RECORD }`.

| Modus | Dock-Label | Karte zeigt | Schublade |
|-------|------------|-------------|-----------|
| `EXPLORE` | Erkunden | Netz aus `MapViewModel` (Knoten, Segmente, Golden, Auswahl) | Peek: Treffer/Hinweis; Halb: Knoten-/Segment-Aktionen; Bearbeitung als eigene Stufe |
| `PLAN` | Planen | Planung aus `RouteViewModel` (Start, Ziel, Must-Visit, Required/Excluded, Vorschau) | Zielzeile, Länge, Erzeugen, Optionen |
| `GO` | Gehen | aktive/vorgeschlagene Route, Free-Roam-Start, eigener Standort | ETA-Zeile, dann Führung |
| `RECORD` | Aufnahme | Track `#9A3B29`, Knoten aus `RecordingViewModel`, Standort vom Service | Start / Pause/Stopp / Endpunkte |

Welches ViewModel die Karte füttert, entscheidet eine reine Funktion (Composer-Beitrag: **MapShellCoordinator**-Gedanke, konkret als `mapBinding`):

```
fun mapBinding(mode, route: RouteUiState, map: MapUiState, rec: RecordingUiState, service: RecordingServiceState): MapBinding
```

Priorität oben → unten:
1. `RECORD` und Service-Phase `RECORDING/PAUSED/CONFIRM` — Track, `routeColor "#9A3B29"`, `myLocation = service.currentPosition`, Klicks leer.
2. `GO` oder (`PLAN` und `route.route != null`) — Argumente wie `RouteMapChrome` heute (`displayRouteGeometry`, Stationen, `followEnabled`, Kompass; Badges nur Planen).
3. Sonst `EXPLORE`/`PLAN` ohne Route — Argumente wie `MapScreen` (`emphasizeNetworkSegments = true`, `overlayLine`, Edit-Vertices, `onMapClick = MapViewModel::onMapClick`).

`fitKey` wechselt nur bei inhaltlicher Änderung (Routen-Token, erste Netzladung, Aufnahmepunktzahl), **nicht** beim Dock-Tipp — sonst Kameraspring. `RoutyMapView` bekommt `contentPadding` (Default `PaddingValues(0.dp)`) → `MapLibreMap.setPadding`, damit Fit/Logo die Schublade und das Dock aussparen.

### 2.2 Nativ vs. WebView (Empfehlung, kohärent)

Die kohärente UX ist die **native Karte**. Die Web-App im WebView würde eine zweite Chrome-Schicht, einen zweiten Zurück-Stack und kein gemeinsames GPS erzeugen.

| Aufgabe | Wo |
|---------|-----|
| Karte, Modi, Route, Free-Roam, Aufnahme, Stats, Settings, Ebenen, Sessions, Logout | **Nativ**, bestehende ViewModels |
| Konto & Sicherheit (`/settings/account`) | `AuthenticatedWebSheet` (wie heute) |
| Admin (`/admin`) | dieselbe Sheet-Komponente, nur `role == "admin"` |
| Login, Captcha, Onboarding | native Screens, unverändert |
| Session-Cookie | `CookieBridge.installSessionCookie`, einmal in der Shell + erneut im Sheet |

Der dauerhaft gemountete, unsichtbare Admin-`WebView` entfällt. Eine WebView entsteht nur, solange die Stufe `SheetStage.Web` offen ist, und wird beim Schließen verworfen (`DisposableEffect`-State-Bundle). `RoutyWebView` (Host-Sperre, Login-Redirect → `signOut`) bleibt die Implementierung. `AuthenticatedWebSheet` gibt die feste 560-dp-Höhe auf und füllt die Schublade (`fillMaxHeight(0.92f)` Phone, Seitenkarte Tablet).

### 2.3 Schubladen-Stufen und Zurück

Eine Stufe, kein Nav-Graph pro Sheet. Zustand als `rememberSaveable` in `MapChrome` (Recreate aus `needsRecreate` verwirft sonst den `remember`-State — heute der Grund, warum der Tab auf Route zurückfällt).

```
sealed interface SheetStage {
    Hidden, Peek, Half, Expanded, Profile, Stats, Settings
    Web(path: String)          // "/admin" | "/settings/account"
    EditMenu                    // nur EXPLORE
    Node, Segment               // Auswahl steht im jeweiligen ViewModel
}
```

Phone: `ModalBottomSheet` mit drei Rasten (Peek ≈ 96 dp über Dock, Half ≈ 46 %, Expanded ≈ 92 %). Während `GO`-aktiv/laufender Aufnahme ist das Dock verdeckt; die Peek-Zeile (ETA/Aufnahme-Karte) sitzt auf der Gestenleiste.

Tablet (Breite ≥ 600 dp, `BoxWithConstraints`): dieselbe Stufe als **Seitenkarte** (400 dp, Safe-Area oben/unten), Karte daneben. Keine neue Navigation-Dependency, kein zweites Muster.

```
Mobil, Ziel (Erkunden, Peek)          Mobil, Ziel (Gehen, Route aktiv)

┌────────────────────────────┐       ┌────────────────────────────┐
│▓▓ Status-Scrim (hell)  ▓▓▓ │       │▓▓                      ▓▓▓ │
│ (Avatar)      (Kompass)    │       │               (Kompass)    │
│                (Standort)  │       │               (Standort)   │
│                (Ebenen)    │       │                            │
│                            │       │   Route #2E6B49/#6FC08C    │
│      RoutyMapView          │       │   Standort-Puck, Follow    │
│      volle Fläche          │       │                            │
│ ┌────────────────────────┐ │       │ ┌────────────────────────┐ │
│ │ Peek: Name / Hinweis   │ │       │ │ 4,2 km 58 min ↗120 m  │ │
│ └────────────────────────┘ │       │ │ Nächster: Waldrand     │ │
│ ┌─────┬─────┬─────┬─────┐  │       │ │ ▾ (expand bei Tipp)    │ │
│ │Erk. │Plan │Geh. │Aufn │ Av│       │ └────────────────────────┘ │
│ └─────┴─────┴─────┴─────┘  │       └────────────────────────────┘
└────────────────────────────┘        Dock ausgeblendet; Zurück fragt
```

**Zurück** ist eine reine Funktion `shell/SheetBack.kt` (kein Android-Import) → Phase 0 JVM-testbar. `MapChrome` setzt das Ergebnis um und ruft daneben die bestehenden Dialoge:

```
fun onHardwareBack(state, webCanGoBack, routeActive, freeRoamActive,
                   recordingPhase, mapMode): BackResult
```

`BackResult`: `WebHistory | Apply(stage) | ClearMapMode(+MapMode.View) | ConfirmLeaveRoute | ConfirmStopFreeRoam | Stay`.

Reihenfolge exakt:
1. `Web` + `webCanGoBack` → `WebHistory` (goBack).
2. `Web` → `Apply(Profile)`.   3. `Stats|Settings` → `Apply(Profile)`.
4. `Profile` → `Apply(Peek, Modus bleibt)`.
5. `mapMode != View` → `ClearMapMode`, Stufe `EditMenu`, Modus `EXPLORE`.
6. `Node|Segment` → `Half`.   7. `Expanded→Half`, `Half→Peek`, `EditMenu→Peek`.
8. `Peek` + `PLAN`, Route nicht ACTIVE → `EXPLORE/Hidden`.
9. `Peek` + `GO`, kein routeActive/freeRoamActive → `EXPLORE/Hidden`.
10. `routeActive` → `ConfirmLeaveRoute`; erst Bestätigung: Service-Stopp + `discardActive`, dann `EXPLORE/Hidden`.
11. `freeRoamActive` → `ConfirmStopFreeRoam` (`cancelFreeRoam`).
12. `RECORD` + `RECORDING|PAUSED` → Stufe auf `Peek` reduzieren, sonst `Stay`. **Zurück stoppt GPS nicht.**
13. `RECORD` + `CONFIRM` → `Stay` (Verwerfen nur expliziter Button `record_discard`).
14. `RECORD` + `IDLE` → `EXPLORE/Hidden`.   15. sonst `Stay`.

Dock-Tipp auf anderen Modus nutzt dieselbe Funktion (Zielmodus als `Apply`); aktiv-route/free-roam → dieselbe Bestätigung; `RECORDING/PAUSED/CONFIRM` → Moduswechsel **ohne** Service-Stopp + Pille. Das erhält die heutige Garantie: Service überlebt, auch wenn die UI woanders ist.

### 2.4 Zustand: wer wo lebt

```
RoutyShellScreen
├── ShellViewModel        Session, user.role, signOut, CookieBridge
├── RouteViewModel        sofort erzeugt
├── MapViewModel          sofort erzeugt
├── RecordingViewModel    erzeugt, sobald Modus RECORD oder Service ≠ IDLE
├── SettingsViewModel     erzeugt, sobald Stufe Settings oder Profile
├── StatsViewModel        erzeugt, sobald Stufe Stats oder Profile-Teaser
└── ChromeState           rememberSaveable (Modus + Stufe; Web.path als String)
```

`viewModel()` bleibt am `NavBackStackEntry` der Shell; Moduswechsel disposed **nichts**. `RouteViewModel` und `MapViewModel` laden über `BootstrapLoader` (gemeinsamer Cache, `Fresh/NotModified/CachedOnly`) — kein dritter Loader, kein „MapSessionViewModel".

Versöhnung nach Prozess-Tod/`recreate()` — `LaunchedEffect` in `MapChrome`, hebt nur von `Hidden` an (bewusster Wechsel wird nicht zurückgerissen):
- `mode == ACTIVE` oder `freeRoamActive` → `GO`/`Peek`.
- Service-Phase `RECORDING|PAUSED|CONFIRM` → `RECORD`/`Peek`.
- `pendingShareToken != null` → `PLAN`/`Half` (Annahme-Zeile sichtbar).

Standort: `ActiveRouteLocationEffect`, `ActiveRouteTrackingServiceEffect`, `ActiveTrackingEffects` wandern unverändert aus `RouteScreen` nach `route/LocationEffects.kt` und laufen in `MapChrome` unter den bestehenden Bedingungen. `MapViewModel` bekommt **keine** eigene Location-Pipeline; der Erkunden-Puck ist `RouteUiState.myLocation` nach FAB (dieselbe `requestLocationUpdatesIfPermitted`-Funktion, 5 s, `PRIORITY_HIGH_ACCURACY`; endet, sobald der Tracking-Service übernimmt — kein zweiter gleichzeitiger Request).

Aufnahme-Binding: das `ServiceConnection`-Muster aus `RecordingScreen` (bind → `state.collect` → bei CONFIRM Punkte an VM → bei saved `stopAfterCommitOrDiscard`+`reset`) zieht nach `recording/RecordingBinding.kt` und läuft in `MapChrome`, solange die Shell lebt — Confirm überlebt Moduswechsel. `recordingActive` bleibt `RECORDING || PAUSED` (Notifications); die UI liest für die Pille die gebundene `RecordingServiceState.phase` (CONFIRM zählt mit).

### 2.5 Hinweise über der Karte (FloatingNotices)

Banner verlassen die `Column`; die Karte wird nicht mehr nach unten geschoben.

| Hinweis | Quelle | Darstellung |
|---------|--------|-------------|
| Update | `UpdateBanner` | schwebende Karte oben, unter Status-Inset, dismiss wie heute |
| Upload-Queue | `PendingUploadBanner` | dieselbe Ecke darunter, nur wenn `pendingCount/failedCount > 0` |
| Offline | `OfflineBanner` | kompakter Chip, gleiche Ecke |
| Aufnahme läuft woanders | Phase ≠ IDLE und Modus ≠ RECORD | Pille über Dock; Tipp → `RECORD` |
| Route läuft woanders | `ACTIVE`/`freeRoamActive` und Modus ≠ GO | Pille „Route läuft"; Tipp → `GO` |
| Snackbar GPX | `GpxUploadNotifier` in der Shell | `SnackbarHost` oben über Scrim |

Gleichzeitig max. Update + Upload + eine Pille; Offline ersetzt den Upload-Chip nicht, steht darunter.

### 2.6 Was diese App bewusst NICHT bekommt

- Kein Places-/Geocoder-Feld: „Ziel" filtert `RouteUiState.nodes` nach Name (`Collator`, schon in `MapScreen`); Treffer ruft `setNodeAsEnd` bzw. bei leerem Ziel `onPlanningMapClick`.
- Kein Zusammenlegen von `MapViewModel` und `RouteViewModel`.
- Kein XML, kein zweites Map-SDK, keine neue Gradle-Dependency für Adaptive Navigation.
- Keine neue Persistenz für die Schublade (laufende Route = `RouteProgressStore`, Aufnahme = Service + `RecordingSnapshotStore`).

---

## 3. Komponenten-Plan

Neue Dateien unter `src/app-kotlin/com/routy/app/shell/`, plus Extraktionen `route/LocationEffects.kt`, `recording/RecordingBinding.kt`. Bestehende Dateien werden **zerlegt, nicht neu erfunden**.

### 3.1 `shell/SheetBack.kt`
Reine Typen `ShellMode`, `SheetStage`, `ChromeState`, `BackResult`, `onHardwareBack` (§2.3). Kein Compose.

### 3.2 `shell/MapChrome.kt`
Ersetzt den Körper von `RoutyShellScreen` unterhalb von Session-Check/Cookie/Sign-out-`LaunchedEffect`. Verantwortung: ein `RoutyMapView` mit `mapBinding`, `contentPadding` = Dock+Peek+NavBar-Inset (Phone) bzw. 0 links + FAB-Spalte rechts (Tablet: links 400 dp + 16 dp), `BackHandler`→`onHardwareBack`→Dialoge, Versöhnung §2.4, Klick-Routing (EXPLORE/MapMode→`MapViewModel.onMapClick`; PLAN→`onPlanningMapClick`; GO+ACTIVE Long-Click→Retag; RECORD schluckt).
`RouteMapChrome` und `MapScreen`s eigener `RoutyMapView` sind danach löschbar.

### 3.3 `shell/DockBar.kt`
Vier Ziele + Avatar (Icon `Icons.Filled.Map`, `AutoMirrored.DirectionsWalk`, `Icons.Filled.Navigation`, `FiberManualRecord`; Avatar = Anfangsbuchstabe `displayName`). Ausgewählter Modus: Pill in `primaryContainer` (Light `#2E6B49` @18 % auf ChromeCard, Dark `#6FC08C` @22 %), Text/Icon `onPrimaryContainer` = Akzentgrün. Touch 56 dp, `labelMedium`. Phone: untere Kante in die Nav-Bar-Inset (`navigationBarsPadding()`); Tablet: zentriert, max 480 dp, 16 dp über Inset schwebend.
Während Route-aktiv/Free-Roam-aktiv/Aufnahme ≠ IDLE im passenden Modus: Dock verdeckt; Verlassen über Schließen-Griff der Peek-Karte (Regel 10–13) oder Aufklappen + Discard/Stopp.

### 3.4 `shell/MapFabColumn.kt`
Rechte Spalte (`Alignment.TopEnd`), 48-dp-Kreise, `Surface`, `windowInsetsPadding(safeDrawing)` nur oben/seitlich:
- Kompass (`GO`, Standort-Permission) → `cycleCompassMode`, Icon `Explore`, CD = drei `route_compass_*`-Strings.
- Standort (immer) → Permission-Launcher, dann `setFollowEnabled(true)`.
- Ebenen (immer) → `LayersSheet` als kleine zweite Fläche über dem FAB (kein Fullsheet).
`MapStyleSwitcher` von diesem FAB **und** einer Einstellungen-Zeile benutzt (Settings verlieren ihn nicht).

### 3.5 `shell/ExploreSheet.kt`
Inhalt aus `MapScreen.kt`, neu verteilt (Funktionen `MapNodePanel`, `MapSegmentPanel`, `MapDrawPanel`, `MapGpxPanel`, `MapEditShapePanel`, `MapSplitPanel`, `ProposalsPanel`, `LockProposalsPanel`, `TrashPanel`, `SegmentsTablePanel`). Eine Datei `map/MapPanels.kt` als Grenze, kein Package-Split.

| Stufe | Inhalt |
|-------|--------|
| `Hidden` | Karte, Dock, FABs |
| `Peek` | Knoten-/Segmentname nach Tipp, sonst `map_tap_hint` |
| `Node`/`Half` | `MapNodePanel`: Umbenennen, Home, Verschieben, Öffnungszeiten, Löschen; eine Primäraktion, Rest TextButton ≥ 48 dp |
| `Segment` | `MapSegmentPanel` inkl. Restrict-`AlertDialog` (muddy/flooded/construction/dog/icy/overgrown bleiben) |
| `EditMenu` | Zeichnen, GPX (`GetContent`-Launcher bleibt hier), Vorschläge (nur wenn nicht leer), Papierkorb, Segmentliste |
| `MapMode.Draw/Gpx/EditSegment/SplitSegment` | jeweiliges heutiges Panel als `Half`; Schließen `setMode(View)` |

Segment-Tabelle bleibt 50 Zeilen + Sort-Chips, als Stufe (nicht Karten-Deckel). Burger (`showExtras`) entfällt. Lade-/Fehlerzustände (leeres Netz, `map_load_error`, Retry) → Peek-Karte auf leerer Karte; erster Ladezustand darf zentrierter `CircularProgressIndicator` bleiben.

### 3.6 `shell/PlanSheet.kt`
Inhalt aus `SuggestingMapLayout` + Suggestion-Zweig `RouteWithMapLayout`.
- Peek: `planningSummaryText` (eine Zeile) + Presets short/normal/long als **Segmented-Row 48 dp** (nicht 30-dp-Buttons).
- Half: „Ziel"-Feld (filtert `nodes`, max 8 Treffer), `LengthPresetSelector`, Primärbutton `route_generate_arrow` → `suggest(preset)`, `PlanningNodePanel`/`PlanningSegmentPanel` bei Selektion, Schleife/Explorer/Golden als 48-dp-Zeilen, `route_preset_surprise`, Favoriten (`FavoritesLoadDeleteButton`, Dialog bleibt), „Planung zurücksetzen" nur wenn `hasPlanning`.
- `route != null && mode == SUGGESTING`: kürzer/nochmal/länger/umdrehen als TextButtons, primär `route_accept` → `GO`; `route_cancel` räumt Suggestion. `DestinationReplaceDialog`, `PointPreviewLines`, Golden-Hinweis unter der Zusammenfassung.

### 3.7 `shell/GoSheet.kt` + `shell/FreeRoamSheet.kt`
`GoSheet` = aktive Hälfte von `RouteWithMapLayout`. Peek (Google-Maps-ETA-Zeile, Daten existieren): `lengthM`→km, `durationMin`, `elevation.gainM`, nächste Station (`stations[completedWaypointIndex+1]` bzw. erste), bei Track `done/stations.size`; **kein neues ETA-Modell**. Half/Expanded: `GuideNodeList` bzw. `shortStationGroups`, Sprache (`setVoiceEnabled`), Track an/stopp (Dialog), Abschließen (`complete`, wenn `canComplete`), Verwerfen (Dialog, Service-Stopp), `markNextStationPassed`/`markNextPassed`, `requestReposition`, Nickname (`saveNickname`), Screen an (`setKeepScreenOn`), `BatteryOptimizationPrompt`.

`FreeRoamSheet` ersetzt die duplizierten Blöcke: Peek `free_roam_active`, erreichte Knoten, `freeRoamAnnounce`; Aktionen `finishFreeRoam`/`cancelFreeRoam`; **Start** im `GoSheet` (`free_roam_start`), wenn keine Route und kein Free-Roam. Der versteckte Dock-Start entfällt. Fachlich unverändert: kein Guide, keine Stationsliste, Start = eigene Position (`freeRoamStartNodeId`, Braun `#A5711C`).
`CompletionStatsDialog` bleibt `AlertDialog` über der Karte; nach `dismissCompletionStats` → `EXPLORE/Hidden`. Retag-/Reposition-Dialoge bleiben `AlertDialog`s an `retagNodeId`/`repositionCandidates`.

### 3.8 `shell/RecordSheet.kt`
Drei Zustände aus `RecordingScreen`, ohne `TopAppBar`/Nav-Push.

| Phase | Peek | Aufgeklappt |
|-------|------|-------------|
| `IDLE` | `record_start` primär, eine Zeile `record_background_capability` | `BatteryOptimizationPrompt`, Offline-Chip |
| `RECORDING`/`PAUSED` | Punktzahl, km | Pause/Weiter, Stopp, Verwerfen (Pause) |
| `CONFIRM` | „Strecke sichern" | `ConfirmSection`: Start/Ende, `NamePartsInput`, Home-Checkbox, Speichern, Verwerfen, `record_proposals_hint` |

`requestStart()` mit Standort-+Notification-Permission bleibt wörtlich. Trackfarbe `#9A3B29`. `FloatingMapChrome` (eigene Zurück-Taste) entfällt. Speichern (`RecordingViewModel.save` → bei `saved` Service-Reset) → `EXPLORE`.

### 3.9 `shell/ProfileMenuSheet.kt`, `StatsSheet.kt`, `SettingsSheet.kt`
- **Profil** (`Half`): `displayName`+`@username` (`ShellUiState.user`), Punktezeile (`StatsUiState.gameDaily.pointBalance` bzw. `RouteUiState.totalPoints`), Zeilen: Statistik, Einstellungen, Konto & Sicherheit (`Web("/settings/account")`), Admin (`Web("/admin")`, nur admin), Abmelden (`ShellViewModel.signOut`).
- **StatsSheet** (Expanded): heutiger `StatsScreen`-Inhalt in der Schublade — oben `StatsHeroCard` (Punkte, Streak, Wochenpunkte, Tagesaufgabe, Golden heute), `displaySmall` für die Punktzahl bleibt; darunter eigene Zahlen, Netz-Nutzung, beide Leaderboards, Achievements mit `tierColor`, letzte Touren mit `WalkPathThumbnail` + Löschen-Dialog. Offline/Fehler/Retry bleiben erste Einträge. `StatsViewModel.refresh` + `StatsInvalidation` bleiben.
- **SettingsSheet** (Expanded): Sektionen in dieser Reihenfolge — Konto (öffnet Web-Stufe), Sprache, Kartenstil (öffnet `LayersSheet`), Theme, Gehgeschwindigkeit, Crash-Consent, Sessions, „überall abmelden", Abmelden. `LocaleDropdown`/`ThemeDropdown` bleiben; `needsRecreate` → `activity.recreate()` bleibt (`ChromeState` ist `rememberSaveable` → man landet wieder auf der Einstellungs-Stufe). `WalkSpeedField` behält Dezimal-Tastatur + `imePadding` über das Sheet.
Beide Sheets nutzen die bestehenden Section-Composables neu — neu ist nur der Rahmen (Griff, Scrim, Safe Area), die Ergebnisdichte bleibt (jede Tour, jeder Rang, jede Session).

### 3.10 `shell/LayersSheet.kt`, `shell/FloatingNotices.kt`
- `LayersSheet`: `MapStyleSwitcher` in kleiner Karte (3 Styles + Waymarked), lokales `var layersOpen`, kein Stufen-Wechsel der großen Schublade.
- `FloatingNotices`: Update/Upload/Offline/Recording lose vom `fillMaxWidth`-Kartenlayout; Composables behalten Texte/Aktionen, der Aufrufer gibt Breite/Inset-`padding`.

### 3.11 Was aus den alten Screens wird

| Datei | Nach dem Umbau |
|-------|----------------|
| `MainActivity.kt` | `Routes.RECORDING` + `composable`-Block weg (Phase 3); Deep-Link-Code bleibt |
| `webview/RoutyShellScreen.kt` | dünn: Session, Cookies, Sign-out, Snackbar → `MapChrome`. `TABS`, `NavigationBar`, WebView-Stapel, Banner-Column weg |
| `route/RouteScreen.kt` | aufgelöst → `GoSheet`,`PlanSheet`,`LocationEffects.kt` |
| `map/MapScreen.kt` | aufgelöst → `ExploreSheet`/`MapPanels.kt` |
| `recording/RecordingScreen.kt` | aufgelöst → `RecordSheet`+`RecordingBinding.kt` |
| `stats/StatsScreen.kt` | Körper → `StatsSheet`; `WalkPathThumbnail` bleibt |
| `settings/SettingsScreen.kt` | Körper → `SettingsSheet` |
| `webview/AuthenticatedWebSheet.kt` | Höhe an Chrome-Rahmen, sonst unverändert |
| `webview/RoutyWebView.kt`, `CookieBridge.kt`, `ShellViewModel.kt` | unverändert bis auf Aufrufort |
| `map/RoutyMapView.kt` | + `contentPadding`; Phase 4: `accentHex: String = "#2e6b49"` für Routenlinie + Standard-Knoten. Alle anderen Hex unverändert |
| Services, Worker, Widget, Onboarding, Login | unverändert |

Primärbuttons in neuen Sheets ≥ 48 dp, `labelLarge`; pro Stufe **ein** gefüllter Button (Erzeugen/Annehmen/Start/Speichern/Abschließen), Rest TextButton/Switch. `CompactButton` (30 dp) und `CompactCheck` (scale 0.8) werden **nicht** mitgezogen.

### 3.12 Strings (Parität §0)

Neue Keys in beiden Locale-Ordnern (de/en); bestehende fachliche `route_*`/`map_*`/`record_*`/`stats_*`/`settings_*` bleiben die Sheet-Texte.

| Key | de | en |
|-----|----|----|
| `shell_mode_explore` | Erkunden | Explore |
| `shell_mode_plan` | Planen | Plan |
| `shell_mode_go` | Gehen | Go |
| `shell_mode_record` | Aufnahme | Record |
| `shell_profile` | Profil | Profile |
| `shell_destination_hint` | Ziel oder Knoten | Destination or junction |
| `shell_recording_pill` | Aufnahme läuft | Recording |
| `shell_route_pill` | Route läuft | Route in progress |
| `shell_layers` | Ebenen | Layers |
| `shell_edit_network` | Netz bearbeiten | Edit network |

Keine hartkodierten deutschen Sätze (die Free-Roam-Zeilen bauen heute `"reached: " + count` per Konkatenation → beim Umzug als String-Resource mit Platzhalter, de + en).

---

## 4. Farbe und Theme (Parität §0)

### 4.1 Akzent-Tabelle, synchron zur Web-`mapAccentHex`
Neue Konstanten in `ui/theme/Color.kt`. Dark-Akzent ist **`#6FC08C`**, nicht `#4C8B67`.

| Rolle | Light | Dark | Verwendung |
|-------|-------|------|------------|
| Akzent | `#2E6B49` | `#6FC08C` | Primary, ausgewähltes Dock, Routenlinie, Knoten-Default |
| Contrast | `#FFFFFF` | `#0E2418` | Text/Icon auf Akzent |
| Dog | `#C9791F` | `#C9791F` | Token für Web-Parität (keine Kartenlage malt das heute) |
| Cat | `#A855C9` | `#A855C9` | ebenso |

`RoutyGreen` bleibt `#2E6B49` (Light-Akzent). `RoutyGreenDark #1D4A32` bleibt für gedrückte Zustände. `RoutyGreenLight` wird Alias des Dark-Akzents `#6FC08C` (eine Konstante, keine zwei Grüntöne).
Dog/Cat ersetzen **nicht** das Home-Braun `#A5711C` und nicht `TIER_COLORS` in `StatsScreen` (Bronze `#A5711C`, Gold `#C99A2E`). Restrict-`"dog"` bleibt API-String.

### 4.2 Chrome-Tokens
Ebenfalls `Color.kt`; nur dort in `MaterialTheme` eingehängt, wo es Primary und Surface betrifft. Schwebende Flächen lesen Tokens direkt (Karte darunter nicht über `surfaceTint` einfärben).

| Token | Light | Dark |
|-------|-------|------|
| `ChromeCard` | `#FFFFFFF5` (96 %) | `#1B1F19F0` (aktueller `RoutySurfaceDark`, 94 %) |
| `ChromeScrim` | `#1A1A1A` 32 % | `#000000` 56 % |
| `ChromeTopScrim` | Schwarz 40 % → 0, Höhe 72 dp | gleich |
| `DockSurface` | `#FFFFFFF5` | `#1B1F19F0` |
| App-Hintergrund hinter Karte | `#FAFAF7` / `#11140F` unverändert | |
| Fehler | `RoutyError #B3261E` unverändert | |

`Theme.kt`: Light `primary = #2E6B49`, `onPrimary = #FFFFFF` (heute schon); **Dark `primary = #6FC08C`, `onPrimary = #0E2418`** (sichtbare Umstellung, Phase 4 — nicht in der unsichtbaren Vorbereitung). `dynamicColor` bleibt false. `primaryContainer` fürs Dock: Light `#2E6B49`@18 % auf `ChromeCard`, Dark `#6FC08C`@22 %; `onPrimaryContainer` = Akzentgrün, nicht Weiß.

### 4.3 Kartenfarben, die fachlich bleiben
`RoutyMapView.accentHex`; `MapChrome` übergibt Light `#2E6B49` / Dark `#6FC08C` (betrifft die Stellen, die heute `"#2e6b49"` setzen: `routeColor`-Default, `updateSegments`-Zweig, `updateNodesLayer`-else, `updateStationsLayer`-else). Unverändert: `#9A3B29` (Track), `#C99A2E` (Golden), `#C53030` (getrennt), `#2B6CB0` (Required/Must-Visit), `#2563EB` (Auswahl/Station/GPS-Spur), `#7C3AED` (Zielknoten), `#A5711C` (Start/Home), `#1E4A32` (Verschieben), `#6B7280`/`#9A9A90` (erledigt/unbetont).

### 4.4 Dark Mode, Insets, Statusbar
`AccountTheme.isDarkTheme` bleibt der Schalter; Basemap folgt nicht dem Theme, Chrome folgt ihm (Web-Parität). `enableEdgeToEdge` ist schon an:
- MapView ohne `statusBarsPadding`/`navigationBarsPadding`; FABs/Avatar `safeDrawing` (Status/Nav/Cutout); Dock `navigationBars` + seitlich `displayCutout`; Sheet-Inhalt `safeDrawing`, Karte bekommt das IME **nicht** als Padding (Textfelder im Sheet rücken mit `ime`).
- Status-Icons: solange `MapChrome` sichtbar ein `SideEffect` setzt `isAppearanceLightStatusBars = false` (Top-Scrim in beiden Themes dunkel); Onboarding/Login behalten das globale Verhalten; beim Sign-out setzt `RoutyTheme` den Wert wieder aus `darkTheme`.
- Android 15: keine `statusBarColor`/`fitsSystemWindows`/`setDecorFitsSystemWindows`; Predictive Back über bestehenden `BackHandler`.

---

## 5. Phasen

Gate jeder Phase: `./gradlew :app:compileDebugKotlin :logic:test` grün **ohne Diff in `src/logic-kotlin`**. Manuell: Phone, ab Phase 2 Querformat/≥600 dp, Sprache de+en, Theme hell+dunkel.

### Phase 0 — Tokens & Zurück-Funktion, nichts sichtbar umbauen
- `Color.kt`: Konstanten aus §4 anlegen; `Theme.kt` noch NICHT auf `#6FC08C`, kein Screen liest `ChromeCard`.
- `shell/SheetBack.kt` mit `onHardwareBack`.
- `src/test/kotlin/com/routy/app/shell/SheetBackTest.kt`: 15 Regeln aus §2.3 + Dock-gleichwertige Fälle. Mindestens: Web-History vor Web-Schließen, Stats→Profil→Peek, Edit räumt `MapMode`, aktives GO → `ConfirmLeaveRoute` (State unverändert), `RECORDING` → `Stay`/bis-Peek, `CONFIRM` → `Stay`.
- **Abnahme:** kein Screen anders (Dark-Primary noch `#4C8B67`); `./gradlew :app:testDebugUnitTest --tests com.routy.app.shell.SheetBackTest` grün + Gate. **Paritäts-Blick:** neue Farbtabelle ≠ Web-Tabelle? (soll gleich sein).

### Phase 1 — Sheets aus den Screens schneiden, Navigation bleibt
- Composables aus `RouteScreen`/`MapScreen` in §3-Dateien verschieben **ohne Layout-Änderung**; Screens sehen aus wie vorher (inkl. 30-dp-Buttons).
- `LocationEffects.kt` + Aufnahme-`ServiceConnection`-Block als Funktionen, gleiches Verhalten.
- `RoutyMapView.contentPadding` (Default `PaddingValues(0.dp)`) → `setPadding`; kein Aufrufer setzt es schon.
- **Abnahme:** Route/Karte/Aufnahme/Stats/Settings/Admin bedienen sich wie vorher; aktive Route mit Track überlebt Tab-Wechsel + Aufnahme-Öffnen; Diff ohne neue Gesten-Logik.

### Phase 2 — Eine Karte, Dock, Erkunden / Planen / Gehen
- `MapChrome` ersetzt Scaffold/`NavigationBar`/opake Tab-`Surface`s; **ein** `RoutyMapView`.
- `DockBar`, `ExploreSheet`, `PlanSheet`, `GoSheet`, `FreeRoamSheet`; Avatar öffnet in dieser Phase direkt `StatsScreen`/`SettingsScreen` als Expanded (Feinschliff = Phase 4).
- Admin: Avatar-Zeile „Admin" öffnet `AuthenticatedWebSheet`/Web-Stufe `/admin`; dauerhafte WebView-Instanz ist weg.
- `Recording`-Destination bleibt; Dock „Aufnahme" ruft noch `onStartRecording`. Banner → `FloatingNotices`. `ChromeState` `rememberSaveable`. Tablet-Zweig ≥600 dp (Seitenkarte 400 dp, Dock zentriert).
- **Abnahme:** Kaltstart → volle Karte, Dock Erkunden; Planen (Knoten-Ziel, Preset, Erzeugen, Polyline, Annehmen→GO); Gehen (Standort-FAB, Kompass, Sprache, Track, Abschluss, Verwerfen); Free-Roam aus Gehen (keine Guide-Liste); Zurück auf aktiver Route → Confirm, Track erst nach Bestätigung; Share-Deep-Link → Planen/Annahme; Admin-WebView nur im offenen Sheet; Querformat ≥600 dp; Stats/Settings-Inhalt vollständig erreichbar (noch altes Listen-Layout im Sheet). **Paritäts-Blick:** Dock-Labels/Modi = Web-Dock.

### Phase 3 — Aufnahme auf derselben Karte
- `RecordSheet` + Binding aus der Shell; `MainActivity` verliert `Routes.RECORDING`.
- Pille, wenn Phase ≠ IDLE und Modus ≠ RECORD (inkl. CONFIRM). Zurück bei `RECORDING/PAUSED/CONFIRM` stoppt Service nicht.
- **Abnahme:** Start→Pause→Stopp→Endpunkte→Speichern ohne Nav-Stack-Wechsel; GPX-Commit + Snackbar wie bisher; Hintergrund während RECORDING (Notification, Zurückholen zeigt RECORD); Wechsel nach Erkunden lässt Service laufen, Pille führt zurück; Verwerfen nur per Button; `RecordingActiveBanner` keinen Aufrufer mehr. **Paritäts-Blick:** Aufnahme-Trackfarbe + Flows = Web.

### Phase 4 — Profil, Stats, Settings, Ebenen, Theme scharf
- `ProfileMenuSheet`/`StatsSheet`/`SettingsSheet` (§3.9), 48-dp-Aktionen statt 30-dp-Helfer.
- `LayersSheet` am FAB + in Einstellungen. `Theme.kt`: Dark `primary = #6FC08C`, `onPrimary = #0E2418`. `RoutyMapView.accentHex` aus Theme. Top-Scrim + `isAppearanceLightStatusBars = false` nur unter `MapChrome`. `AuthenticatedWebSheet` ohne feste 560 dp. Neue Strings de+en.
- **Abnahme:** Stats (Hero, Achievements, Leaderboards, Touren, Löschen); Settings (Sprache → landet wieder im Settings-Sheet; Theme hell/dunkel/auto; Sessions; Logout; Konto-Sheet); Dark nutzt `#6FC08C` für Dock/Sheet/Routenlinie (Golden/Home-Braun/Aufnahme-Rot/Fehlerrot unverändert); Ebenen-FAB + Einstellungen teilen `MapPreferencesStore`; IME schiebt Sheet, nicht Kartenlücke; System-Nav überdeckt kein Dock-Label/Primär-Button. **Paritäts-Blick:** Farben/Labels = Web `mapAccentHex` + `shell.*`.

### Phase 5 — Aufräumen
- Dateien ohne Aufrufer löschen (Fassaden `RouteScreen`/`MapScreen`/`RecordingScreen`/`StatsScreen`/`SettingsScreen`, `CompactButton`-Kopien, `TABS`, ungenutzte Imports). `RoutyShellScreen`-Kommentar („fünf Tabs") auf Modus-Shell umschreiben.
- Keine Verhaltensänderung; macht ein Löschen das Gate rot, bleibt das Symbol + Grund notiert. **Abnahme:** Gate grün, manuelle Wege aus Phase 2–4 nochmal, `src/logic-kotlin` ohne Diff.

---

## 6. Risiken

| Risiko | Mitigation |
|--------|------------|
| GPS/Service an Komposition gebunden | Effekte in `MapChrome` (lebt solange die Shell); „Updates nur, wenn Service sie nicht hat" wörtlich mitnehmen; `FLAG_KEEP_SCREEN_ON` am Effect, nicht am Dock |
| Confirm-Phase verliert Strecke | `recordingActive` ist false bei CONFIRM — Pille/Versöhnung lesen `RecordingServiceState.phase` |
| WebView in Compose | nur montieren bei `SheetStage.Web`; `DisposableEffect`-Bundle; `CookieBridge` vor `loadUrl`; Login-Redirect → `onDismiss`+`signOut` |
| Hardware-Zurück | ein `BackHandler` in `MapChrome`; Web-`goBack` = Regel 1, kein zweiter Handler; aktive Route → bestehender Dialog, nicht `popBackStack` |
| Zustand über Navigation | `rememberSaveable` + Versöhnung; ViewModels überleben Recreate via `ViewModelStore`, nicht Shell→Login (richtig) |
| Zwei Netz-Ladungen | `BootstrapLoader`-Cache; `mapBinding` zeigt einen Indikator, solange Route lädt und Netz leer |
| Kamera-Sprung | `fitKey` ohne Modus; Follow hat Vorrang, `fitToRouteOnly` nur bei erstem Routen-Token |
| Android 15 Edge-to-Edge | Karte unter Gestenleiste ist Absicht; klickbare Flächen in Safe Area; `setPadding` = `contentPadding` (sonst Logo unter Dock, Fit unter Sheet); Cutouts an FAB/Seitenkarte |
| de/en | Keys in beiden Ordnern; `NamePartsInput`, `dd.MM.yyyy HH:mm`, `Collator` bleiben; keine hartkodierten Sätze |
| Prozess-Tod mitten in Route | `RouteProgressStore` stellt VM her; Shell zeigt GO (Versöhnung) + Routen-Pille |
| Review-Falle Phase 2 | größter UX-Sprung; mischt keine Theme-Umstellung/Löschung der Aufnahme-Route hinein, damit Reset die Aufnahme nicht mit abreißt |
| **Parität** | Modus-Namen divergieren → §0: eine Termliste, Paritäts-Blick pro Phase |

---

## 7. Abnahme, gesammelt

1. Login mündet in eine Karte bis an die Ränder; Dock: Erkunden, Planen, Gehen, Aufnahme.
2. Erkunden: Tipp auf Knoten öffnet Aktions-Stufe; „Netz bearbeiten" enthält Zeichnen, GPX, Vorschläge, Papierkorb, Segmentliste.
3. Planen: Ziel aus eigenen Knoten, Länge, Erzeugen, Annehmen. Polyline Grün `#2E6B49` / Dark `#6FC08C`.
4. Gehen: ETA-Zeile (km, Minuten, Anstieg, nächste Station), Track + Sprache über Services, Zurück fragt.
5. Free-Roam aus Gehen, keine Stationsliste.
6. Aufnahme startet/pausiert/sichert Endpunkte ohne zweite Activity-Destination; Pille holt zurück.
7. Profil → Statistik (Hero, Touren, Leaderboards) + Einstellungen (Sprache, Theme, Sessions, Logout); Konto + Admin als Web-Sheets.
8. Tablet-Breite: Seitenkarte, eine Karte daneben.
9. `:app:compileDebugKotlin` + `:logic:test` grün, `src/logic-kotlin` unverändert.
10. **Parität:** Dock, Sheets, Farben, Labels, Icons = Web (`docs/REDESIGN.md` §0/§6/§7); wer die App kann, kann das Web und umgekehrt.
