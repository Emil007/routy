// Optional third-party CAPTCHA on the login form — off by default (no
// external service, no keys needed). Turned on by setting CAPTCHA_PROVIDER
// (plus the matching site/secret key) directly in docker-compose.yml's
// environment block, the same way COOKIE_SECURE already works. All three
// supported providers share the same verify shape (POST secret + the
// widget's response token, get back JSON with `success`), so one small
// module covers all of them instead of three near-duplicate integrations.

import { log } from "./logger";

export type CaptchaProvider = "none" | "turnstile" | "hcaptcha" | "recaptcha";

interface ProviderInfo {
  scriptSrc: string;
  widgetClass: string;
  verifyUrl: string;
  /** The widget auto-injects a hidden field with this name inside itself once loaded — that's how the token reaches the form. */
  fieldName: string;
}

const PROVIDERS: Record<Exclude<CaptchaProvider, "none">, ProviderInfo> = {
  turnstile: {
    scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    widgetClass: "cf-turnstile",
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    fieldName: "cf-turnstile-response",
  },
  hcaptcha: {
    scriptSrc: "https://js.hcaptcha.com/1/api.js",
    widgetClass: "h-captcha",
    verifyUrl: "https://hcaptcha.com/siteverify",
    fieldName: "h-captcha-response",
  },
  recaptcha: {
    scriptSrc: "https://www.google.com/recaptcha/api.js",
    widgetClass: "g-recaptcha",
    verifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    fieldName: "g-recaptcha-response",
  },
};

function currentProvider(): CaptchaProvider {
  const raw = process.env.CAPTCHA_PROVIDER;
  return raw === "turnstile" || raw === "hcaptcha" || raw === "recaptcha" ? raw : "none";
}

export interface CaptchaClientConfig {
  provider: CaptchaProvider;
  siteKey: string | null;
  scriptSrc: string | null;
  widgetClass: string | null;
}

/** Safe to send to the client: which widget (if any) to render, and its public site key. */
export function getCaptchaConfig(): CaptchaClientConfig {
  const provider = currentProvider();
  if (provider === "none") return { provider, siteKey: null, scriptSrc: null, widgetClass: null };
  const info = PROVIDERS[provider];
  return { provider, siteKey: process.env.CAPTCHA_SITE_KEY ?? null, scriptSrc: info.scriptSrc, widgetClass: info.widgetClass };
}

/** The FormData field name the current provider's widget submits its response token under. */
export function getCaptchaFieldName(): string | null {
  const provider = currentProvider();
  return provider === "none" ? null : PROVIDERS[provider].fieldName;
}

/**
 * Server-only. When no provider is configured this always passes (there's
 * nothing to check). When one *is* configured, a missing token or a failed/
 * unreachable verify call both count as failure — security checks fail
 * closed, unlike the best-effort elevation/geocoding lookups elsewhere.
 */
export async function verifyCaptcha(token: string | null): Promise<boolean> {
  const provider = currentProvider();
  if (provider === "none") return true;
  if (!token) return false;

  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) return false;

  try {
    const res = await fetch(PROVIDERS[provider].verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return data?.success === true;
  } catch (err) {
    log.warn("captcha verify request failed", { provider, error: String(err) });
    return false;
  }
}
