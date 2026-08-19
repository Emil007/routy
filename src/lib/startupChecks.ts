import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { log } from "./logger";

/** Best-effort sanity checks — warn about likely misconfiguration, never block startup. */
export function runStartupChecks(): void {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "routy.db");
  const dbDir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    fs.accessSync(dbDir, fs.constants.W_OK);
  } catch {
    log.warn("database directory is not writable", { dbDir });
  }

  const captchaProvider = process.env.CAPTCHA_PROVIDER;
  if (captchaProvider && captchaProvider !== "none") {
    if (!process.env.CAPTCHA_SITE_KEY || !process.env.CAPTCHA_SECRET_KEY) {
      log.warn("CAPTCHA_PROVIDER is set but CAPTCHA_SITE_KEY/CAPTCHA_SECRET_KEY are missing — captcha will fail closed", {
        captchaProvider,
      });
    }
  }

  try {
    const result = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    const failed = result.filter((r) => r.quick_check !== "ok");
    if (failed.length > 0) {
      log.error("DATABASE INTEGRITY CHECK FAILED — PRAGMA quick_check reported errors", {
        errors: failed.map((r) => r.quick_check),
      });
    }
  } catch (err) {
    log.error("DATABASE INTEGRITY CHECK FAILED — could not run PRAGMA quick_check", { error: String(err) });
  }

  log.info("startup checks complete");
}
