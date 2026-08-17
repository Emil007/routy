"use client";

import { t, type Locale } from "@/lib/i18n";
import type { NodeCandidate } from "@/lib/nodeMatching";

export function EndpointFields({
  locale,
  role,
  candidates,
  nameConflict,
  decisionChoice,
  decisionNodeId,
  decisionNewName,
  onChoice,
  onNodeId,
  onNewName,
}: {
  locale: Locale;
  role: "start" | "end";
  candidates: NodeCandidate[];
  nameConflict: NodeCandidate | null;
  decisionChoice: "existing" | "new";
  decisionNodeId: number | null;
  decisionNewName: string;
  onChoice: (v: "existing" | "new") => void;
  onNodeId: (v: number) => void;
  onNewName: (v: string) => void;
}) {
  return (
    <div className="field">
      <label>{t(locale, role === "start" ? "import.startNode" : "import.endNode")}</label>
      <div className="btn-row" style={{ marginBottom: "0.4rem" }}>
        <button
          type="button"
          className={decisionChoice === "existing" ? "btn-primary" : "btn-secondary"}
          disabled={candidates.length === 0}
          onClick={() => onChoice("existing")}
        >
          {t(locale, "import.useExisting")}
        </button>
        <button type="button" className={decisionChoice === "new" ? "btn-primary" : "btn-secondary"} onClick={() => onChoice("new")}>
          {t(locale, "import.createNew")}
        </button>
      </div>
      {decisionChoice === "existing" ? (
        <select value={decisionNodeId ?? ""} onChange={(e) => onNodeId(Number(e.target.value))}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `#${c.id}`} ({Math.round(c.distanceM)} m)
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={decisionNewName}
          onChange={(e) => onNewName(e.target.value)}
          placeholder={t(locale, "import.newNodeName")}
        />
      )}
      {nameConflict && (
        <p className="alert alert-error" style={{ marginTop: "0.4rem" }}>
          {t(locale, "import.nameConflictWarning", {
            name: nameConflict.name ?? "",
            distance: Math.round(nameConflict.distanceM),
          })}
        </p>
      )}
    </div>
  );
}
