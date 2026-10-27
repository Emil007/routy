/**
 * Free-roam mode (0.47): walk anywhere, the server lives with you.
 *
 * Session model (STATELESS, decision K): the token IS the session.
 *  - `createFreeRoamSession` builds a state object and returns an HMAC-signed
 *    token that carries the ENTIRE session state (start node, visited nodes,
 *    accumulated length, timestamps). There is no in-memory map and no DB
 *    table, so a token survives server restarts / multiple instances without
 *    any shared store.
 *  - `checkin` verifies the signature, mutates the decoded state, re-signs it
 *    and returns the FRESH token; clients must keep sending the latest token.
 *  - `complete` closes the session with the recorded track and awards points at
 *    the reduced FREE_ROAM multiplier (you didn't follow a curated route).
 *
 * Mutating functions (checkin/update) return a NEW token — treat the previous
 * one as consumed. Non-mutating readers (getFreeRoamSession, assertFreeRoamOwner)
 * can be called with any still-valid token of the same session.
 *
 * Every completed free-roam track also flows through the normal GPX commit /
 * proposal pipeline, so freely walked ground becomes split proposals (new
 * junctions) and track-geometry suggestions for the admin — exactly the
 * "Aufzeichnungen für Verbesserungen nutzen" Emil asked for.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { listNodes, type NodeRow } from "./nodes";
import { listSegments } from "./segments";
import { loadGraphContext } from "./routeContext";
import { haversineMeters, type LatLng } from "./geo";
import { capTrackPoints } from "./discovery";
import { db } from "./db";

/** How close GPS must be (metres) to count as "reached" for announcement. */
export const FREE_ROAM_REACH_M = 30;
/** How close a fresh position must be to an existing node to auto-start there. */
export const FREE_ROAM_START_RADIUS_M = 80;

export interface FreeRoamSession {
  userId: number;
  /** Starting node, if one was known at start. */
  startNodeId: number | null;
  startLat: number;
  startLng: number;
  visitedNodeIds: number[];
  /** Any node we have already announced, so we don't spam repeats. */
  announcedNodeIds: number[];
  /** Tracked distance walked so far (sum of a straight-line estimate per leg). */
  lengthM: number;
  durationMin: number;
  startedAt: number;
  /** Last reported GPS position — used to accumulate the straight-line length estimate. */
  lastLat: number | null;
  lastLng: number | null;
}

const TTL_MS = 12 * 60 * 60 * 1000;
/** Tombstones are purged 36 h after completion (larger than TTL + slack). */
const SPENT_RETENTION_MS = 36 * 60 * 60 * 1000;
const SECRET_SETTINGS_KEY = "free_roam_secret";

// ---------------------------------------------------------------------------
// HMAC signing — the token is `base64url(json-state).base64url(signature)`.
// The secret is persisted in the settings table so tokens stay valid across
// server restarts. In the test suite (which reuses the real data DB read-only)
// we fall back to a process-local secret — verification is still consistent
// within the process, and no test writes ever touch the real database.
// ---------------------------------------------------------------------------
let cachedSecret: string | null = null;

function getSecretKey(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.FREE_ROAM_SECRET;
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SECRET_SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (row) {
    cachedSecret = row.value;
    return cachedSecret;
  }
  const generated = randomBytes(32).toString("hex");
  // Never write to the DB under the test runner (data/routy.db is read-only),
  // and never in CI without a database. Production + dev persist the secret.
  if (!process.env.VITEST && !process.env.VITEST_NO_DB) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(SECRET_SETTINGS_KEY, generated);
  }
  cachedSecret = generated;
  return cachedSecret;
}

function encodeState(session: FreeRoamSession): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

function decodeState<T>(b64: string): T | null {
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", getSecretKey()).update(payload).digest("base64url");
}

/** Signs a session into a stateless token. */
export function signSession(session: FreeRoamSession): string {
  const payload = encodeState(session);
  return `${payload}.${sign(payload)}`;
}

/** Verifies signature + shape; returns the decoded session or null. */
export function verifySessionToken(token: string): FreeRoamSession | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const session = decodeState<FreeRoamSession>(payload);
  if (!session || typeof session.userId !== "number" || typeof session.startedAt !== "number") return null;
  return session;
}

function isStale(session: FreeRoamSession): boolean {
  return Date.now() - session.startedAt > TTL_MS;
}

/** Builds an initial session state and returns its signed token. */
export function createFreeRoamSession(
  userId: number,
  position: { lat: number; lng: number },
  explicitStartNodeId?: number | null,
): string {
  // Explicit start node wins; else nearest within radius.
  // Uses haversine/radius (consistent with the rest of the domain, not planar).
  const startNodeId =
    explicitStartNodeId != null
      ? explicitStartNodeId
      : nearestNodeId(position, listNodes(), FREE_ROAM_START_RADIUS_M);
  const session: FreeRoamSession = {
    userId,
    startNodeId,
    startLat: position.lat,
    startLng: position.lng,
    visitedNodeIds: startNodeId != null ? [startNodeId] : [],
    // The start node is announced once via the `start` response; checkins should
    // only announce nodes reached AFTER you start moving.
    announcedNodeIds: startNodeId != null ? [startNodeId] : [],
    lengthM: 0,
    durationMin: 0,
    startedAt: Date.now(),
    lastLat: position.lat,
    lastLng: position.lng,
  };
  return signSession(session);
}

