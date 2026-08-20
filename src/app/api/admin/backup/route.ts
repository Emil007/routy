import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/** Admin DB download — POST only so a cookie alone cannot CSRF-navigate a GET download (SEC-2). */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const tmpPath = path.join(os.tmpdir(), `routy-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    // better-sqlite3's .backup() takes a consistent snapshot without stopping
    // writes to the live database — no downtime needed for this.
    await db.backup(tmpPath);
    const buffer = await fs.readFile(tmpPath);
    const filename = `routy-backup-${new Date().toISOString().slice(0, 10)}.db`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    log.error("admin backup failed", { error: String(err) });
    return NextResponse.json({ error: "backup_failed" }, { status: 500 });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
