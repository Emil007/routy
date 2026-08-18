"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { destroyCurrentSession, getCurrentUser, endImpersonation } from "@/lib/session";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { isTheme } from "@/lib/theme";
import { updateUserLocale, updateUserTheme } from "@/lib/users";

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login");
}

export async function returnFromImpersonationAction() {
  await endImpersonation();
  redirect("/admin");
}

export async function setLocaleAction(formData: FormData) {
  const locale = String(formData.get("locale") || "");
  if (!isLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });

  const user = await getCurrentUser();
  if (user) updateUserLocale(user.id, locale);

  revalidatePath("/", "layout");
}

export async function setThemeAction(formData: FormData) {
  const theme = String(formData.get("theme") || "");
  if (!isTheme(theme)) return;

  const user = await getCurrentUser();
  if (!user) return;
  updateUserTheme(user.id, theme);

  revalidatePath("/", "layout");
}
