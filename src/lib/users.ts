import { randomBytes } from "crypto";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./auth";

export type UserRole = "admin" | "user";

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  locale: string;
  /** Null means "use the network-wide default from Settings". */
  walkSpeedKmh: number | null;
  role: UserRole;
  active: boolean;
  deletedAt: string | null;
  theme: string;
  /** IANA zone for streak/day windows; defaults to Europe/Vienna. */
  timezone: string;
  /** Set as soon as 2FA setup starts, kept even before totpEnabled flips on so the same QR code can be re-confirmed. */
  totpSecret: string | null;
  /** Secret waiting for confirmation — NOT the live one; only shown while pending. */
  totpPendingSecret: string | null;
  totpEnabled: boolean;
  homeNodeId: number | null;
}

interface UserDbRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  locale: string;
  walk_speed_kmh: number | null;
  role: UserRole;
  active: number;
  deleted_at: string | null;
  theme: string;
  timezone: string;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  totp_enabled: number;
  home_node_id: number | null;
}

function mapUser(row: UserDbRow): UserRow {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    locale: row.locale,
    walkSpeedKmh: row.walk_speed_kmh,
    role: row.role,
    active: row.active === 1,
    deletedAt: row.deleted_at,
    theme: row.theme,
    timezone: row.timezone && row.timezone.trim() !== "" ? row.timezone : "Europe/Vienna",
    totpSecret: row.totp_secret,
    totpPendingSecret: row.totp_pending_secret,
    totpEnabled: row.totp_enabled === 1,
    homeNodeId: row.home_node_id ?? null,
  };
}

export function findUserByUsername(username: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserDbRow | undefined;
  return row ? mapUser(row) : null;
}

export function getUser(id: number): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserDbRow | undefined;
  return row ? mapUser(row) : null;
}

export function listAllUsers(): UserRow[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY id").all() as UserDbRow[];
  return rows.map(mapUser);
}

export function verifyLogin(username: string, password: string): UserRow | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}

export function createUser(
  username: string,
  password: string,
  displayName: string,
  locale: string,
  role: UserRole = "user",
): UserRow {
  db.prepare("INSERT INTO users (username, password_hash, display_name, locale, role) VALUES (?, ?, ?, ?, ?)").run(
    username,
    hashPassword(password),
    displayName,
    locale,
    role,
  );
  const user = findUserByUsername(username);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

/** First admin only — returns null if any user already exists (atomic). */
export function tryCreateFirstAdmin(
  username: string,
  password: string,
  displayName: string,
  locale: string,
): UserRow | null {
  return db.transaction(() => {
    const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    if (row.c > 0) return null;
    db.prepare("INSERT INTO users (username, password_hash, display_name, locale, role) VALUES (?, ?, ?, ?, ?)").run(
      username,
      hashPassword(password),
      displayName,
      locale,
      "admin",
    );
    return findUserByUsername(username);
  })();
}

export function updateUserLocale(userId: number, locale: string): void {
  db.prepare("UPDATE users SET locale = ? WHERE id = ?").run(locale, userId);
}

export function updateUserTheme(userId: number, theme: string): void {
  db.prepare("UPDATE users SET theme = ? WHERE id = ?").run(theme, userId);
}

/** Per-user IANA timezone (decision G). Falls back to Europe/Vienna on save. */
export function updateUserTimezone(userId: number, timezone: string): void {
  const zone = timezone.trim() !== "" ? timezone : "Europe/Vienna";
  db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run(zone, userId);
}

/** Pass null to go back to using the network-wide default from Settings. */
export function updateUserWalkSpeed(userId: number, walkSpeedKmh: number | null): void {
  db.prepare("UPDATE users SET walk_speed_kmh = ? WHERE id = ?").run(walkSpeedKmh, userId);
}

export function changeOwnPassword(userId: number, currentPassword: string, newPassword: string): boolean {
  const user = getUser(userId);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) return false;
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), userId);
  return true;
}

/** Admin edit: display name, username, language, and an optional password reset. */
export function updateUserProfile(
  userId: number,
  fields: { displayName: string; username: string; locale: string; newPassword?: string },
): void {
  if (fields.newPassword) {
    db.prepare("UPDATE users SET display_name = ?, username = ?, locale = ?, password_hash = ? WHERE id = ?").run(
      fields.displayName,
      fields.username,
      fields.locale,
      hashPassword(fields.newPassword),
      userId,
    );
  } else {
    db.prepare("UPDATE users SET display_name = ?, username = ?, locale = ? WHERE id = ?").run(
      fields.displayName,
      fields.username,
      fields.locale,
      userId,
    );
  }
}

/** Reversible: used both for admin "lock" and self-service account deletion. */
export function setUserActive(userId: number, active: boolean): void {
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, userId);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/**
 * Irreversible, admin-only: scrubs login credentials and frees the username for
 * reuse, but keeps the row (and display_name) so old nodes/segments/walks stay
 * attributed to a real name instead of turning into a dangling reference.
 */
export function deleteUserPermanently(userId: number): void {
  const placeholder = `deleted-${userId}-${Date.now()}`;
  db.prepare(
    "UPDATE users SET username = ?, password_hash = ?, active = 0, deleted_at = datetime('now') WHERE id = ?",
  ).run(placeholder, hashPassword(randomPlaceholderPassword()), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function randomPlaceholderPassword(): string {
  return randomBytes(16).toString("hex");
}

/** M2-1/F07: stores a freshly generated PENDING secret WITHOUT touching
 *  totp_secret or totp_enabled — the live factor stays active until the user
 *  proves they captured the new one. */
export function setPendingTotpSecret(userId: number, secret: string): void {
  db.prepare("UPDATE users SET totp_pending_secret = ? WHERE id = ?").run(secret, userId);
}

/** Promotes the pending secret to the live one and enables 2FA atomically. */
export function enableTotp(userId: number): boolean {
  const info = db
    .prepare(
      "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 WHERE id = ? AND totp_pending_secret IS NOT NULL",
    )
    .run(userId);
  return info.changes > 0;
}

/** Also the account-recovery path for admins when a user loses their authenticator. */
export function disableTotp(userId: number): void {
  db.prepare("UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0 WHERE id = ?").run(userId);
}

/** Cancels a pending 2FA setup without touching the live factor. Returns false
 *  (no-op) when 2FA is already enabled or nothing is pending. */
export function cancelPendingTotp(userId: number): boolean {
  const info = db
    .prepare("UPDATE users SET totp_pending_secret = NULL WHERE id = ? AND totp_enabled = 0")
    .run(userId);
  return info.changes > 0;
}
