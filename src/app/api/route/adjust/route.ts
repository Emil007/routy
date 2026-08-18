import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getUsageMap, getDailyUsageMap } from "@/lib/segments";
import { loadGraphContext } from "@/lib/routeContext";
import { findDirectRoutes, findWaypointRoutes, scoreRoutes, pickBest } from "@/lib/routing";
import { getRouteSession, updateRouteSession } from "@/lib/routeSessions";
import { buildRouteDisplay } from "@/lib/routeDisplay";

const bodySchema = z.object({ token: z.string().min(1), direction: z.enum(["longer", "shorter"]) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { token, direction } = parsed.data;

  const session = getRouteSession(token);
  if (!session) return NextResponse.json({ error: "session_expired" }, { status: 410 });

  const settings = getSettings();
  const { graph, pairOf, nodesById, segmentsById } = loadGraphContext();
  const currentValue = session.mode === "km" ? session.current.lengthM : session.current.durationMin;

  // Search a band strictly above/below the current route's length rather than a
  // single new target, so the scorer still has room to prefer the nicest
  // (least-backtracking, least-used) option instead of the one closest to a number.
  function band(stepPercent: number): { minValue: number; maxValue: number } {
    const step = stepPercent / 100;
    if (direction === "longer") {
      return { minValue: currentValue * 1.05, maxValue: currentValue * (1 + step) };
    }
    const minValue = Math.max(currentValue * 0.2, currentValue * (1 - step));
    return { minValue, maxValue: currentValue * 0.95 };
  }

  function search(state: NonNullable<typeof session>, minValue: number, maxValue: number) {
    const candidates =
      state.waypointNodeId && state.waypointNodeId !== state.startNodeId && state.waypointNodeId !== state.destinationNodeId
        ? findWaypointRoutes(graph, pairOf, state.startNodeId, state.waypointNodeId, state.destinationNodeId, state.mode, minValue, maxValue)
        : findDirectRoutes(graph, pairOf, state.startNodeId, state.destinationNodeId, state.mode, minValue, maxValue);

    const usageMap = getUsageMap();
    const dailyMap = getDailyUsageMap();
    const scored = scoreRoutes(
      candidates,
      pairOf,
      usageMap,
      dailyMap,
      settings.daily_diversity_weight,
      state.seenUnion,
      (minValue + maxValue) / 2,
      state.mode,
    );
    return pickBest(scored, state.seenKeys, state.explorerMode);
  }

  const initial = band(settings.adjust_step_percent);
  let best = search(session, initial.minValue, initial.maxValue);
  if (!best) {
    const wider = band(settings.adjust_step_percent * 2);
    best = search(session, wider.minValue, wider.maxValue);
  }
  if (!best) {
    return NextResponse.json({ error: "no_alternative" }, { status: 404 });
  }

  session.seenKeys.add(best.key);
  for (const id of best.route.segmentIds) session.seenUnion.add(id);

  updateRouteSession(token, {
    current: {
      nodeChain: best.route.nodeChain,
      segmentIds: best.route.segmentIds,
      lengthM: best.route.lengthM,
      durationMin: best.route.durationMin,
    },
    seenKeys: session.seenKeys,
    seenUnion: session.seenUnion,
  });

  const display = buildRouteDisplay(
    best.route.nodeChain,
    best.route.segmentIds,
    best.route.lengthM,
    best.route.durationMin,
    nodesById,
    segmentsById,
  );

  return NextResponse.json({ token, route: display });
}
