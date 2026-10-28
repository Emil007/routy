import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isLocale } from "@/lib/i18n";
import { isTheme } from "@/lib/theme";
import { isTimezone } from "@/lib/timezone";
import { getUser, updateUserLocale, updateUserTheme, updateUserWalkSpeed, updateUserTimezone } from "@/lib/users";

/** PATCH profile fields the native app settings screen edits (locale, theme, walk speed). */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { locale?: string; theme?: string; walkSpeedKmh?: number | null; timezone?: string };
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

  // M1-15/F44: timezone is on the user object (login/bootstrap already carry it,
  // but the app-settings PATCH must accept and return it, or Android's decode of
  // the response fails on an unknown field it can't map).
  if (body.timezone !== undefined) {
    const zone = body.timezone;
    if (!isTimezone(zone)) return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
    updateUserTimezone(user.id, zone);
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
      timezone: updated.timezone,
      totpEnabled: updated.totpEnabled,
      homeNodeId: updated.homeNodeId,
      client: user.client ?? "web",
    },
  });
}
