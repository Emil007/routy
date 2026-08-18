import { db } from "./db";

export interface FavoriteRoute {
  id: number;
  userId: number;
  name: string;
  nodeChain: number[];
  segmentIds: number[];
  lengthM: number;
  durationMin: number;
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
  route: { nodeChain: number[]; segmentIds: number[]; lengthM: number; durationMin: number },
): FavoriteRoute {
  const info = db
    .prepare(
      "INSERT INTO favorite_route (user_id, name, node_chain, segment_ids, length_m, duration_min) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(userId, name, JSON.stringify(route.nodeChain), JSON.stringify(route.segmentIds), route.lengthM, route.durationMin);
  return getFavorite(Number(info.lastInsertRowid), userId)!;
}

export function deleteFavorite(id: number, userId: number): boolean {
  const info = db.prepare("DELETE FROM favorite_route WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes > 0;
}

export function favoriteCount(userId: number): number {
  const row = db.prepare("SELECT COUNT(*) c FROM favorite_route WHERE user_id = ?").get(userId) as { c: number };
  return row.c;
}
