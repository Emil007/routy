import fs from "node:fs";
import path from "node:path";
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

  log.info("startup checks complete");
}
