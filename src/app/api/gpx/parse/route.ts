import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { parseGpx, GpxParseError } from "@/lib/gpx";
import { listNodes, findNodeCandidates, findNameConflict } from "@/lib/nodes";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { getClientIp } from "@/lib/loginRateLimit";

/** Max upload size for GPX parse (bytes). */
export const GPX_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Max points on a single track. */
export const GPX_MAX_POINTS_PER_TRACK = 20_000;
/** Max points across all tracks in one parse. */
export const GPX_MAX_POINTS_TOTAL = 50_000;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rate = checkApiRateLimit("gpx_parse", { userId: user.id, ip: await getClientIp() });
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > GPX_MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: GPX_MAX_FILE_BYTES },
      { status: 413 },
    );
  }

  const text = await file.text();
  const settings = getSettings();

  let tracks;
  try {
    tracks = parseGpx(text, effectiveWalkSpeedKmh(user.walkSpeedKmh, settings));
  } catch (err) {
    if (err instanceof GpxParseError) {
      return NextResponse.json({ error: "parse_error", message: err.message }, { status: 400 });
    }
    throw err;
  }

  if (tracks.length === 0) {
    return NextResponse.json({ error: "no_tracks" }, { status: 400 });
  }

  let totalPoints = 0;
  for (const track of tracks) {
    if (track.points.length > GPX_MAX_POINTS_PER_TRACK) {
      return NextResponse.json(
        { error: "too_many_points", maxPerTrack: GPX_MAX_POINTS_PER_TRACK },
        { status: 400 },
      );
    }
    totalPoints += track.points.length;
  }
  if (totalPoints > GPX_MAX_POINTS_TOTAL) {
    return NextResponse.json(
      { error: "too_many_points", maxTotal: GPX_MAX_POINTS_TOTAL },
      { status: 400 },
    );
  }

  const nodes = listNodes();

  const preview = tracks.map((track, index) => {
    const start = track.points[0];
    const end = track.points[track.points.length - 1];
    return {
      index,
      name: track.name,
      points: track.points,
      lengthM: track.lengthM,
      durationMin: track.durationMin,
      elevation: track.elevation,
      startNameGuess: track.startNameGuess,
      endNameGuess: track.endNameGuess,
      startCandidates: findNodeCandidates(nodes, start, settings.merge_radius_m),
      endCandidates: findNodeCandidates(nodes, end, settings.merge_radius_m),
      startNameConflict: findNameConflict(nodes, start, track.startNameGuess, settings.name_far_warn_m),
      endNameConflict: findNameConflict(nodes, end, track.endNameGuess, settings.name_far_warn_m),
    };
  });

  return NextResponse.json({ tracks: preview });
}
