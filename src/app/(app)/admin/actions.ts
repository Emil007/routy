"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, startImpersonation } from "@/lib/session";
import { createUser, findUserByUsername, getUser, setUserActive, deleteUserPermanently, updateUserProfile } from "@/lib/users";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n";
import { logActivity } from "@/lib/activityLog";

export async function createUserAction(formData: FormData) {
  const admin = await requireAdmin();

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const localeRaw = String(formData.get("locale") || "");
  const locale = isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE;

  if (!username || password.length < 6) {
    redirect("/admin?error=invalid");
  }
  if (findUserByUsername(username)) {
    redirect("/admin?error=taken");
  }

  const created = createUser(username, password, displayName, locale, "user");
  logActivity(admin.id, "create", "user", created.id, { username });
  revalidatePath("/admin");
}

export async function updateUserAction(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!id) return;

  const displayName = String(formData.get("displayName") || "").trim();
  const username = String(formData.get("username") || "").trim();
  const localeRaw = String(formData.get("locale") || "");
  const locale = isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE;
  const newPassword = String(formData.get("newPassword") || "");
  if (!displayName || !username) return;

  const existing = findUserByUsername(username);
  if (existing && existing.id !== id) {
    redirect(`/admin/${id}?error=taken`);
  }

  updateUserProfile(id, { displayName, username, locale, newPassword: newPassword.length >= 6 ? newPassword : undefined });
  revalidatePath("/admin");
  redirect("/admin?edited=1");
}

export async function toggleActiveAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("userId"));
  const nextActive = formData.get("active") === "1";
  if (!id || id === admin.id) return;

  setUserActive(id, nextActive);
  logActivity(admin.id, nextActive ? "unlock" : "lock", "user", id);
  revalidatePath("/admin");
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!id || id === admin.id) return;

  deleteUserPermanently(id);
  logActivity(admin.id, "delete", "user", id);
  revalidatePath("/admin");
}

export async function impersonateAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!id || id === admin.id) return;
  const target = getUser(id);
  if (!target || target.deletedAt) return;

  logActivity(admin.id, "impersonate", "user", id);
  await startImpersonation(id);
  redirect("/route");
}
