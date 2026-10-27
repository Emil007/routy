// Free-roam tests run against the local development DB copy (data/routy.db) so
// reachability actually resolves against a realistic network. The free-roam
// session store is in-memory and never writes to this DB, so tests are side
// effect free. If the DB is missing (e.g. CI checkout without data/), the suite
// is skipped like routing.regression.test.ts.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DB = path.join(process.cwd(), "data", "routy.db");
const available = existsSync(DB);
if (available) {
  process.env.DATABASE_PATH = DB;
} else {
  process.env.VITEST_NO_DB = "1";
}

const { listNodes } = available ? await import("./nodes") : ({} as never);
const {
  createFreeRoamSession,
  getFreeRoamSession,
  checkinFreeRoam,
  reachableNeighbours,
  assertFreeRoamOwner,
  matchTrackToNetwork,
  signSession,
  FREE_ROAM_REACH_M,
} = available ? await import("./freeRoam") : ({} as never);

describe.skipIf(!available)("free roam session (data/routy.db)", () => {
  it("creates a session and picks the nearest start node", () => {
    const nodes = listNodes();
    expect(nodes.length).toBeGreaterThan(0);
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    const token = createFreeRoamSession(1, { lat: home.lat, lng: home.lng });
    const session = getFreeRoamSession(token);
    expect(session).not.toBeNull();
    expect(session!.startNodeId).toBe(home.id);
    expect(session!.visitedNodeIds).toContain(home.id);
    expect(session!.announcedNodeIds).toContain(home.id);
  });

  it("exposes one-hop reachable neighbours with distances", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    const neighbours = reachableNeighbours(home.id);
    expect(neighbours.length).toBeGreaterThan(0);
    for (const nb of neighbours) {
      expect(nb.nodeId).toBeGreaterThan(0);
      expect(nb.distanceM).toBeGreaterThan(0);
    }
  });

  it("announces a newly reached node on checkin, then dedupes", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    let token = createFreeRoamSession(1, { lat: home.lat, lng: home.lng });
    const neighbours = reachableNeighbours(home.id);
    expect(neighbours.length).toBeGreaterThan(0);
    const target = neighbours[0]!;
    const targetNode = nodes.find((n: { id: number }) => n.id === target.nodeId)!;

    let reachedAt: number | null = null;
    const steps = 40;
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const p = {
        lat: home.lat + (targetNode.lat - home.lat) * f,
        lng: home.lng + (targetNode.lng - home.lng) * f,
      };
      const r = checkinFreeRoam(token, p);
      // Stateless sessions (decision K): each checkin rotates the token.
      token = r.token;
      if (r.shouldAnnounce && reachedAt == null) reachedAt = k;
    }
    expect(reachedAt).not.toBeNull();
    expect(token).toContain("."); // signed token format <payload>.<sig>
    const session = getFreeRoamSession(token)!;
    expect(session.visitedNodeIds.length).toBeGreaterThanOrEqual(2);

    const lastVisited = session.visitedNodeIds[session.visitedNodeIds.length - 1]!;
    const again = checkinFreeRoam(token, { lat: targetNode.lat, lng: targetNode.lng });
    expect(again.newlyReached.some((n: { nodeId: number }) => n.nodeId === lastVisited)).toBe(false);
  });

  it("owner checks reject a foreign user", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    const token = createFreeRoamSession(1, { lat: home.lat, lng: home.lng });
    expect(assertFreeRoamOwner(token, 1)).not.toBe("forbidden");
    expect(assertFreeRoamOwner(token, 99)).toBe("forbidden");
  });

  it("reach radius is a sane 30m", () => {
    expect(FREE_ROAM_REACH_M).toBe(30);
  });

  it("accumulates lengthM and durationMin across checkins (deep-review #6)", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    let token = createFreeRoamSession(1, { lat: home.lat, lng: home.lng });
    const n1 = getFreeRoamSession(token)!;
    expect(n1.lengthM).toBe(0);
    // Move ~100 m in one degree-ish step so the estimate grows.
    const dLat = 100 / 110574; // ≈100 m north
    const r = checkinFreeRoam(token, { lat: home.lat + dLat, lng: home.lng });
    // Stateless rotation: read the accumulated length from the FRESH token.
    const n2 = getFreeRoamSession(r.token)!;
    expect(n2.lengthM).toBeGreaterThan(50);
    expect(n2.lengthM).toBeLessThan(300);
    // durationMin reflects elapsed wall time (>= 0).
    expect(n2.durationMin).toBeGreaterThanOrEqual(0);
    token = r.token;
  });

  it("expires a stale session on access (deep-review #5)", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    const fresh = createFreeRoamSession(1, { lat: home.lat, lng: home.lng });
    expect(getFreeRoamSession(fresh)).not.toBeNull();
    // Stateless tokens carry startedAt inside the signed payload. Re-sign a
    // session whose startedAt predates the 12h TTL — access must reject it.
    const staleSession = {
      userId: 1,
      startNodeId: null,
      startLat: home.lat,
      startLng: home.lng,
      visitedNodeIds: [],
      announcedNodeIds: [],
      lengthM: 0,
      durationMin: 0,
      startedAt: Date.now() - (13 * 60 * 60 * 1000),
      lastLat: null,
      lastLng: null,
    };
    const staleToken = signSession(staleSession);
    expect(getFreeRoamSession(staleToken)).toBeNull();
  });

  it("matchTrackToNetwork preserves directed out-and-back traversals (deep-review #7)", () => {
    const nodes = listNodes();
    const home = nodes.find((n: { isHome: boolean }) => n.isHome) ?? nodes[0]!;
    const nb = reachableNeighbours(home.id)[0]!;
    const target = nodes.find((n: { id: number }) => n.id === nb.nodeId)!;
    // Clean there-and-back on the same physical path: should yield TWO directed
    // segment ids (forward + reverse), not a single canonicalized id.
    const { segmentIds } = matchTrackToNetwork!([
      { lat: home.lat, lng: home.lng },
      { lat: target.lat, lng: target.lng },
      { lat: home.lat, lng: home.lng },
    ]);
    expect(segmentIds.length).toBe(2);
    // The two ids must be a reverse pair (different rows, same physical path).
    expect(segmentIds[0]).not.toBe(segmentIds[1]);
  });
});
