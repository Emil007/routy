// In-memory brute-force throttle for login and first-time setup, no external
// service involved. Keyed by whatever the caller considers the "attacker
// target" (a username for login, a fixed key for setup) — a single process
// is all Routy ever runs as, so a `globalThis` singleton (same pattern as
// `routeSessions.ts`) is enough; it resets on restart, which is fine for a
// throttle rather than a permanent ban list.

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

export function checkLockout(key: string): { locked: boolean; retryAfterSeconds: number } {
  const state = store.get(key);
  if (!state?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const remainingMs = state.lockedUntil - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

export function recordFailure(key: string): void {
  const state = store.get(key) ?? { failures: 0, lockedUntil: null };
  state.failures += 1;
  if (state.failures >= LOCKOUT_THRESHOLD) {
    const extra = state.failures - LOCKOUT_THRESHOLD;
    const seconds = Math.min(BASE_LOCKOUT_SECONDS * 2 ** extra, MAX_LOCKOUT_SECONDS);
    state.lockedUntil = Date.now() + seconds * 1000;
  }
  store.set(key, state);
}

export function clearAttempts(key: string): void {
  store.delete(key);
}
