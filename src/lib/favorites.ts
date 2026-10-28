import { db } from "./db";
import { randomBytes } from "node:crypto";
import { lengthFromSegmentIds } from "./segments";
import { estimateMinutes } from "./geo";

export interface FavoriteRoute {
  id: number;
  userId: number;
  name: string;
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
  shareToken: string | null;
  shareExpiresAt: string | null;
  createdAt: string;
}

interface FavoriteRouteDbRow {
  id: number;
  user_id: number;
  name: string;
  node_chain: string;
  segment_ids: string;
  length_m: number;
  duration_min: number;
  share_token: string | null;
  share_expires_at: string | null;
  created_at: string;
}

function mapRow(row: FavoriteRouteDbRow): FavoriteRoute {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nodeChain: JSON.parse(row.node_chain) as number[],
    segmentIds: JSON.parse(row.segment_ids) as number[],
    lengthM: row.length_m,
    durationMin: row.duration_min,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
  };
}

export function listFavorites(userId: number): FavoriteRoute[] {
  const rows = db
    .prepare("SELECT * FROM favorite_route WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as FavoriteRouteDbRow[];
  return rows.map(mapRow);
}

export function getFavorite(id: number, userId: number): FavoriteRoute | null {
  const row = db.prepare("SELECT * FROM favorite_route WHERE id = ? AND user_id = ?").get(id, userId) as
    | FavoriteRouteDbRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createFavorite(
  userId: number,
  name: string,
  route: {
    nodeChain: number[];
    segmentIds: number[];
    lengthM?: number;
    durationMin?: number;
    walkSpeedKmh?: number;
  },
): FavoriteRoute {
  // F02: never trust a client-supplied length for what a favorite stores — the
  // real length comes from the segment table, so a spoofed lengthM can't inflate
  // later point crediting via active_route.
  const storedLengthM = lengthFromSegmentIds(route.segmentIds);
  const lengthM = storedLengthM ?? Math.round(route.lengthM ?? 0);
  const durationMin =
    route.durationMin ??
    (storedLengthM != null ? estimateMinutes(storedLengthM, route.walkSpeedKmh ?? 5) : Math.round(route.lengthM ?? 0));
  const info = db
    .prepare(
      "INSERT INTO favorite_route (user_id, name, node_chain, segment_ids, length_m, duration_min) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(userId, name, JSON.stringify(route.nodeChain), JSON.stringify(route.segmentIds), lengthM, durationMin);
  return getFavorite(Number(info.lastInsertRowid), userId)!;
}

export function deleteFavorite(id: number, userId: number): boolean {
  const info = db.prepare("DELETE FROM favorite_route WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes > 0;
}

/** Generates (or returns the existing) share token, scoped to the owner. Returns null if not found/not owned. */
export function enableSharing(id: number, userId: number): string | null {
  const existing = getFavorite(id, userId);
  if (!existing) return null;
  // Q9 (decided 2026-10-28): re-issuing a fresh token on every toggle and expiring
  // it after 30 days bounds the blast radius of a leaked link.
  if (existing.shareToken) {
    const stillValid = db
      .prepare(
        "SELECT share_expires_at FROM favorite_route WHERE id = ? AND share_token IS NOT NULL AND (share_expires_at IS NULL OR datetime(share_expires_at) > datetime('now'))",
      )
      .get(id) as { share_expires_at: string | null } | undefined;
    if (stillValid) return existing.shareToken;
  }
  const token = randomBytes(16).toString("hex");
  db.prepare(
    "UPDATE favorite_route SET share_token = ?, share_expires_at = datetime('now', '+30 days') WHERE id = ? AND user_id = ?",
  ).run(token, id, userId);
  return token;
}

export function disableSharing(id: number, userId: number): void {
  db.prepare("UPDATE favorite_route SET share_token = NULL, share_expires_at = NULL WHERE id = ? AND user_id = ?").run(
    id,
    userId,
  );
}

/** Unscoped by design — this is how a share link is meant to be looked up by anyone holding it, no session required. */
export function getFavoriteByShareToken(token: string): FavoriteRoute | null {
  // F09/Q9: expired tokens are treated as not found.
  const row = db
    .prepare(
      "SELECT * FROM favorite_route WHERE share_token = ? AND (share_expires_at IS NULL OR datetime(share_expires_at) > datetime('now'))",
    )
    .get(token) as
    | FavoriteRouteDbRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function favoriteCount(userId: number): number {
  const row = db.prepare("SELECT COUNT(*) c FROM favorite_route WHERE user_id = ?").get(userId) as { c: number };
  return row.c;
}
