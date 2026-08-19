declare global {
  var __routyGenerateCounts: Map<string, { count: number; windowStart: number }> | undefined;
}

const store: Map<string, { count: number; windowStart: number }> = globalThis.__routyGenerateCounts ?? new Map();
globalThis.__routyGenerateCounts = store;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/** Sliding-window throttle for expensive route generation per user. */
export function checkGenerateRateLimit(userId: number): { allowed: boolean; retryAfterSeconds: number } {
  const key = `user:${userId}`;
  const now = Date.now();
  let state = store.get(key);
  if (!state || now - state.windowStart > WINDOW_MS) {
    state = { count: 0, windowStart: now };
  }
  if (state.count >= MAX_PER_WINDOW) {
    const retry = Math.ceil((state.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retry, 1) };
  }
  state.count += 1;
  store.set(key, state);
  return { allowed: true, retryAfterSeconds: 0 };
}
