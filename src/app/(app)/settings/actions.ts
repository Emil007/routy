"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, destroyCurrentSession, destroyOtherSessions } from "@/lib/session";
import { updateSettings, SETTINGS_KEYS } from "@/lib/settings";
import {
  updateUserWalkSpeed,
  changeOwnPassword,
  setUserActive,
  getUser,
  verifyLogin,
  setPendingTotpSecret,
  enableTotp,
  disableTotp,
} from "@/lib/users";
import { generateTotpSecret, verifyTotpCode } from "@/lib/twoFactor";
import { addAvoidSegment, removeAvoidSegment } from "@/lib/avoidList";

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

export async function logoutEverywhereAction() {
  const user = await requireUser();
  await destroyOtherSessions(user.id);
  redirect("/settings?loggedOutEverywhere=1");
}

/** Generates (or regenerates) a pending secret and sends the user to the QR/confirm step — not enabled until confirmEnableTotpAction succeeds. */
export async function startEnableTotpAction() {
  const user = await requireUser();
  setPendingTotpSecret(user.id, generateTotpSecret());
  redirect("/settings?totpSetup=1");
}

export async function confirmEnableTotpAction(formData: FormData) {
  const user = await requireUser();
  const code = String(formData.get("totpCode") || "").trim();
  const current = getUser(user.id);

  if (!current?.totpSecret || !verifyTotpCode(current.totpSecret, current.username, code)) {
    redirect("/settings?totpSetup=1&totpError=1");
  }

  enableTotp(user.id);
  redirect("/settings?totpEnabled=1");
}

export async function cancelEnableTotpAction() {
  const user = await requireUser();
  disableTotp(user.id);
  redirect("/settings");
}

export async function disableTotpAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  if (!verifyLogin(user.username, currentPassword)) {
    redirect("/settings?totpDisableError=1");
  }
  disableTotp(user.id);
  redirect("/settings?totpDisabled=1");
}

export async function deleteOwnAccountAction() {
  const user = await requireUser();
  if (user.role === "admin") return;
  setUserActive(user.id, false);
  await destroyCurrentSession();
  redirect("/login");
}

export async function addAvoidSegmentAction(formData: FormData) {
  const user = await requireUser();
  const segmentId = Number(formData.get("segmentId"));
  if (Number.isInteger(segmentId) && segmentId > 0) addAvoidSegment(user.id, segmentId);
  revalidatePath("/settings");
}

export async function removeAvoidSegmentAction(formData: FormData) {
  const user = await requireUser();
  const segmentId = Number(formData.get("segmentId"));
  if (Number.isInteger(segmentId) && segmentId > 0) removeAvoidSegment(user.id, segmentId);
  revalidatePath("/settings");
}
