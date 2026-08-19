import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APP_VERSION, APP_VERSION_DISPLAY } from "@/lib/version";

async function lastBackupTimestamp(): Promise<string | null> {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "routy.db");
  const dir = path.join(path.dirname(dbPath), "backups");
  try {
    const entries = await fs.readdir(dir);
    let latest: number | null = null;
    for (const entry of entries) {
      if (!entry.startsWith("routy-") || !entry.endsWith(".db")) continue;
      const stat = await fs.stat(path.join(dir, entry));
      if (latest === null || stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
    return latest !== null ? new Date(latest).toISOString() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const nodeRow = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE active = 1").get() as { c: number };
    const segmentRow = db.prepare("SELECT COUNT(*) AS c FROM segments WHERE active = 1").get() as { c: number };
    db.prepare("SELECT 1").get();

    return NextResponse.json({
      status: "ok",
      version: APP_VERSION,
      versionDisplay: APP_VERSION_DISPLAY,
      dbReachable: true,
      nodeCount: nodeRow.c,
      segmentCount: segmentRow.c,
      lastBackupAt: await lastBackupTimestamp(),
    });
  } catch {
    return NextResponse.json({ status: "error", version: APP_VERSION, dbReachable: false }, { status: 500 });
  }
}
