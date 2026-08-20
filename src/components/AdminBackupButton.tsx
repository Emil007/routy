"use client";

import { useState } from "react";

export function AdminBackupButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function download() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `routy-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-secondary btn-compact" onClick={() => void download()} disabled={busy}>
        {label}
      </button>
      {error && <p className="hint" style={{ color: "var(--danger, #a33)" }}>Backup failed</p>}
    </div>
  );
}
