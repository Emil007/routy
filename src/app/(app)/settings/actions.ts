"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, destroyCurrentSession } from "@/lib/session";
import { updateSettings, SETTINGS_KEYS } from "@/lib/settings";
import { updateUserWalkSpeed, changeOwnPassword, setUserActive } from "@/lib/users";

export async function saveSettingsAction(formData: FormData) {
  await requireAdmin();
  const partial: Record<string, number> = {};
  for (const key of SETTINGS_KEYS) {
    const raw = formData.get(key);
    if (raw !== null && raw !== "") {
      const num = Number(raw);
      if (!Number.isNaN(num)) partial[key] = num;
    }
  }
  updateSettings(partial);
  revalidatePath("/settings");
}

export async function saveWalkSpeedAction(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("walkSpeedKmh") || "").trim();
  if (raw === "") {
    updateUserWalkSpeed(user.id, null);
  } else {
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) updateUserWalkSpeed(user.id, num);
  }
  revalidatePath("/settings");
}

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  if (newPassword.length < 6) {
    redirect("/settings?passwordError=1");
  }
  const ok = changeOwnPassword(user.id, currentPassword, newPassword);
  redirect(ok ? "/settings?passwordSuccess=1" : "/settings?passwordError=1");
}

export async function deleteOwnAccountAction() {
  const user = await requireUser();
  if (user.role === "admin") return;
  setUserActive(user.id, false);
  await destroyCurrentSession();
  redirect("/login");
}
