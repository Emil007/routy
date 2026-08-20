declare global {
  var __routyApiRateLimits: Map<string, { count: number; windowStart: number }> | undefined;
}

const store: Map<string, { count: number; windowStart: number }> =
  globalThis.__routyApiRateLimits ?? new Map();
globalThis.__routyApiRateLimits = store;

export type RateLimitBucket =
  | "gpx_parse"
  | "gpx_commit"
  | "app_crash"
  | "route_complete"
  | "segment_condition"
  | "segment_restrict";

const LIMITS: Record<RateLimitBucket, { max: number; windowMs: number }> = {
  gpx_parse: { max: 10, windowMs: 60_000 },
  gpx_commit: { max: 10, windowMs: 60_000 },
  app_crash: { max: 20, windowMs: 60_000 },
  route_complete: { max: 30, windowMs: 60_000 },
  segment_condition: { max: 30, windowMs: 60_000 },
  segment_restrict: { max: 30, windowMs: 60_000 },
};

/** Sliding-window throttle keyed by bucket + user and/or IP (SEC-8). */
export function checkApiRateLimit(
  bucket: RateLimitBucket,
  opts: { userId?: number; ip?: string | null },
): { allowed: boolean; retryAfterSeconds: number } {
  const { max, windowMs } = LIMITS[bucket];
  const keys: string[] = [];
  if (opts.userId !== undefined) keys.push(`${bucket}:user:${opts.userId}`);
  if (opts.ip) keys.push(`${bucket}:ip:${opts.ip}`);
  if (keys.length === 0) keys.push(`${bucket}:anon`);

  const now = Date.now();
  let worstRetry = 0;
  for (const key of keys) {
    let state = store.get(key);
    if (!state || now - state.windowStart > windowMs) {
      state = { count: 0, windowStart: now };
    }
    if (state.count >= max) {
      const retry = Math.ceil((state.windowStart + windowMs - now) / 1000);
      worstRetry = Math.max(worstRetry, Math.max(retry, 1));
      continue;
    }
    state.count += 1;
    store.set(key, state);
  }
  if (worstRetry > 0) {
    return { allowed: false, retryAfterSeconds: worstRetry };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: "rate_limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
