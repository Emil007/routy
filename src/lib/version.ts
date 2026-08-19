import pkg from "../../package.json";

/** Full version from package.json (e.g. "0.25s"). */
export const APP_VERSION = pkg.version;

/**
 * Routy server display + git tag suffix — same as package.json (e.g. "0.25s").
 * Android uses the same MAJOR.MINOR with an `a` suffix in routy-android (independent line).
 */
export function formatVersionDisplay(version: string): string {
  const cleaned = version.replace(/^v/, "");
  if (cleaned.endsWith("s") || cleaned.endsWith("a")) return cleaned;
  const match = /^(\d+)\.(\d+)/.exec(cleaned);
  if (!match) return `${cleaned}s`;
  return `${match[1]}.${match[2]}s`;
}

export const APP_VERSION_DISPLAY = formatVersionDisplay(APP_VERSION);
