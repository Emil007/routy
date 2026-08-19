import pkg from "../../package.json";

/** Full semver from package.json (e.g. "0.20.0"). */
export const APP_VERSION = pkg.version;

/** UI-friendly version — 0.20.0 → "0.2", 0.16.0 → "0.16". */
export function formatVersionDisplay(version: string): string {
  const parts = version.split(".");
  if (parts.length >= 3 && parts[2] === "0") {
    const minor = Number.parseInt(parts[1] ?? "0", 10);
    if (minor % 10 === 0 && minor >= 10) {
      return `${parts[0]}.${minor / 10}`;
    }
    return `${parts[0]}.${minor}`;
  }
  return version.replace(/\.0$/, "");
}

export const APP_VERSION_DISPLAY = formatVersionDisplay(APP_VERSION);
