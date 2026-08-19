import pkg from "../../package.json";

/** Full semver from package.json (e.g. "0.21.0"). Patch is always 0 — use display/tag for releases. */
export const APP_VERSION = pkg.version;

/**
 * Routy server display + git tag suffix: package.json `0.21.0` → `0.21s`.
 * Android uses the same MAJOR.MINOR with an `a` suffix in routy-android (independent line).
 */
export function formatVersionDisplay(version: string): string {
  const cleaned = version.replace(/^v/, "");
  const match = /^(\d+)\.(\d+)/.exec(cleaned);
  if (!match) return cleaned.endsWith("s") ? cleaned : `${cleaned}s`;
  return `${match[1]}.${match[2]}s`;
}

export const APP_VERSION_DISPLAY = formatVersionDisplay(APP_VERSION);
