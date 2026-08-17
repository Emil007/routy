"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { updateSettings, SETTINGS_KEYS } from "@/lib/settings";

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