/** Decodes + verifies a token; TTL is enforced on access (not just creation). */
export function getFreeRoamSession(token: string): FreeRoamSession | null {
  const session = verifySessionToken(token);
  if (!session) return null;
  if (isStale(session)) return null;
  return session;
}

/** Anti-replay (decision K + review security): remember a completed session so its
 *  token can never earn points a second time. The stateless HMAC token carries no
 *  server-side state, so "spent" has to live here — keyed by (userId, startedAt),
 *  which is the session's immutable id regardless of which rotated token is shown.
 *  Returns the already-credited walk id, or null when the session is still spendable. */
export function completedWalkIdFor(session: FreeRoamSession): number | null {
  const row = db
    .prepare("SELECT walk_id FROM free_roam_completed WHERE user_id = ? AND started_at = ?")
    .get(session.userId, session.startedAt) as { walk_id: number | null } | undefined;
  return row?.walk_id ?? null;
}

/** Records a completed session as spent (idempotent). */
export function markFreeRoamCompleted(session: FreeRoamSession, walkId: number | null = null): void {
  db.prepare("INSERT OR IGNORE INTO free_roam_completed (user_id, started_at, walk_id) VALUES (?, ?, ?)").run(
    session.userId,
    session.startedAt,
    walkId,
  );
}

/** Bounded retention: drop tombstones older than the window above. Returns count. */
export function purgeExpiredFreeRoamCompletions(): number {
  const info = db
    .prepare("DELETE FROM free_roam_completed WHERE datetime(completed_at) < datetime(?, 'unixepoch')")
    .run(Math.floor(Date.now() - SPENT_RETENTION_MS));
  return info.changes;
}

/** Applies a patch and returns a NEW signed token (the old token stays valid as
 *  a snapshot but is superseded). No external callers currently; kept for API
 *  stability. */
export function updateFreeRoamSession(token: string, patch: Partial<FreeRoamSession>): string {
  const session = getFreeRoamSession(token);
  if (!session) return token;
  return signSession({ ...session, ...patch });
}

/** Stateless tokens carry no server-side state — nothing to delete. Kept for
 *  API stability so callers don't have to special-case sessions. */
export function deleteFreeRoamSession(_token: string): void {
  // no-op by design
}

export function assertFreeRoamOwner(token: string, userId: number): FreeRoamSession | "missing" | "forbidden" {
  const session = getFreeRoamSession(token);
  if (!session) return "missing";
  if (session.userId !== userId) return "forbidden";
  return session;
}

