import { headers } from "next/headers";

/** Client IP for the user's own session list (not used for rate limiting). */
export async function getDisplayClientIp(): Promise<string> {
  const headerStore = await headers();
  const cf = headerStore.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded
      .split(",")
      .map((p) => p.trim())
      .find(Boolean);
    if (first) return first;
  }

  const realIp = headerStore.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
  if (/CriOS\//i.test(ua)) return "Chrome";
  if (/FxiOS\//i.test(ua)) return "Firefox";
  return "Browser";
}

function detectOs(ua: string): string {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  return "OS";
}

/** Concise web session label: `Chrome · Windows · 203.0.113.10` (max ~120 chars). */
export async function webSessionDeviceName(): Promise<string> {
  const headerStore = await headers();
  const ua = headerStore.get("user-agent") ?? "";
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  const ip = await getDisplayClientIp();
  const label = `${browser} · ${os} · ${ip}`;
  return label.slice(0, 120);
}
