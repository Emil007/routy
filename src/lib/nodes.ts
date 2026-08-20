import { db } from "./db";
import { type LatLng } from "./geo";

export { type NodeCandidate, findNodeCandidates, findNameConflict } from "./nodeMatching";

export interface NodeNameParts {
  part1Id: number | null;
  part2Id: number | null;
  separator: string;
}

export interface NodeRow {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  isHome: boolean;
  createdBy: number | null;
  namePart1Id: number | null;
  namePart2Id: number | null;
  nameSeparator: string;
  /** Resolved text of the linked parts (joined in), for pre-filling rename UI — null when unlinked. */
  namePart1Text: string | null;
  namePart2Text: string | null;
  deletedAt: string | null;
}

interface NodeDbRow {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  is_home: number;
  created_by: number | null;
  name_part_1_id: number | null;
  name_part_2_id: number | null;
  name_separator: string;
  name_part_1_text: string | null;
  name_part_2_text: string | null;
  deleted_at: string | null;
}

function mapNode(row: NodeDbRow): NodeRow {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    isHome: row.is_home === 1,
    createdBy: row.created_by,
    namePart1Id: row.name_part_1_id,
    namePart2Id: row.name_part_2_id,
    nameSeparator: row.name_separator,
    namePart1Text: row.name_part_1_text,
    namePart2Text: row.name_part_2_text,
    deletedAt: row.deleted_at,
  };
}

const NODE_COLUMNS = `
  n.id, n.name, n.lat, n.lng, n.is_home, n.created_by, n.name_part_1_id, n.name_part_2_id, n.name_separator,
  n.deleted_at, p1.text as name_part_1_text, p2.text as name_part_2_text
`;
const NODE_JOIN = `
  FROM nodes n
  LEFT JOIN name_parts p1 ON p1.id = n.name_part_1_id
  LEFT JOIN name_parts p2 ON p2.id = n.name_part_2_id
`;

export function listNodes(): NodeRow[] {
  const rows = db.prepare(`SELECT ${NODE_COLUMNS} ${NODE_JOIN} WHERE n.active = 1 ORDER BY n.id`).all() as NodeDbRow[];
  return rows.map(mapNode);
}

/** Soft-deleted nodes, most recently deleted first — for the trash/restore UI. */
export function listDeletedNodes(): NodeRow[] {
  const rows = db
    .prepare(`SELECT ${NODE_COLUMNS} ${NODE_JOIN} WHERE n.active = 0 ORDER BY n.deleted_at DESC`)
    .all() as NodeDbRow[];
  return rows.map(mapNode);
}

export function getNode(id: number): NodeRow | null {
  const row = db.prepare(`SELECT ${NODE_COLUMNS} ${NODE_JOIN} WHERE n.id = ?`).get(id) as NodeDbRow | undefined;
  return row ? mapNode(row) : null;
}

export function getHomeNode(): NodeRow | null {
  const row = db.prepare(`SELECT ${NODE_COLUMNS} ${NODE_JOIN} WHERE n.is_home = 1 LIMIT 1`).get() as
    | NodeDbRow
    | undefined;
  return row ? mapNode(row) : null;
}

/**
 * Per-user home (preferred). Returns null when unset — clients pick a first node
 * or ask the user to set home. Does not fall back to global nodes.is_home
 * (legacy flag remains for migration/display only).
 */
export function getUserHomeNode(userId: number): NodeRow | null {
  const row = db
    .prepare(
      `SELECT ${NODE_COLUMNS}
       FROM users u
       INNER JOIN nodes n ON n.id = u.home_node_id
       LEFT JOIN name_parts p1 ON p1.id = n.name_part_1_id
       LEFT JOIN name_parts p2 ON p2.id = n.name_part_2_id
       WHERE u.id = ? AND n.active = 1`,
    )
    .get(userId) as NodeDbRow | undefined;
  return row ? mapNode(row) : null;
}

export function getUserHomeNodeId(userId: number): number | null {
  const row = db.prepare("SELECT home_node_id FROM users WHERE id = ?").get(userId) as
    | { home_node_id: number | null }
    | undefined;
  return row?.home_node_id ?? null;
}

/** Sets only this user's home_node_id — never touches other users or nodes.is_home. */
export function setUserHomeNode(userId: number, nodeId: number): void {
  db.prepare("UPDATE users SET home_node_id = ? WHERE id = ?").run(nodeId, userId);
}

export function createNode(
  name: string | null,
  point: LatLng,
  isHome = false,
  createdBy: number | null = null,
  nameParts?: NodeNameParts,
): NodeRow {
  // isHome still writes legacy nodes.is_home for older clients; prefer setUserHomeNode for user actions.
  if (isHome) {
    db.prepare("UPDATE nodes SET is_home = 0 WHERE is_home = 1").run();
  }
  const info = db
    .prepare(
      "INSERT INTO nodes (name, lat, lng, is_home, created_by, name_part_1_id, name_part_2_id, name_separator) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      name,
      point.lat,
      point.lng,
      isHome ? 1 : 0,
      createdBy,
      nameParts?.part1Id ?? null,
      nameParts?.part2Id ?? null,
      nameParts?.separator ?? "/",
    );
  return getNode(Number(info.lastInsertRowid)) as NodeRow;
}

export function renameNode(id: number, name: string, nameParts?: NodeNameParts): void {
  db.prepare(
    "UPDATE nodes SET name = ?, name_part_1_id = ?, name_part_2_id = ?, name_separator = ? WHERE id = ?",
  ).run(name, nameParts?.part1Id ?? null, nameParts?.part2Id ?? null, nameParts?.separator ?? "/", id);
}

export function updateNodePosition(id: number, point: LatLng): void {
  db.prepare("UPDATE nodes SET lat = ?, lng = ? WHERE id = ?").run(point.lat, point.lng, id);
}

/** Also soft-deletes every currently-active segment touching this node, mirroring the FK cascade a hard delete would do. */
export function deleteNode(id: number): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE nodes SET active = 0, deleted_at = datetime('now') WHERE id = ?").run(id);
    db.prepare(
      "UPDATE segments SET active = 0, deleted_at = datetime('now') WHERE (start_node_id = ? OR end_node_id = ?) AND active = 1",
    ).run(id, id);
  });
  tx();
}

export function restoreNode(id: number): void {
  const row = db.prepare("SELECT deleted_at FROM nodes WHERE id = ?").get(id) as { deleted_at: string | null } | undefined;
  const deletedAt = row?.deleted_at;
  const tx = db.transaction(() => {
    db.prepare("UPDATE nodes SET active = 1, deleted_at = NULL WHERE id = ?").run(id);
    if (deletedAt) {
      db.prepare(
        "UPDATE segments SET active = 1, deleted_at = NULL WHERE (start_node_id = ? OR end_node_id = ?) AND active = 0 AND deleted_at = ?",
      ).run(id, id, deletedAt);
    }
  });
  tx();
}

/** Irreversible. Cascades to every segment touching this node via the FK. */
export function purgeNode(id: number): void {
  db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
}

/** @deprecated Prefer setUserHomeNode — writes legacy global nodes.is_home only. */
export function setHomeNode(id: number): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE nodes SET is_home = 0 WHERE is_home = 1").run();
    db.prepare("UPDATE nodes SET is_home = 1 WHERE id = ?").run(id);
  });
  tx();
}