/** Nearest node within `radiusM`, or null. */
export function nearestNodeId(point: { lat: number; lng: number }, nodes: NodeRow[], radiusM: number): number | null {
  let best: { id: number; d: number } | null = null;
  for (const n of nodes) {
    const d = haversineMeters({ lat: n.lat, lng: n.lng }, point);
    if (d <= radiusM && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}

export interface ReachableNeighbour {
  nodeId: number;
  name: string | null;
  distanceM: number;
  /** Name of the segment (path) leading to the neighbour, if it has one. */
  viaSegmentName: string | null;
}

/**
 * One-hop reachable neighbours of `nodeId` on the routable graph. The app uses
 * this to announce e.g. "Von dir aus erreichbar: Nordwald über 'Anstieg', …".
 * Only canonical segments count (a forward/reverse pair is one physical path).
 */
export function reachableNeighbours(nodeId: number): ReachableNeighbour[] {
  const { graph, segmentsById } = loadGraphContext();
  const edges = graph.adjacency.get(nodeId) ?? [];
  const canonicalIds = new Set<number>();
  const out: ReachableNeighbour[] = [];
  for (const e of edges) {
    const seg = segmentsById.get(e.id);
    if (!seg) continue;
    const canonical = seg.reverseOf != null ? Math.min(seg.id, seg.reverseOf) : seg.id;
    if (canonicalIds.has(canonical)) continue;
    canonicalIds.add(canonical);
    out.push({
      nodeId: e.to,
      name: null, // filled by caller from nodesById
      distanceM: Math.round(e.lengthM),
      viaSegmentName: seg.name,
    });
  }
  // Fill names from the node table.
  const nodesById = new Map(listNodes().map((n) => [n.id, n]));
  for (const r of out) {
    r.name = nodesById.get(r.nodeId)?.name ?? null;
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

export interface CheckinResult {
  /** Nodes newly reached since the last checkin. */
  newlyReached: {
    nodeId: number;
    name: string | null;
    reachable: ReachableNeighbour[];
  }[];
  /** True once a node was reached and should trigger a voice announcement. */
  shouldAnnounce: boolean;
  visitedCount: number;
  /** The FRESH signed token. Clients MUST store this and send it on the next
   *  checkin/complete — the previous token is the pre-checkin snapshot. */
  token: string;
}

/**
 * Process a GPS checkin. Returns any freshly reached nodes together with their
 * reachable neighbours for voice/visual announcement, plus the rotated token.
 * Repeated checkins at the same node are deduped via `announcedNodeIds`.
 */
export function checkinFreeRoam(token: string, position: { lat: number; lng: number }): CheckinResult {
  const session = getFreeRoamSession(token);
  if (!session) {
    return { newlyReached: [], shouldAnnounce: false, visitedCount: 0, token };
  }

  // Accumulate a straight-line walk estimate (deep-review #6): lengthM/durationMin
  // were documented as tracked totals but never updated, so freeRoamWalkBasis and
  // status sat at zero forever. The committed track later carries the true length.
  if (session.lastLat != null && session.lastLng != null) {
    session.lengthM += haversineMeters({ lat: session.lastLat, lng: session.lastLng }, position);
  }
  session.lastLat = position.lat;
  session.lastLng = position.lng;
  session.durationMin = Math.round((Date.now() - session.startedAt) / 60000);

  const nodes = listNodes();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const newlyReached: CheckinResult["newlyReached"] = [];
  // A single checkin can only move so far; consider the nearest node only.
  const nearest = nearestNodeId(position, nodes, FREE_ROAM_REACH_M);
  if (nearest != null && !session.announcedNodeIds.includes(nearest)) {
    session.announcedNodeIds.push(nearest);
    if (!session.visitedNodeIds.includes(nearest)) session.visitedNodeIds.push(nearest);
    newlyReached.push({
      nodeId: nearest,
      name: nodesById.get(nearest)?.name ?? null,
      reachable: reachableNeighbours(nearest),
    });
  }

  return {
    newlyReached,
    shouldAnnounce: newlyReached.length > 0,
    visitedCount: session.visitedNodeIds.length,
    token: signSession(session),
  };
}

export interface CompleteFreeRoamInput {
  token: string;
  trackPoints: { lat: number; lng: number; ele?: number; time?: string; accuracy?: number; speed?: number; bearing?: number }[];
  lengthM: number;
  durationMin: number;
  nickname?: string | null;
}

/**
 * Match recorded GPS points to existing network segments so the walk credits
 * usage on paths that already exist (no new segments are created here — that's
 * the GPX-commit job). Returns [nodeChain, segmentIds].
 *
 * Each physical path exists as TWO directed rows (reverseOf each other), so a
 * genuine out-and-back in one walk yields the forward id then the reverse id —
 * both are preserved, and usage accounting (which counts per element) credits
 * each traversal (deep-review #7). No global or consecutive dedupe: a repeated
 * pass must not be silently dropped. (The old code mapped both directions onto
 * the canonical lower id AND deduped globally, so every out-and-back leg was
 * undercounted by one.)
 */
export function matchTrackToNetwork(points: LatLng[]): { nodeChain: number[]; segmentIds: number[] } {
  const nodes = listNodes();
  const segments = listSegments();
  if (points.length === 0) return { nodeChain: [], segmentIds: [] };
  // Bound CPU on very long tracks (API allows up to 10k points): down-sample
  // evenly before the O(nodes × points) nearest-node scan.
  points = capTrackPoints(points);

  const REACH = 40;
  const nodeChain: number[] = [];
  for (const p of points) {
    let best: number | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = haversineMeters({ lat: n.lat, lng: n.lng }, p);
      if (d < bestD && d <= REACH) {
        bestD = d;
        best = n.id;
      }
    }
    if (best != null && nodeChain[nodeChain.length - 1] !== best) nodeChain.push(best);
  }

  // Reconstruct DIRECTED segment ids from consecutive node pairs (both direction
  // rows are in the table, so out-and-back maps to [forwardId, reverseId]).
  const segmentIds: number[] = [];
  const byPair = new Map<string, number>();
  for (const s of segments) {
    byPair.set(`${s.startNodeId}>${s.endNodeId}`, s.id);
  }
  for (let i = 0; i < nodeChain.length - 1; i++) {
    const id = byPair.get(`${nodeChain[i]}>${nodeChain[i + 1]}`);
    if (id != null) segmentIds.push(id);
  }
  return { nodeChain, segmentIds };
}

export function freeRoamWalkBasis(session: FreeRoamSession): {
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
} {
  const { graph } = loadGraphContext();
  // Best-effort stitch: if we started at a node and have visited nodes, build a
  // node chain that simply lists the visited sequence (the app passes the real
  // recorded track for geometry; segmentIds stay empty, meaning "unknown path").
  const chain = session.startNodeId != null ? [session.startNodeId, ...session.visitedNodeIds.filter((id) => id !== session.startNodeId)] : session.visitedNodeIds;
  void graph;
  const deduped = [...new Set(chain)];
  // Ensure every consecutive pair is graph-adjacent; if not, keep them anyway
  // (walk history is informational; the track carries the true geometry).
  return {
    nodeChain: deduped,
    segmentIds: [],
    lengthM: session.lengthM,
    durationMin: session.durationMin,
  };
}
