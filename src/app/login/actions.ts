"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyLogin, createUser } from "@/lib/users";
import { createSession, userCount, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

async function establishSession(userId: number) {
  const token = await createSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  const user = verifyLogin(username, password);
  if (!user) {
    redirect("/login?error=1");
  }
  if (!user.active) {
    redirect("/login?error=inactive");
  }
  await establishSession(user.id);
  redirect("/route");
}

export async function setupFirstProfileAction(formData: FormData) {
  if (userCount() > 0) {
    redirect("/login");
  }

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const locale = String(formData.get("locale") || "de") === "en" ? "en" : "de";

  if (!username || password.length < 6) {
    redirect("/login?setupError=1");
  }

  const user = createUser(username, password, displayName, locale, "admin");
  await establishSession(user.id);
  redirect("/route");
}
