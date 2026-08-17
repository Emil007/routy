import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSettings, effectiveWalkSpeedKmh } from "@/lib/settings";
import { parseGpx, GpxParseError } from "@/lib/gpx";
import { listNodes, findNodeCandidates, findNameConflict } from "@/lib/nodes";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
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
