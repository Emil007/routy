#!/usr/bin/env node
/**
 * Routy — Demo-Daten Seeder
 * -------------------------
 * Erzeugt eine komplette, realistische Demo-Datenbank mit einem FIKTIVEN
 * Straßen-/Wegnetz (keine echten Koordinaten). Die Struktur folgt exakt den
 * Original-Daten des routy-Repos:
 *   - Knoten mit Namen (Straße/Kreuzung), inkl. genau einem home_node
 *   - Segmente BIDIREKTIONAL (hin + zurück, verknüpft per reverse_of)
 *   - Geometrie als JSON-Array von {lat,lng,...}
 *   - node_chain / segment_ids als JSON-Arrays
 *   - mehrere echte Walk-Logs (führen die Punkte/Streak/Achievement-Berechnung)
 *   - Favoriten, Golden-Segmente, Settings, name_parts
 *
 * Verwendung:
 *   node scripts/seed-demo/seed.js
 *     -> schreibt data/demo.db
 *   DATABASE_PATH=scripts/seed-demo/demo.db node scripts/seed-demo/seed.js
 *     -> schreibt an den angegebenen Pfad
 *   DB_EXPORT_JSON=1 ... -> gibt eine JS-Payload statt DB aus (für Tests)
 *
 * Login in der Demo: Benutzer "demo" / Passwort "demo1234".
 */
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync } = require("node:crypto");

