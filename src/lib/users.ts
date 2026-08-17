import { db } from "./db";
import { hashPassword, verifyPassword } from "./auth";

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  locale: string;
  /** Null means "use the network-wide default from Settings". */
  walkSpeedKmh: number | null;
}

interface UserDbRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  locale: string;
  walk_speed_kmh: number | null;
}

function mapUser(row: UserDbRow): UserRow {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    locale: row.locale,
    walkSpeedKmh: row.walk_speed_kmh,
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

export function verifyLogin(username: string, password: string): UserRow | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}

export function createUser(username: string, password: string, displayName: string, locale: string): UserRow {
  db.prepare("INSERT INTO users (username, password_hash, display_name, locale) VALUES (?, ?, ?, ?)").run(
    username,
    hashPassword(password),
    displayName,
    locale,
  );
  const user = findUserByUsername(username);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

export function updateUserLocale(userId: number, locale: string): void {
  db.prepare("UPDATE users SET locale = ? WHERE id = ?").run(locale, userId);
}

/** Pass null to go back to using the network-wide default from Settings. */
export function updateUserWalkSpeed(userId: number, walkSpeedKmh: number | null): void {
  db.prepare("UPDATE users SET walk_speed_kmh = ? WHERE id = ?").run(walkSpeedKmh, userId);
}
