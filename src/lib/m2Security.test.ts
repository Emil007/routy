import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routy-m2-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");

const { db } = await import("./db");
const {
  getUser,
  setPendingTotpSecret,
  enableTotp,
  cancelPendingTotp,
  disableTotp,
} = await import("./users");
const { createFavorite, enableSharing, getFavoriteByShareToken, disableSharing } = await import("./favorites");

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

describe("M2 — 2FA pending/live separation (F07)", () => {
  it("setting a pending secret does not touch the live factor", () => {
    const u = ensureUser("m2_totp");
    setPendingTotpSecret(u, "LIVEFACTOR");
    const before = getUser(u)!;
    expect(before.totpEnabled).toBe(false);
    expect(before.totpPendingSecret).toBe("LIVEFACTOR");
    expect(before.totpSecret).toBeNull();

    // Confirming promotes pending → live and enables 2FA.
    const enabled = enableTotp(u);
    expect(enabled).toBe(true);
    const after = getUser(u)!;
    expect(after.totpEnabled).toBe(true);
    expect(after.totpSecret).toBe("LIVEFACTOR");
    expect(after.totpPendingSecret).toBeNull();
  });

  it("cancel only clears pending while 2FA is still off", () => {
    const u = ensureUser("m2_cancel");
    setPendingTotpSecret(u, "PENDING1");
    expect(cancelPendingTotp(u)).toBe(true);
    const after = getUser(u)!;
    expect(after.totpPendingSecret).toBeNull();
    expect(after.totpSecret).toBeNull();
    expect(after.totpEnabled).toBe(false);
  });

  it("cancel is a no-op once 2FA is enabled (live factor survives)", () => {
    const u = ensureUser("m2_nocancel");
    setPendingTotpSecret(u, "LIVE1");
    enableTotp(u);
    // A user with 2FA already on tries to cancel: must NOT switch the factor off.
    expect(cancelPendingTotp(u)).toBe(false);
    const after = getUser(u)!;
    expect(after.totpEnabled).toBe(true);
    expect(after.totpSecret).toBe("LIVE1");
  });

  it("disableTotp clears live + pending", () => {
    const u = ensureUser("m2_disable");
    setPendingTotpSecret(u, "LIVE2");
    enableTotp(u);
    disableTotp(u);
    const after = getUser(u)!;
    expect(after.totpSecret).toBeNull();
    expect(after.totpPendingSecret).toBeNull();
    expect(after.totpEnabled).toBe(false);
  });
});

describe("M2 — share link expiry (Q9/F09)", () => {
  const u = ensureUser("m2_share");

  afterAll(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enabling sharing sets a 30-day expiry and re-issues a new token on re-enable", () => {
    const fav = createFavorite(u, "Runde", { nodeChain: [1, 2, 3], segmentIds: [1, 2], lengthM: 200, durationMin: 3 });
    const token1 = enableSharing(fav.id, u);
    expect(token1).not.toBeNull();
    const row1 = db.prepare("SELECT share_expires_at FROM favorite_route WHERE id = ?").get(fav.id) as {
      share_expires_at: string;
    };
    expect(row1.share_expires_at).not.toBeNull();
    // Disable then re-enable → fresh token (Q9: new token per switch-on).
    disableSharing(fav.id, u);
    const token2 = enableSharing(fav.id, u);
    expect(token2).not.toBeNull();
    expect(token2).not.toBe(token1);
    // The new token resolves; the old one is gone.
    expect(getFavoriteByShareToken(token2!)).not.toBeNull();
    expect(getFavoriteByShareToken(token1!)).toBeNull();
  });

  it("an expired token resolves as not-found", () => {
    const fav = createFavorite(u, "Ablauf", { nodeChain: [1, 2], segmentIds: [3], lengthM: 90, durationMin: 1 });
    const token = enableSharing(fav.id, u);
    expect(token).not.toBeNull();
    // Force-expire.
    db.prepare("UPDATE favorite_route SET share_expires_at = datetime('now', '-1 day') WHERE id = ?").run(fav.id);
    expect(getFavoriteByShareToken(token!)).toBeNull();
  });
});