const TARGET = process.env.DATABASE_PATH || path.join(__dirname, "data", "demo.db");
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
const DEMO_PASSWORD = "demo1234";

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function dist(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Fiktives, aber geografisch realistisches Spazier-Netz rund um Camden /
 *  Primrose Hill, London (51.54° N / -0.15° W). Knoten = echte Londoner
 *  Straßen, benannt wie die Kreuzungen im Original („Straße/Straße“).
 *  Koordinaten sind bewusst ungenau (Spaziergang-Granularität), damit aus
 *  den Screenshots weder echte Adressen noch private Routen ableitbar sind. */
const NET = {
  CENTRE: [51.5410, -0.1530],
  // Echtes Londoner Straßennetz (Camden → Kentish Town → Highgate →
  // Hampstead → Swiss Cottage → St John's Wood → Regent's Park), groß genug
  // für echte Rundwege von 3–9 km. Koordinaten sind bewusst auf
  // Straßenebene gehalten (keine exakten Adressen). "Zuhause" = Startknoten.
  NODES: [
    ["Zuhause", 51.53900, -0.14400],
    ["Camden High Street / Parkway", 51.53870, -0.14360],
    ["Camden High Street / Pratt Street", 51.53980, -0.14280],
    ["Parkway / Jamestown Road", 51.53930, -0.14480],
    ["Jamestown Road / Delancey Street", 51.53990, -0.14600],
    ["Delancey Street / Camden Road", 51.54070, -0.14530],
    ["Camden Road / Royal College Street", 51.54270, -0.14190],
    ["Royal College Street / Randolf Street", 51.54390, -0.14110],
    ["Kentish Town Road / Camden Road", 51.54380, -0.14230],
    ["Kentish Town Road / Leighton Road", 51.54850, -0.14150],
    ["Kentish Town Road / Fortess Road", 51.55350, -0.14080],
    ["Fortess Road / Tufnell Park Road", 51.55700, -0.13870],
    ["Fortess Road / Highgate Road", 51.55950, -0.13760],
    ["Highgate Road / Dartmouth Park Hill", 51.56150, -0.14000],
    ["Highgate Road / Swain's Lane", 51.56350, -0.14150],
    ["Swain's Lane / Highgate West Hill", 51.56700, -0.14350],
    ["Highgate West Hill / Archway Road", 51.56540, -0.13750],
    ["Archway Road / Crouch End Hill", 51.56960, -0.13420],
    ["Highgate Hill / North Road", 51.57010, -0.14580],
    ["Highgate Hill / Shepherds Hill", 51.56800, -0.14800],
    ["Shepherds Hill / Swain's Lane", 51.56600, -0.14550],
    ["Swain's Lane / Parliament Hill", 51.56040, -0.14850],
    ["Parliament Hill / South End Road", 51.55800, -0.15100],
    ["East Heath Road / South End Green", 51.55430, -0.15700],
    ["Rosslyn Hill / Pond Street", 51.55300, -0.16600],
    ["Rosslyn Hill / Heath Street", 51.55650, -0.16750],
    ["Heath Street / Hampstead High Street", 51.55500, -0.17450],
    ["Hampstead High Street / Heath Street", 51.55380, -0.17850],
    ["Finchley Road / Frognal Lane", 51.54850, -0.18200],
    ["Finchley Road / College Crescent", 51.54320, -0.17850],
    ["Swiss Cottage / Finchley Road", 51.54200, -0.17500],
    ["Avenue Road / Adelaide Road", 51.54100, -0.16900],
    ["Avenue Road / Allitsen Road", 51.53750, -0.16500],
    ["St John's Wood Road / Avenue Road", 51.53400, -0.16600],
    ["St John's Wood Road / Acacia Road", 51.53250, -0.16200],
    ["Acacia Road / Prince Albert Road", 51.53300, -0.15750],
    ["Prince Albert Road / Regent's Park", 51.53200, -0.15200],
    ["Prince Albert Road / Park Village East", 51.53550, -0.14700],
    ["Park Village East / Albany Street", 51.53600, -0.14400],
    ["Albany Street / Camden High Street", 51.53650, -0.14100],
    ["Camden High Street / Delancey Street", 51.53750, -0.14250],
    ["Delancey Street / Albert Street", 51.53860, -0.14550],
    ["Albert Street / Parkway", 51.53830, -0.14680],
    ["Albany Street / Prince Albert Road", 51.53400, -0.14600],
  ],
  // Ungerichtete Kanten entlang der tatsächlichen Straßenzüge (der Seeder
  // erzeugt daraus 2 Segmente: hin + zurück).
  EDGES: [
    // Zuhause / Camden-Kern
    [1, 2], [1, 3], [1, 40],
    [2, 3], [2, 4], [2, 41],
    [3, 7], [3, 40],
    [4, 5], [4, 42],
    [5, 6], [5, 42], [5, 43],
    [6, 7], [6, 8], [6, 43],
    [7, 8], [7, 9],
    // Camden → Kentish Town (Kette)
    [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15],
    // Highgate Kreuzungen
    [15, 16], [16, 17], [16, 21], [21, 22], [13, 22],
    [17, 18], [18, 19],
    [19, 20], [20, 21],
    // Kentish Town → Hampstead Heath
    [22, 23], [23, 24], [24, 25], [25, 26], [26, 27], [27, 28],
    // Hampstead → Swiss Cottage / St John's Wood
    [28, 29], [29, 30], [30, 31], [31, 32],
    // St John's Wood → Regent's Park → zurück zum Camden-Kern (Ring)
    [32, 33], [33, 34], [34, 35], [35, 36], [36, 37], [37, 43],
    [37, 44], [44, 38], [38, 39], [39, 40], [40, 41],
    [41, 42], [42, 43], [43, 44],
  ],
};

/** Ein paar realistische Rundwege (Folgen von Knoten-IDs), die nur die oben
 *  definierten Kanten nutzen — wie echte Spaziergänge. */
const ROUTES = [
  [1, 2, 13, 14, 11, 12, 4, 5, 1],
  [1, 5, 6, 7, 8, 3, 2, 1],
  [1, 2, 3, 8, 9, 10, 11, 12, 13, 2, 1],
  [1, 5, 4, 12, 11, 6, 5, 1],
  [1, 2, 13, 12, 8, 7, 6, 5, 1],
  [1, 5, 6, 11, 14, 13, 12, 4, 5, 1],
];

function chainToSegments(route) {
  const segs = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const forward = segments.find((s) => s.start === a && s.end === b);
    const reverse = segments.find((s) => s.start === b && s.end === a);
    if (!forward && !reverse) {
      console.error("FEHLER: Kante fehlt", a, "->", b, "an Position", i, "Route:", JSON.stringify(route));
      throw new Error(`Kein Segment für Kante ${a}->${b} gefunden`);
    }
    segs.push(forward ? forward.id : reverse.id);
  }
  return segs;
}

let db;
if (fs.existsSync(TARGET)) fs.unlinkSync(TARGET);
db = new Database(TARGET);
db.pragma("foreign_keys = OFF");
db.pragma("journal_mode = WAL");
db.exec("BEGIN");

// ---- Schema aus der Original-Datenbank (identisch) ----
const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(SCHEMA);

// ---- name_parts ----
const nameParts = new Set();
for (const [name] of NET.NODES) {
  const [p1 = name, p2] = name.split("/");
  nameParts.add(p1);
  if (p2) nameParts.add(p2);
  else nameParts.add(name);
}
const insNP = db.prepare(
  "INSERT INTO name_parts (text, created_by, created_at, display_text, speak_text) VALUES (?, 1, datetime('now'), ?, ?)",
);
for (const np of nameParts) insNP.run(np, np, np);

