import { db } from "./db";

export interface ActivityLogRow {
  id: number;
  userId: number | null;
  userDisplayName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityLogDbRow {
  id: number;
  user_id: number | null;
  user_display_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string | null;
  created_at: string;
}

function mapRow(row: ActivityLogDbRow): ActivityLogRow {
  return {
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

export function logActivity(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  details?: Record<string, unknown>,
): void {
  db.prepare(
    "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, action, entityType, entityId, details ? JSON.stringify(details) : null);
}

export function listActivity(limit = 200): ActivityLogRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, u.display_name as user_display_name, a.action, a.entity_type, a.entity_id, a.details, a.created_at
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC
       LIMIT ?`,
    )
    .all(limit) as ActivityLogDbRow[];
  return rows.map(mapRow);
}
