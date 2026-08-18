"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { LatLng } from "@/lib/geo";

interface NamePartChip {
  text: string;
}

/**
 * The two-part name editor (Teil 1 / Teil 2 + separator + clickable OSM/nearby-part
 * suggestion chips + live preview) shared by the "create a new node" flow
 * (EndpointFields) and renaming an existing node from its map popup — same UI, same
 * suggestion pool, so links built from either place grow the same reusable network.
 */
export function NamePartsInput({
  locale,
  point,
  part1,
  part2,
  separator,
  onPart1,
  onPart2,
  onSeparator,
}: {
  locale: Locale;
  point: LatLng;
  part1: string;
  part2: string;
  separator: "/" | " ";
  onPart1: (v: string) => void;
  onPart2: (v: string) => void;
  onSeparator: (v: "/" | " ") => void;
}) {
  const [chips, setChips] = useState<NamePartChip[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nodes/suggest-name-parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: point.lat, lng: point.lng }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { osmText?: string | null; nearbyParts?: { id: number; text: string }[] } | null) => {
        if (cancelled || !data) return;
        const options: NamePartChip[] = [];
        if (data.osmText) options.push({ text: data.osmText });
        for (const p of data.nearbyParts ?? []) {
          if (!options.some((o) => o.text === p.text)) options.push({ text: p.text });
        }
        setChips(options);
        if (data.osmText && !part1) onPart1(data.osmText);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.lat, point.lng]);

  const composedPreview = part2 ? `${part1}${separator}${part2}` : part1;

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <input type="text" value={part1} onChange={(e) => onPart1(e.target.value)} placeholder={t(locale, "import.namePart1")} />
      {chips.length > 0 && (
        <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.3rem" }}>
          {chips.map((chip) => (
            <button
              key={chip.text}
              type="button"
              className="chip"
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => (part1 ? onPart2(chip.text) : onPart1(chip.text))}
            >
              {chip.text}
            </button>
          ))}
        </div>
      )}
      <div className="btn-row" style={{ alignItems: "center" }}>
        <select
          value={separator}
          onChange={(e) => onSeparator(e.target.value as "/" | " ")}
          style={{ width: "auto" }}
          aria-label={t(locale, "import.nameSeparator")}
        >
          <option value="/">/</option>
          <option value=" ">{t(locale, "import.nameSeparatorSpace")}</option>
        </select>
        <input type="text" value={part2} onChange={(e) => onPart2(e.target.value)} placeholder={t(locale, "import.namePart2")} />
      </div>
      {composedPreview && (
        <p className="hint">
          {t(locale, "import.nameComposedPreview")}: <strong>{composedPreview}</strong>
        </p>
      )}
    </div>
  );
}