// ---- nodes ----
const insNode = db.prepare(
  "INSERT INTO nodes (id, name, lat, lng, is_home, created_at, created_by, name_separator, active) VALUES (?, ?, ?, ?, ?, datetime('now'), 1, '/', 1)",
);
NET.NODES.forEach(([name, lat, lng], i) => {
  const id = i + 1;
  insNode.run(id, name, lat, lng, id === 1 ? 1 : 0);
});

// ---- segments (bidirektional, reverse_of) ----
const insSeg = db.prepare(
  `INSERT INTO segments
    (start_node_id, end_node_id, geometry, length_m, duration_min, ele_gain_m, ele_loss_m, source, created_at, name, active, reverse_of, duration_from_gps, one_way)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'hand', datetime('now'), ?, 1, ?, 0, 0)`,
);
const segments = [];
let segId = 1;
for (const [a, b] of NET.EDGES) {
  const pa = NET.NODES[a - 1], pb = NET.NODES[b - 1];
  const len = Math.round(dist([pa[1], pa[2]], [pb[1], pb[2]]));
  const dur = Math.max(1, Math.round(len / 80));
  const geom = JSON.stringify([
    { lat: pa[1], lng: pa[2] },
    { lat: pb[1], lng: pb[2] },
  ]);
  const gain = Math.floor(Math.random() * 8), loss = Math.floor(Math.random() * 6);
  const name = `${pa[0]} / ${pb[0]}`;
  const idFwd = segId++;
  const idRev = segId++;
  insSeg.run(a, b, geom, len, dur, gain, loss, name, idRev);
  insSeg.run(b, a, geom, len, dur, gain, loss, name, idFwd);
  segments.push({ start: a, end: b, id: idFwd, len });
  segments.push({ start: b, end: a, id: idRev, len });
}

// ---- users ----
const pw = hashPassword(DEMO_PASSWORD);
const insUser = db.prepare(
  `INSERT INTO users
    (username, password_hash, display_name, locale, created_at, walk_speed_kmh, role, active, theme, timezone, home_node_id, taste_short_m, taste_normal_m, taste_long_m)
   VALUES (?, ?, ?, ?, datetime('now'), 4.8, 'admin', 1, 'auto', 'Europe/London', 1, 8000, 12000, 16000)`,
);
insUser.run("demo", pw, "Demo", "de");
insUser.run("mia", pw, "Mia", "de");
db.prepare("UPDATE users SET walk_speed_kmh = 4.2, home_node_id = 8 WHERE username = 'mia'").run();

// ---- settings ----
const insSet = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries({
  merge_radius_m: "25",
  name_far_warn_m: "300",
  tolerance_percent: "10",
  widen_step_percent: "5",
  widen_max_percent: "30",
  daily_diversity_weight: "1",
  golden_percent: "5",
  walk_speed_kmh: "4.8",
})) insSet.run(k, v);

// ---- golden segments (heute, einige IDs) ----
const today = new Date().toISOString().slice(0, 10);
const insGold = db.prepare("INSERT OR REPLACE INTO golden_segments (utc_date, segment_id, multiplier) VALUES (?, ?, 3.0)");
for (const gid of [1, 3, 6, 8, 9, 11]) insGold.run(today, gid);

