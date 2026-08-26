import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routy-usage-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { getUsageMap, getDailyUsageMap, recordWalkWithPoints, deleteWalkLogEntry } = await import("./segments");
const { db } = await import("./db");

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

describe("per-user segment usage", () => {
  afterAll(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tracks usage per user independently", () => {
    const u1 = ensureTestUser("usage_u1");
    const u2 = ensureTestUser("usage_u2");
    const id = ensureSegment();

    expect(getUsageMap(u1).get(id) ?? 0).toBe(0);
    const walkId = recordWalkWithPoints(u1, [1, 2], [id], 100, 2, null, null);
    expect(walkId).not.toBeNull();
    expect(getUsageMap(u1).get(id)).toBe(1);
    expect(getUsageMap(u2).get(id) ?? 0).toBe(0);
    deleteWalkLogEntry(walkId!, u1);
    expect(getUsageMap(u1).get(id) ?? 0).toBe(0);
  });

  it("daily usage only counts the acting user's walks", () => {
    const u1 = ensureTestUser("daily_u1");
    const u2 = ensureTestUser("daily_u2");
    const id = ensureSegment();
    const before = getDailyUsageMap(u1).get(id) ?? 0;
    recordWalkWithPoints(u2, [1, 2], [id], 50, 1, null, null);
    expect(getDailyUsageMap(u1).get(id) ?? 0).toBe(before);
    const w = recordWalkWithPoints(u1, [1, 2], [id], 50, 1, null, null);
    expect(getDailyUsageMap(u1).get(id) ?? 0).toBe(before + 1);
    if (w) deleteWalkLogEntry(w, u1);
  });
});
