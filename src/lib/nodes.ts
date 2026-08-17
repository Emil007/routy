import { db } from "./db";
import { type LatLng, haversineMeters } from "./geo";

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

export interface NodeCandidate {
  id: number;
  name: string | null;
  lat: number;
  lng: number;
  distanceM: number;
}

export function findNodeCandidates(nodes: NodeRow[], point: LatLng, radiusM: number): NodeCandidate[] {
  return nodes
    .map((n) => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, distanceM: haversineMeters(point, n) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Finds an existing node with the same name guess but suspiciously far away. */
export function findNameConflict(
  nodes: NodeRow[],
  point: LatLng,
  nameGuess: string | null,
  warnDistanceM: number,
): NodeCandidate | null {
  if (!nameGuess) return null;
  let best: NodeCandidate | null = null;
  for (const n of nodes) {
    if (n.name === nameGuess) {
      const d = haversineMeters(point, n);
      if (d > warnDistanceM && (!best || d < best.distanceM)) {
        best = { id: n.id, name: n.name, lat: n.lat, lng: n.lng, distanceM: d };
      }
    }
  }
  return best;
}
