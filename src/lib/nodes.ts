import { db } from "./db";
import { type LatLng } from "./geo";

export { type NodeCandidate, findNodeCandidates, findNameConflict } from "./nodeMatching";

export interface NodeRow {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  isHome: boolean;
}

interface NodeDbRow {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  is_home: number;
}

function mapNode(row: NodeDbRow): NodeRow {
  return { id: row.id, name: row.name, lat: row.lat, lng: row.lng, isHome: row.is_home === 1 };
}

export function listNodes(): NodeRow[] {
  const rows = db.prepare("SELECT id, name, lat, lng, is_home FROM nodes ORDER BY id").all() as NodeDbRow[];
  return rows.map(mapNode);
}

export function getNode(id: number): NodeRow | null {
  const row = db.prepare("SELECT id, name, lat, lng, is_home FROM nodes WHERE id = ?").get(id) as
    | NodeDbRow
    | undefined;
  return row ? mapNode(row) : null;
}

export function getHomeNode(): NodeRow | null {
  const row = db.prepare("SELECT id, name, lat, lng, is_home FROM nodes WHERE is_home = 1 LIMIT 1").get() as
    | NodeDbRow
    | undefined;
  return row ? mapNode(row) : null;
}

export function createNode(name: string | null, point: LatLng, isHome = false): NodeRow {
  if (isHome) {
    db.prepare("UPDATE nodes SET is_home = 0 WHERE is_home = 1").run();
  }
  const info = db
    .prepare("INSERT INTO nodes (name, lat, lng, is_home) VALUES (?, ?, ?, ?)")
    .run(name, point.lat, point.lng, isHome ? 1 : 0);
  return getNode(Number(info.lastInsertRowid)) as NodeRow;
}

export function renameNode(id: number, name: string): void {
  db.prepare("UPDATE nodes SET name = ? WHERE id = ?").run(name, id);
}

export function setHomeNode(id: number): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE nodes SET is_home = 0 WHERE is_home = 1").run();
    db.prepare("UPDATE nodes SET is_home = 1 WHERE id = ?").run(id);
  });
  tx();
}

