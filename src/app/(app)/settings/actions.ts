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
  cancelPendingTotp,
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
  if (partial.golden_percent !== undefined) {
    partial.golden_percent = Math.min(25, Math.max(1, partial.golden_percent));
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
    redirect("/settings/account?passwordError=1");
  }
  const ok = changeOwnPassword(user.id, currentPassword, newPassword);
  if (ok) {
    // M2-2/F08: a password change must revoke every other session; the current
    // (just-authenticated) one stays.
    await destroyOtherSessions(user.id);
  }
  redirect(ok ? "/settings/account?passwordSuccess=1" : "/settings/account?passwordError=1");
}

export async function logoutEverywhereAction() {
  const user = await requireUser();
  await destroyOtherSessions(user.id);
  redirect("/settings/account?loggedOutEverywhere=1");
}

/** Generates (or regenerates) a pending secret and sends the user to the QR/confirm step. */
export async function startEnableTotpAction(formData: FormData) {
  const user = await requireUser();
  // M2-1/F07: starting a 2FA setup requires the current password — a stolen
  // session alone must not be able to arm its own factor.
  const currentPassword = String(formData.get("currentPassword") || "");
  if (!verifyLogin(user.username, currentPassword)) {
    redirect("/settings/account?totpSetupError=1");
  }
  setPendingTotpSecret(user.id, generateTotpSecret());
  redirect("/settings/account?totpSetup=1");
}

export async function confirmEnableTotpAction(formData: FormData) {
  const user = await requireUser();
  const code = String(formData.get("totpCode") || "").trim();
  const current = getUser(user.id);

  // M2-1: verify against the PENDING secret (a cancelled setup has none).
  if (!current?.totpPendingSecret || !verifyTotpCode(current.totpPendingSecret, current.username, code)) {
    redirect("/settings/account?totpSetup=1&totpError=1");
  }

  const enabled = enableTotp(user.id);
  if (enabled) {
    // M2-2: enabling 2FA revokes other sessions too.
    await destroyOtherSessions(user.id);
  }
  redirect("/settings/account?totpEnabled=1");
}

export async function cancelEnableTotpAction(formData: FormData) {
  const user = await requireUser();
  // M2-1/F07: cancel only clears the PENDING secret and only while 2FA is still
  // off — the live factor is never touched, so this can't disable an active setup.
  const currentPassword = String(formData.get("currentPassword") || "");
  if (!verifyLogin(user.username, currentPassword)) {
    redirect("/settings/account?totpDisableError=1");
  }
  cancelPendingTotp(user.id);
  redirect("/settings/account");
}

export async function disableTotpAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  if (!verifyLogin(user.username, currentPassword)) {
    redirect("/settings/account?totpDisableError=1");
  }
  disableTotp(user.id);
  redirect("/settings/account?totpDisabled=1");
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
