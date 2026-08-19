import { APP_VERSION } from "./version";

export interface UpdateInfo {
  latestVersion: string;
  url: string;
}

declare global {

  var __routyUpdateCheck: Promise<UpdateInfo | null> | undefined;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch("https://api.github.com/repos/Emil007/routy/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) return null;
    return {
      latestVersion: data.tag_name.replace(/^v/, ""),
      url: data.html_url ?? "https://github.com/Emil007/routy/releases",
    };
  } catch {
    return null;
  }
}

/** Best-effort, checked once per server process (cached in a global) rather than once per request. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!globalThis.__routyUpdateCheck) {
    globalThis.__routyUpdateCheck = fetchLatestRelease();
  }
  return globalThis.__routyUpdateCheck;
}

export function isUpdateAvailable(latestVersion: string): boolean {
  return isNewer(latestVersion, APP_VERSION);
}
