import { db } from "./db";
import { hashPassword, verifyPassword } from "./auth";

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  locale: string;
}

interface UserDbRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  locale: string;
}

function mapUser(row: UserDbRow): UserRow {
  return { id: row.id, username: row.username, passwordHash: row.password_hash, displayName: row.display_name, locale: row.locale };
}

export function findUserByUsername(username: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserDbRow | undefined;
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
