import path from "node:path";
import fs from "node:fs/promises";
import { db } from "./db";
import { log } from "./logger";

const RETENTION_DAYS = 14;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function backupsDir(): string {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "routy.db");
  return path.join(path.dirname(dbPath), "backups");
}

async function writeDailyBackup(): Promise<void> {
  const dir = backupsDir();
  await fs.mkdir(dir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  await db.backup(path.join(dir, `routy-${dateStr}.db`));

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (!entry.startsWith("routy-") || !entry.endsWith(".db")) continue;
    const filePath = path.join(dir, entry);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < cutoff) await fs.unlink(filePath).catch(() => {});
  }
}

function runOnce(): void {
  writeDailyBackup()
    .then(() => log.info("scheduled backup written"))
    .catch((err) => log.error("scheduled backup failed", { error: String(err) }));
}

/** One backup on startup, then one every 24h, rotating out anything older than 14 days. Local disk only, opt-out by removing the call — no config needed. */
export function startScheduledBackups(): void {
  runOnce();
  setInterval(runOnce, INTERVAL_MS);
}
