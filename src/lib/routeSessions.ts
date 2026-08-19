import { randomBytes } from "node:crypto";
import type { RouteMode } from "./routing";

export interface RouteSessionState {
  userId: number;
  mode: RouteMode;
  targetValue: number;
  startNodeId: number;
  destinationNodeId: number;
  waypointNodeId: number | null;
  explorerMode: boolean;
  surpriseMode: boolean;
  current: {
    nodeChain: number[];
    segmentIds: number[];
    lengthM: number;
    durationMin: number;
  };
  seenKeys: Set<string>;
  seenUnion: Set<number>;
  widenSteps: number;
  createdAt: number;
}

declare global {
   
  var __routySessions: Map<string, RouteSessionState> | undefined;
}

const store: Map<string, RouteSessionState> = globalThis.__routySessions ?? new Map();
globalThis.__routySessions = store;

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h — generous for an in-memory "pick a route" flow

function sweep() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.createdAt > SESSION_TTL_MS) store.delete(key);
  }
}

export function createRouteSession(state: Omit<RouteSessionState, "createdAt">): string {
  sweep();
  const token = randomBytes(16).toString("hex");
  store.set(token, { ...state, createdAt: Date.now() });
  return token;
}

export function getRouteSession(token: string): RouteSessionState | null {
  return store.get(token) ?? null;
}

export function assertRouteSessionOwner(token: string, userId: number): RouteSessionState | "missing" | "forbidden" {
  const session = getRouteSession(token);
  if (!session) return "missing";
  if (session.userId !== userId) return "forbidden";
  return session;
}

export function updateRouteSession(token: string, patch: Partial<RouteSessionState>): void {
  const existing = store.get(token);
  if (!existing) return;
  store.set(token, { ...existing, ...patch });
}

export function deleteRouteSession(token: string): void {
  store.delete(token);
}

/** Drop in-memory route suggestion tokens past TTL — also called from the daily purge job. */
export function sweepExpiredRouteSessions(): number {
  const before = store.size;
  sweep();
  return before - store.size;
}
