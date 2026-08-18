"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { LatLng } from "@/lib/geo";

interface NamePartChip {
  text: string;
}

/**
 * The two-part name editor (Teil 1 / Teil 2 + clickable OSM/nearby-part suggestion
 * chips + live preview) shared by the "create a new node" flow (EndpointFields) and
 * renaming an existing node from its map popup — same UI, same suggestion pool, so
 * links built from either place grow the same reusable network.
 *
 * Each field gets its own chip row directly under it, so clicking a suggestion always
 * lands in the field you clicked under — no guessing which field a click will fill.
 * The separator between the two parts is always "/"; offering a choice here wasn't
 * worth the confusion once parts start getting concatenated in shortened route text.
 */
export function NamePartsInput({
  locale,
  point,
  part1,
  part2,
  onPart1,
  onPart2,
}: {
  locale: Locale;
  point: LatLng;
  part1: string;
  part2: string;
  onPart1: (v: string) => void;
  onPart2: (v: string) => void;
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

  const composedPreview = part2 ? `${part1}/${part2}` : part1;

  function renderChipRow(onPick: (text: string) => void) {
    if (chips.length === 0) return null;
    return (
      <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.3rem" }}>
        {chips.map((chip) => (
          <button key={chip.text} type="button" className="chip" style={{ cursor: "pointer", border: "none" }} onClick={() => onPick(chip.text)}>
            {chip.text}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <input type="text" value={part1} onChange={(e) => onPart1(e.target.value)} placeholder={t(locale, "import.namePart1")} />
      {renderChipRow(onPart1)}
      <input type="text" value={part2} onChange={(e) => onPart2(e.target.value)} placeholder={t(locale, "import.namePart2")} />
      {renderChipRow(onPart2)}
      {composedPreview && (
        <p className="hint">
          {t(locale, "import.nameComposedPreview")}: <strong>{composedPreview}</strong>
        </p>
      )}
    </div>
  );
}
