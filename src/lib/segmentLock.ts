/** Gemeinsame Lock-Prüfung (§9.2). Nur Typ-Import von better-sqlite3-haltigen Modulen. */
export function isLocked(segment: Pick<{ lockedUntil: string | null }, "lockedUntil">): boolean {
  return segment.lockedUntil !== null && segment.lockedUntil > new Date().toISOString();
}
