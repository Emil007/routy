import { createHash } from "node:crypto";
import { listFavorites } from "./favorites";
import { getActiveRoute } from "./activeRoute";
import { getNetworkVersion } from "./networkVersion";

/** ETag for /api/app/bootstrap — bumps when network or per-user route state changes. */
export function getBootstrapVersion(userId: number): string {
  const active = getActiveRoute(userId);
  const favorites = listFavorites(userId);
  const payload = [
    getNetworkVersion(),
    userId,
    active?.acceptedAt ?? "",
    active?.nodeChain.join(",") ?? "",
    favorites.length,
    favorites.map((f) => f.id).join(","),
  ].join(":");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