// ---- walk logs (reichen für Punkte/Streak/Achievements) ----
const insWalk = db.prepare(
  `INSERT INTO walk_log
    (user_id, node_chain, segment_ids, length_m, duration_min, accepted_at, nickname,
     points_earned, points_base, points_golden, points_exploration, points_diversity,
     streak_multiplier, golden_hits, celebration_tier, length_rating)
   VALUES (?, ?, ?, ?, ?, datetime('now', '-' || ? || ' days'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
/** Zufällige aber garantiert gültige Rundwege: startet bei Knoten 1 (Zuhause),
 *  folgt nur echten Kanten und kehrt zur 1 zurück. Deterministisch via
 *  fester Saat, damit zwei Seeds identische Demo-Daten liefern. */
const ADJ = new Map();
for (const [a, b] of NET.EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, []);
  if (!ADJ.has(b)) ADJ.set(b, []);
  ADJ.get(a).push(b);
  ADJ.get(b).push(a);
}
function randomRoundTrip(salt = 0) {
  let seed = salt;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const chain = [1];
  let cur = 1;
  const steps = 14 + Math.floor(rnd() * 9); // 14–22 Knoten ⇒ realistische 3–6 km Runden
  for (let i = 0; i < steps; i++) {
    const nbrs = ADJ.get(cur) ?? [];
    const next = nbrs[Math.floor(rnd() * nbrs.length)];
    chain.push(next);
    cur = next;
  }
  // zurück nach Hause über kürzesten Pfad aus EChten Kanten (BFS) — nur falls
  // wir nicht schon wieder bei Knoten 1 gelandet sind.
  if (cur !== 1) {
    const prev = new Map([[1, null]]);
    const q = [1];
    while (q.length && !prev.has(cur)) {
      const x = q.shift();
      for (const n of ADJ.get(x) ?? []) {
        if (!prev.has(n)) {
          prev.set(n, x);
          q.push(n);
        }
      }
    }
    const back = [];
    let node = cur;
    while (node !== 1) { back.push(node); node = prev.get(node); }
    // back = [cur, P, ..., X] folgt den BFS-Parent-Zeigern zurück zu 1 — also
    // jede Kante gültig. Den Startknoten cur (steht schon in chain) abwerfen
    // und den Rest in dieser Reihenfolge anhängen.
    back.shift();
    if (back.length) chain.push(...back, 1);
  }
  return chain;
}

const walkSeeds = [];
for (let i = 0; i < 14; i++) {
  const chain = randomRoundTrip(i + 1);
  const names = ["Feierabendrunde", "Sonntagsrunde", "Bigloop", "Halbe Stunde", "Doppelrunde", "Große Runde", "Letzte Runde"];
  const nick = i % 2 === 0 ? names[(i / 2) % names.length] : null;
  const pts = 41 + i * 11;
  const mult = 1.0 + Math.min(0.3, Math.floor(i / 5) * 0.15);
  walkSeeds.push(["Demo", chain, i + 1, nick,
    pts, Math.round(pts * 0.26), Math.round(pts * 0.14), Math.round(pts * 0.32),
    2 + Math.floor(i / 6), mult,
    1 + Math.floor(i / 3),
    i >= 4 ? "gold" : i >= 1 ? "silber" : "bronze",
    1 + Math.floor(i / 4)]);
}
walkSeeds.forEach(([user, chain, daysAgo, nick, pts, base, golden, expl, div, mult, gh, tier, rating], i) => {
  const uid = user === "Demo" ? 1 : 2;
  const segs = chainToSegments(chain);
  const len = segs.reduce((acc, s) => acc + (segments.find((x) => x.id === s)?.len ?? 0), 0) || 3000;
  const dur = Math.max(1, Math.round(len / 80)) + 5;
  insWalk.run(uid, JSON.stringify(chain), JSON.stringify(segs), len, dur, 14 - i, nick, pts, base, golden, expl, div, mult, gh, tier, rating);
});

// ---- user_segment_usage / segment_usage (Netz-Statistiken) ----
const insUsage = db.prepare(
  "INSERT OR REPLACE INTO user_segment_usage (user_id, segment_id, usage_count, last_used_at) VALUES (?, ?, ?, datetime('now'))",
);
const insSegU = db.prepare(
  "INSERT OR REPLACE INTO segment_usage (segment_id, usage_count, last_used_at) VALUES (?, ?, datetime('now'))",
);
for (const s of segments) {
  insUsage.run(1, s.id, 1 + Math.floor(Math.random() * 12));
  insSegU.run(s.id, 1 + Math.floor(Math.random() * 14));
}

// ---- Favoriten (aus den ersten beiden generierten Walk-Logs) ----
const insFav = db.prepare(
  `INSERT INTO favorite_route (user_id, name, node_chain, segment_ids, length_m, duration_min, created_at)
   VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
);
for (const [ni, favName] of [[0, "Feierabendrunde"], [5, "Sonntagsrunde"]]) {
  const chain = walkSeeds[ni][1];
  const segs = chainToSegments(chain);
  const len = segs.reduce((acc, s) => acc + (segments.find((x) => x.id === s)?.len ?? 0), 0) || 3200;
  insFav.run(favName, JSON.stringify(chain), JSON.stringify(segs), len + 200, 45);
}

// ---- achievements-Backfill (Nur für den Cache; echte Berechnung kommt aus walk_log) ----
const insAch = db.prepare("INSERT OR IGNORE INTO achievements (user_id, key, earned_at) VALUES (1, ?, datetime('now'))");
for (const k of ["trailblazer", "collector", "earlyBird", "weekWarrior", "longHaul", "nightOwl"]) insAch.run(k);

db.exec("COMMIT");
db.pragma("foreign_keys = ON");
db.close();

console.log(
  `✔ Demo-DB geschrieben: ${TARGET}\n` +
  `  Knoten: ${NET.NODES.length} · Segmente: ${segments.length} · Kanten: ${NET.EDGES.length}\n` +
  `  Walks: ${walkSeeds.length} · Favoriten: 2 · Login: demo / ${DEMO_PASSWORD}`,
);
