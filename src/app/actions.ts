"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { destroyCurrentSession, getCurrentUser, endImpersonation } from "@/lib/session";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { updateUserLocale } from "@/lib/users";

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
