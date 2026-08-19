import { createHash } from "node:crypto";
import { listFavorites } from "./favorites";
import { getActiveRoute } from "./activeRoute";
import { getNetworkVersion } from "./networkVersion";
import { getUser } from "./users";

/** ETag for /api/app/bootstrap — bumps when network, profile, or per-user route state changes. */
export function getBootstrapVersion(userId: number): string {
  const active = getActiveRoute(userId);
  const favorites = listFavorites(userId);
  const user = getUser(userId);
  const payload = [
    getNetworkVersion(),
    userId,
    user?.displayName ?? "",
    user?.locale ?? "",
    user?.theme ?? "",
    user?.walkSpeedKmh ?? "",
    active?.acceptedAt ?? "",
    active?.nodeChain.join(",") ?? "",
    favorites.length,
    favorites.map((f) => f.id).join(","),
  ].join(":");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
