"use client";

import { t, type Locale } from "@/lib/i18n";
import type { NodeCandidate } from "@/lib/nodeMatching";
import type { LatLng } from "@/lib/geo";
import { NamePartsInput } from "./NamePartsInput";

export function EndpointFields({
  locale,
  role,
  point,
  candidates,
  nameConflict,
  decisionChoice,
  decisionNodeId,
  decisionPart1,
  decisionPart2,
  decisionSeparator,
  onChoice,
  onNodeId,
  onPart1,
  onPart2,
  onSeparator,
}: {
  locale: Locale;
  role: "start" | "end" | "split";
  point: LatLng;
  candidates: NodeCandidate[];
  nameConflict: NodeCandidate | null;
  decisionChoice: "existing" | "new";
  decisionNodeId: number | null;
  decisionPart1: string;
  decisionPart2: string;
  decisionSeparator: "/" | " ";
  onChoice: (v: "existing" | "new") => void;
  onNodeId: (v: number) => void;
  onPart1: (v: string) => void;
  onPart2: (v: string) => void;
  onSeparator: (v: "/" | " ") => void;
}) {
  return (
    <div className="field">
      <label>
        {t(locale, role === "start" ? "import.startNode" : role === "end" ? "import.endNode" : "edit.splitPointLabel")}
      </label>
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
          {[...candidates]
            .sort((a, b) => (a.name || `#${a.id}`).localeCompare(b.name || `#${b.id}`, locale))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || `#${c.id}`} ({Math.round(c.distanceM)} m)
              </option>
            ))}
        </select>
      ) : (
        <NamePartsInput
          locale={locale}
          point={point}
          part1={decisionPart1}
          part2={decisionPart2}
          separator={decisionSeparator}
          onPart1={onPart1}
          onPart2={onPart2}
          onSeparator={onSeparator}
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
