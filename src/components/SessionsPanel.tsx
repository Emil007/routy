"use client";

import { useCallback, useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";

interface SessionEntry {
  sessionId: string;
  deviceName: string | null;
  client: "web" | "app";
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function formatSessionDate(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function sessionLabel(session: SessionEntry, locale: Locale): string {
  if (session.deviceName) return session.deviceName;
  return session.client === "app" ? t(locale, "settings.sessionsClientApp") : t(locale, "settings.sessionsClientWeb");
}

/** Lists signed-in devices and allows revoking individual sessions. */
export function SessionsPanel({ locale }: { locale: Locale }) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/sessions");
      if (!res.ok) {
        setError(true);
        setSessions([]);
        return;
      }
      const data = (await res.json()) as { sessions: SessionEntry[] };
      setSessions(data.sessions ?? []);
    } catch {
      setError(true);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function revoke(sessionId: string) {
    setRevokingId(sessionId);
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      }
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="stack">
      <h2>{t(locale, "settings.sessionsTitle")}</h2>
      <p className="hint-compact">{t(locale, "settings.sessionsSubtitle")}</p>
      {loading && <p className="hint">{t(locale, "settings.sessionsLoading")}</p>}
      {error && <div className="alert alert-error">{t(locale, "settings.sessionsLoadError")}</div>}
      {!loading && !error && sessions.length === 0 && (
        <p className="hint">{t(locale, "settings.sessionsEmpty")}</p>
      )}
      {!loading && sessions.length > 0 && (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "0.5rem" }}>
          {sessions.map((session) => (
            <li key={session.sessionId} className="card" style={{ padding: "0.6rem 0.75rem" }}>
              <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{sessionLabel(session, locale)}</strong>
                  {session.isCurrent && (
                    <span className="hint" style={{ marginLeft: "0.4rem" }}>
                      ({t(locale, "settings.sessionsCurrent")})
                    </span>
                  )}
                  <div className="hint" style={{ marginTop: "0.15rem" }}>
                    {formatSessionDate(session.createdAt, locale)}
                  </div>
                </div>
                {!session.isCurrent && (
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    disabled={revokingId === session.sessionId}
                    onClick={() => revoke(session.sessionId)}
                  >
                    {t(locale, "settings.sessionsRevoke")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
