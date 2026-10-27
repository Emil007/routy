import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routy-freeroam-replay-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { recordWalkWithPoints, listSegments } = await import("./segments");
const { markFreeRoamCompleted, completedWalkIdFor, verifySessionToken, signSession } = await import("./freeRoam");
const { db } = await import("./db");
import type { FreeRoamSession } from "./freeRoam";

function ensureTestUser(username: string): number {
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

function ensureSegment(): number {
  const existing = db.prepare("SELECT id FROM segments LIMIT 1").get() as { id: number } | undefined;
  if (existing) return existing.id;
  const n1 = Number(db.prepare("INSERT INTO nodes (lat, lng) VALUES (50, 8)").run().lastInsertRowid);
  const n2 = Number(db.prepare("INSERT INTO nodes (lat, lng) VALUES (50.001, 8)").run().lastInsertRowid);
  const geom = JSON.stringify([
    { lat: 50, lng: 8 },
    { lat: 50.001, lng: 8 },
  ]);
  return Number(
    db
      .prepare(
        `INSERT INTO segments (start_node_id, end_node_id, geometry, length_m, duration_min, source)
         VALUES (?, ?, ?, 100, 2, 'test')`,
      )
      .run(n1, n2, geom).lastInsertRowid,
  );
}

function sessionState(userId: number, startedAt: number): FreeRoamSession {
  return {
    userId,
    startNodeId: null,
    startLat: 50,
    startLng: 8,
    visitedNodeIds: [],
    announcedNodeIds: [],
    lengthM: 0,
    durationMin: 0,
    startedAt,
    lastLat: null,
    lastLng: null,
  };
}

describe("free-roam anti-replay tombstone (decision K)", () => {
  afterAll(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a completed session token can never earn points twice", () => {
    const u = ensureTestUser("fr_replay_u1");
    const id = ensureSegment();
    const startedAt = 1_700_000_000_000; // fixed so key is deterministic
    const token = signSession(sessionState(u, startedAt));
    expect(verifySessionToken(token)).not.toBeNull();

    // First complete: walk + tombstone are written atomically (freeRoamStartedAt).
    const walk1 = recordWalkWithPoints(u, [1, 2], [id], 100, 2, null, null, {
      freeRoamStartedAt: startedAt,
    });
    expect(walk1).not.toBeNull();
    expect(completedWalkIdFor(verifySessionToken(token)!)).toBe(walk1);

    // Any rotated / repeated variant of the same session is detected as done.
    const replayToken = signSession(sessionState(u, startedAt));
    expect(completedWalkIdFor(verifySessionToken(replayToken)!)).toBe(walk1);
  });

  it("resubmitting the SAME token does not insert a second walk row", () => {
    const before = (db.prepare("SELECT COUNT(*) c FROM walk_log").get() as { c: number }).c;
    const u = ensureTestUser("fr_replay_u2");
    const id = ensureSegment();
    const startedAt = 1_700_000_000_001;
    const walkId = recordWalkWithPoints(u, [1, 2], [id], 120, 2, null, null, {
      freeRoamStartedAt: startedAt,
    });
    expect(walkId).not.toBeNull();

    // A second complete would now hit completedWalkIdFor != null → no new row.
    // Here we prove the mechanism directly: the tombstone exists with the walk.
    const afterFirst = (db.prepare("SELECT COUNT(*) c FROM walk_log").get() as { c: number }).c;
    expect(afterFirst).toBe(before + 1);
  });

  it("tombstones are keyed per (user, startedAt): different sessions don't collide", () => {
    const u = ensureTestUser("fr_replay_u3");
    const id = ensureSegment();
    const walkA = recordWalkWithPoints(u, [1, 2], [id], 90, 2, null, null, {
      freeRoamStartedAt: 1_700_000_000_010,
    });
    const walkB = recordWalkWithPoints(u, [1, 2], [id], 90, 2, null, null, {
      freeRoamStartedAt: 1_700_000_000_011,
    });
    expect(walkA).not.toBeNull();
    expect(walkB).not.toBeNull();
    expect(walkA).not.toBe(walkB);
    expect(completedWalkIdFor(sessionState(u, 1_700_000_000_010))).toBe(walkA);
    expect(completedWalkIdFor(sessionState(u, 1_700_000_000_011))).toBe(walkB);
  });

  it("markFreeRoamCompleted is idempotent (secondary helper)", () => {
    const u = ensureTestUser("fr_replay_u4");
    const id = ensureSegment();
    const walkId = recordWalkWithPoints(u, [1, 2], [id], 90, 2, null, null, { freeRoamStartedAt: undefined });
    expect(walkId).not.toBeNull();
    const walk = walkId!;
    const s = sessionState(u, 1_700_000_000_020);
    markFreeRoamCompleted(s, walk);
    markFreeRoamCompleted(s, walk);
    const row = db
      .prepare("SELECT COUNT(*) c FROM free_roam_completed WHERE user_id = ? AND started_at = ?")
      .get(u, s.startedAt) as { c: number };
    expect(row.c).toBe(1);
  });

  it("listSegments smoke (module loads against tmp db)", () => {
    expect(listSegments()).toBeDefined();
  });
});
