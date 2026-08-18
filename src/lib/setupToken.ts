import { randomBytes } from "node:crypto";
import { timingSafeEqual } from "node:crypto";

// A random secret required to complete first-time setup, so that if the
// container is reachable on the internet before you've had a chance to set
// up the first (admin) account yourself, a stranger who finds it first can't
// claim it. Generated once per process start and printed to the console —
// `docker compose logs -f` shows it. Lazily created (not just at startup) so
// it exists even if instrumentation.ts's boot-time log is missed.
declare global {

  var __routySetupToken: string | undefined;
}

export function getOrCreateSetupToken(): string {
  if (!globalThis.__routySetupToken) {
    globalThis.__routySetupToken = randomBytes(8).toString("hex");
  }
  return globalThis.__routySetupToken;
}

export function verifySetupToken(candidate: string): boolean {
  const expected = getOrCreateSetupToken();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
