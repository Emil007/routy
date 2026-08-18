"use client";

import { useEffect } from "react";

/** Registers the service worker once on mount — no UI, just the side effect. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
