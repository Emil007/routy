import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isLocale } from "@/lib/i18n";
import { isTheme } from "@/lib/theme";
import { getUser, updateUserLocale, updateUserTheme, updateUserWalkSpeed } from "@/lib/users";

/** PATCH profile fields the native app settings screen edits (locale, theme, walk speed). */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { locale?: string; theme?: string; walkSpeedKmh?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.locale !== undefined) {
    if (!isLocale(body.locale)) return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
    updateUserLocale(user.id, body.locale);
  }

  if (body.theme !== undefined) {
    if (!isTheme(body.theme)) return NextResponse.json({ error: "invalid_theme" }, { status: 400 });
    updateUserTheme(user.id, body.theme);
  }

  if (body.walkSpeedKmh !== undefined) {
    const v = body.walkSpeedKmh;
    if (v !== null && (typeof v !== "number" || !(v > 0))) {
      return NextResponse.json({ error: "invalid_walk_speed" }, { status: 400 });
    }
    updateUserWalkSpeed(user.id, v);
  }

  const updated = getUser(user.id);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    user: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      locale: updated.locale,
      walkSpeedKmh: updated.walkSpeedKmh,
      role: updated.role,
      active: updated.active,
      theme: updated.theme,
      totpEnabled: updated.totpEnabled,
      homeNodeId: updated.homeNodeId,
      client: user.client ?? "web",
    },
  });
}
