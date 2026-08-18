"use client";

import Script from "next/script";
import type { CaptchaClientConfig } from "@/lib/captcha";

/** Renders nothing when no provider is configured — the common case. */
export function CaptchaWidget({ config }: { config: CaptchaClientConfig }) {
  if (config.provider === "none" || !config.siteKey || !config.scriptSrc || !config.widgetClass) return null;

  return (
    <>
      <Script src={config.scriptSrc} async defer />
      <div className={config.widgetClass} data-sitekey={config.siteKey} />
    </>
  );
}
