"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";

export function BackfillElevationButton({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setStatus("running");
    setMessage(null);
    const res = await fetch("/api/segments/backfill-elevation", { method: "POST" });
    if (res.ok) {
      const data = (await res.json()) as { updated: number; attempted: number };
      setStatus("idle");
      setMessage(t(locale, "settings.elevationBackfillResult", { updated: data.updated, attempted: data.attempted }));
      router.refresh();
    } else {
      setStatus("error");
      setMessage(t(locale, "common.error"));
    }
  }

  return (
    <div className="field">
      <button type="button" className="btn-secondary" onClick={run} disabled={status === "running"}>
        {status === "running" ? t(locale, "settings.elevationBackfillRunning") : t(locale, "settings.elevationBackfillButton")}
      </button>
      {message && <span className="hint">{message}</span>}
    </div>
  );
}
