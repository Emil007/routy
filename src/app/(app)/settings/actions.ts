"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { updateSettings, SETTINGS_KEYS } from "@/lib/settings";
import { createUser, findUserByUsername, updateUserWalkSpeed } from "@/lib/users";

export async function saveSettingsAction(formData: FormData) {
  await requireUser();
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

export async function createProfileAction(formData: FormData) {
  await requireUser();

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const locale = String(formData.get("locale") || "de") === "en" ? "en" : "de";

  if (!username || password.length < 6) {
    redirect("/settings?profileError=invalid");
  }
  if (findUserByUsername(username)) {
    redirect("/settings?profileError=taken");
  }

  createUser(username, password, displayName, locale);
  redirect("/settings?profileSuccess=1");
}
