import { describe, expect, it, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routy-m1-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { db } = await import("./db");
const {
  createNode,
} = await import("./nodes");
const {
  createSegmentWithReverse,
  lengthFromSegmentIds,
  segmentLengthFromPoints,
  applyGpsHopDurationIfMissing,
} = await import("./segments");
const { setActiveRoute, getActiveRoute, clearActiveRoute } = await import("./activeRoute");
import type { LatLng } from "./geo";

function ensureUser(username: string): number {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  return Number(
    db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, locale)
         VALUES (?, 'x', ?, 'en')`,
      )
      .run(username, username).lastInsertRowid,
  );
}

const points: LatLng[] = [
  { lat: 50, lng: 8 },
  { lat: 50.0005, lng: 8 },
  { lat: 50.001, lng: 8 },
];

beforeAll(() => {
  // ~11 m / ~22 m / ~33 m from node; create nodes right at the endpoints.
});

describe("M1 — segment length is server-computed", () => {
  it("stores the geometry-derived length, not the client-supplied lengthM", () => {
    const n1 = createNode("a", points[0], false, null);
    const n2 = createNode("b", points[points.length - 1], false, null);
    const { forwardId } = createSegmentWithReverse({
      startNodeId: n1.id,
      endNodeId: n2.id,
      points,
      // Client claims 1 m — must be ignored for what is stored.
      lengthM: 1,
      durationMin: 1,
      elevation: null,
      source: "gpx",
      submittedBy: ensureUser("m1_spoof"),
    });
    const seg = db.prepare("SELECT length_m, duration_min FROM segments WHERE id = ?").get(forwardId) as {
      length_m: number;
      duration_min: number;
    };
    expect(seg.length_m).toBeGreaterThan(5);
    expect(seg.length_m).toBe(segmentLengthFromPoints(points));
    expect(seg.duration_min).toBeGreaterThan(0);
  });

  it("rejects a geometry far from the endpoint nodes", () => {
    const n1 = createNode("far1", { lat: 50, lng: 8 }, false, null);
    const n2 = createNode("far2", { lat: 50.2, lng: 8.2 }, false, null);
    expect(() =>
      createSegmentWithReverse({
        startNodeId: n1.id,
        endNodeId: n2.id,
        points,
        elevation: null,
        source: "gpx",
        submittedBy: ensureUser("m1_band"),
      }),
    ).toThrow(/band/);
  });

  it("lengthFromSegmentIds sums every directed pass and rejects stale ids (M28)", () => {
    const n1 = createNode("l1", points[0], false, null);
    const n2 = createNode("l2", points[points.length - 1], false, null);
    const { forwardId, reverseId } = createSegmentWithReverse({
      startNodeId: n1.id,
      endNodeId: n2.id,
      points,
      elevation: null,
      source: "drawn",
      submittedBy: ensureUser("m1_len"),
    });
    // M28 (F40): jede gerichtete Begehung zählt — ein Hin-und-zurück-Track führt
    // die Kante in beide Richtungen, also zählt sie doppelt (echte gelaufene Länge).
    const total = lengthFromSegmentIds([forwardId, reverseId]);
    expect(total).toBe(segmentLengthFromPoints(points) * 2);
    // Ein einzelner Durchlauf zählt einmal.
    expect(lengthFromSegmentIds([forwardId])).toBe(segmentLengthFromPoints(points));
    // Unknown id → null (route is stale, don't trust a client length).
    expect(lengthFromSegmentIds([999_999])).toBeNull();
  });

  it("does not overwrite another profile's segment timing (F04)", () => {
    const owner = ensureUser("m1_owner");
    const stranger = ensureUser("m1_stranger");
    const n1 = createNode("t1", points[0], false, null);
    const n2 = createNode("t2", points[points.length - 1], false, null);
    const { forwardId } = createSegmentWithReverse({
      startNodeId: n1.id,
      endNodeId: n2.id,
      points,
      elevation: null,
      source: "gpx",
      submittedBy: owner,
    });
    const before = (
      db.prepare("SELECT duration_min FROM segments WHERE id = ?").get(forwardId) as { duration_min: number }
    ).duration_min;
    // Stranger tries to retime: must be a no-op (not owner).
    applyGpsHopDurationIfMissing(forwardId, 2, { walkUserId: stranger });
    const afterStranger = (
      db.prepare("SELECT duration_min FROM segments WHERE id = ?").get(forwardId) as { duration_min: number }
    ).duration_min;
    expect(afterStranger).toBe(before);
    // Owner may: a plausible ~6 km/h walk (~2 min for the ~220 m segment) writes.
    applyGpsHopDurationIfMissing(forwardId, 2, { walkUserId: owner });
    const afterOwner = (
      db.prepare("SELECT duration_min FROM segments WHERE id = ?").get(forwardId) as { duration_min: number }
    ).duration_min;
    expect(afterOwner).toBe(2);
    // Implausible timing (driving-fast) from the owner is still rejected (band).
    applyGpsHopDurationIfMissing(forwardId, 1, { walkUserId: owner });
    expect(
      (db.prepare("SELECT duration_min FROM segments WHERE id = ?").get(forwardId) as { duration_min: number })
        .duration_min,
    ).toBe(2);
  });
});

describe("M1 — active route replace semantics", () => {
  let userId: number;
  beforeAll(() => {
    userId = ensureUser("m1_ar");
  });

  afterAll(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a second accept without replace (409 contract)", () => {
    clearActiveRoute(userId);
    const routeA = { nodeChain: [1, 2], segmentIds: [1, 2], lengthM: 100, durationMin: 2 };
    const routeB = { nodeChain: [2, 3], segmentIds: [3, 4], lengthM: 200, durationMin: 4 };
    expect(setActiveRoute(userId, routeA)).toBe(true);
    // Second accept without replace → false (caller responds 409).
    expect(setActiveRoute(userId, routeB)).toBe(false);
    expect(getActiveRoute(userId)?.segmentIds).toEqual([1, 2]);
    // With replace → overwrites.
    expect(setActiveRoute(userId, routeB)).toBe(false);
    expect(setActiveRoute(userId, routeB, { replace: true })).toBe(true);
    expect(getActiveRoute(userId)?.segmentIds).toEqual([3, 4]);
  });
});
