"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createUser, findUserByUsername } from "@/lib/users";

export async function createProfileAction(formData: FormData) {
  await requireUser();

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const locale = String(formData.get("locale") || "de") === "en" ? "en" : "de";

  if (!username || password.length < 6) {
    redirect("/profile/new?error=invalid");
  }
  if (findUserByUsername(username)) {
    redirect("/profile/new?error=taken");
  }

  createUser(username, password, displayName, locale);
  redirect("/profile/new?success=1");
}
