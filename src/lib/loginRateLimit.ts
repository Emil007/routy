// In-memory brute-force throttle for login and first-time setup, no external
// service involved. Keyed by whatever the caller considers the "attacker
// target" (a username for login, a fixed key for setup) — a single process
// is all Routy ever runs as, so a `globalThis` singleton (same pattern as
// `routeSessions.ts`) is enough; it resets on restart, which is fine for a
// throttle rather than a permanent ban list.

import { headers } from "next/headers";

interface AttemptState {
  failures: number;
  lockedUntil: number | null;
}

declare global {

  var __routyLoginAttempts: Map<string, AttemptState> | undefined;
}

const store: Map<string, AttemptState> = globalThis.__routyLoginAttempts ?? new Map();
globalThis.__routyLoginAttempts = store;

const LOCKOUT_THRESHOLD = 5;
const BASE_LOCKOUT_SECONDS = 15;
const MAX_LOCKOUT_SECONDS = 300;

/** Higher than the per-username threshold — a household's shared IP legitimately produces more failures than one attacker-targeted account should. */
export const IP_LOCKOUT_THRESHOLD = 20;

export function checkLockout(key: string): { locked: boolean; retryAfterSeconds: number } {
  const state = store.get(key);
  if (!state?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const remainingMs = state.lockedUntil - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

export function recordFailure(key: string, threshold = LOCKOUT_THRESHOLD): void {
  const state = store.get(key) ?? { failures: 0, lockedUntil: null };
  state.failures += 1;
  if (state.failures >= threshold) {
    const extra = state.failures - threshold;
    const seconds = Math.min(BASE_LOCKOUT_SECONDS * 2 ** extra, MAX_LOCKOUT_SECONDS);
    state.lockedUntil = Date.now() + seconds * 1000;
  }
  store.set(key, state);
}

export function clearAttempts(key: string): void {
  store.delete(key);
}

/**
 * Best-effort client IP from X-Forwarded-For. The rightmost entry is the one
 * the immediate reverse proxy (Caddy or otherwise) actually observed, so a
 * client can't spoof it by sending their own X-Forwarded-For — anything they
 * add is pushed further left, behind the proxy's own append. Falls back to a
 * shared bucket with no reverse proxy in front at all (bare LAN access);
 * per-username lockout still covers that case on its own.
 */
export async function getClientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const parts = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}
