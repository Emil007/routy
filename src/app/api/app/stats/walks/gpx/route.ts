import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { buildWalkGpx } from "@/lib/gpx";

function parseTrack(raw: string | null): { lat: number; lng: number; ele?: number; time?: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { lat: number; lng: number; ele?: number; time?: string }[];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p.lat === "number" && typeof p.lng === "number") : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const walkId = Number(new URL(request.url).searchParams.get("walkId"));
  if (!Number.isFinite(walkId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const row = db
    .prepare(
      `SELECT w.id, w.nickname, w.accepted_at, w.track_json, wt.points_json AS wt_points
       FROM walk_log w
       LEFT JOIN walk_track wt ON wt.walk_id = w.id
       WHERE w.id = ? AND w.user_id = ?`,
    )
    .get(walkId, user.id) as
    | { id: number; nickname: string | null; accepted_at: string; track_json: string | null; wt_points: string | null }
    | undefined;

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const points = row.wt_points ? parseTrack(row.wt_points) : parseTrack(row.track_json);
  if (points.length < 2) return NextResponse.json({ error: "no_track" }, { status: 404 });

  const name = row.nickname?.trim() || `Routy walk ${row.accepted_at.slice(0, 10)}`;
  const gpx = buildWalkGpx({ name, points, description: `Routy walk #${row.id}` });
  const filename = `routy-walk-${row.id}.gpx`;

  return new NextResponse(gpx, {
    status: 200,
    headers: {
      "Content-Type": "application/gpx+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
