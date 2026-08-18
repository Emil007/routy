import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { hashToken, newSessionToken } from "./auth";

export const SESSION_COOKIE = "routy_session";
export const IMPERSONATOR_COOKIE = "routy_impersonator_token";
const SESSION_TTL_DAYS = 30;

export function sessionCookieOptions() {
  const secure =
    process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function createSession(userId: number): Promise<string> {
  const token = newSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    tokenHash,
    userId,
    expiresAt,
  );
  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

/** Signs out every other device/browser signed into this account, keeping the current session alive. */
export async function destroyOtherSessions(userId: number): Promise<number> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const currentHash = token ? hashToken(token) : null;
  const result = db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .run(userId, currentHash ?? "");
  return result.changes;
}

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  locale: string;
  /** Null means "use the network-wide default from Settings". */
  walkSpeedKmh: number | null;
  role: "admin" | "user";
  active: boolean;
  theme: string;
}

interface SessionRow {
  id: number;
  username: string;
  displayName: string;
  locale: string;
  walkSpeedKmh: number | null;
  role: "admin" | "user";
  active: number;
  theme: string;
  expiresAt: string;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id as id, u.username as username, u.display_name as displayName, u.locale as locale,
              u.walk_speed_kmh as walkSpeedKmh, u.role as role, u.active as active, u.theme as theme,
              s.expires_at as expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as SessionRow | undefined;

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  if (row.active !== 1) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    locale: row.locale,
    walkSpeedKmh: row.walkSpeedKmh,
    role: row.role,
    active: row.active === 1,
    theme: row.theme,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/route");
  return user;
}

export function userCount(): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  return row.c;
}

/**
 * Admin-only. Starts a session for `targetUserId` and stashes the admin's own
 * session token in a second cookie so "return to admin" can restore it later
 * without needing to re-derive it from the (hash-only) sessions table.
 */
export async function startImpersonation(targetUserId: number): Promise<void> {
  const store = await cookies();
  const adminToken = store.get(SESSION_COOKIE)?.value;
  if (!adminToken) return;
  const newToken = await createSession(targetUserId);
  const options = sessionCookieOptions();
  store.set(IMPERSONATOR_COOKIE, adminToken, options);
  store.set(SESSION_COOKIE, newToken, options);
}

/** Returns true if impersonation was actually ended (i.e. the cookie was present and valid). */
export async function endImpersonation(): Promise<boolean> {
  const store = await cookies();
  const impersonatorToken = store.get(IMPERSONATOR_COOKIE)?.value;
  if (!impersonatorToken) return false;

  const impersonatorHash = hashToken(impersonatorToken);
  const row = db
    .prepare(
      `SELECT u.role as role, u.active as active, s.expires_at as expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(impersonatorHash) as { role: string; active: number; expiresAt: string } | undefined;
  const stillValidAdmin = row && row.role === "admin" && row.active === 1 && new Date(row.expiresAt).getTime() >= Date.now();

  const currentToken = store.get(SESSION_COOKIE)?.value;
  if (currentToken) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(currentToken));
  store.delete(IMPERSONATOR_COOKIE);

  if (!stillValidAdmin) {
    store.delete(SESSION_COOKIE);
    return false;
  }

  store.set(SESSION_COOKIE, impersonatorToken, sessionCookieOptions());
  return true;
}

export async function isImpersonating(): Promise<boolean> {
  const store = await cookies();
  return !!store.get(IMPERSONATOR_COOKIE)?.value;
}
