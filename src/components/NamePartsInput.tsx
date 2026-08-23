"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { LatLng } from "@/lib/geo";
import { abbreviateStreetTypes } from "@/lib/streetAbbrev";

interface NamePartChip {
  /** Full speak text stored in the part / input field. */
  speakText: string;
  /** Abbreviated label shown on the chip and in preview. */
  displayText: string;
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
      .then(
        (
          data: {
            osmSpeakText?: string | null;
            osmDisplayText?: string | null;
            osmText?: string | null;
            nearbyParts?: { id: number; text: string; displayText?: string; speakText?: string }[];
          } | null,
        ) => {
          if (cancelled || !data) return;
          const options: NamePartChip[] = [];
          const osmSpeak = data.osmSpeakText ?? data.osmText;
          const osmDisplay = data.osmDisplayText ?? osmSpeak;
          if (osmSpeak && osmDisplay) options.push({ speakText: osmSpeak, displayText: osmDisplay });
          for (const p of data.nearbyParts ?? []) {
            const speakText = p.speakText ?? p.text;
            const displayText = p.displayText ?? p.text;
            if (!options.some((o) => o.speakText === speakText)) {
              options.push({ speakText, displayText });
            }
          }
          setChips(options);
          if (osmSpeak && !part1) onPart1(osmSpeak);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.lat, point.lng]);

  function abbreviateForPreview(text: string): string {
    const chip = chips.find((c) => c.speakText === text);
    return chip?.displayText ?? abbreviateStreetTypes(text);
  }

  const composedPreview = part2
    ? `${abbreviateForPreview(part1)}/${abbreviateForPreview(part2)}`
    : abbreviateForPreview(part1);

  function renderChipRow(onPick: (text: string) => void) {
    if (chips.length === 0) return null;
    return (
      <div className="btn-row" style={{ flexWrap: "wrap", gap: "0.3rem" }}>
        {chips.map((chip) => (
          <button
            key={chip.speakText}
            type="button"
            className="chip"
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => onPick(chip.speakText)}
          >
            {chip.displayText}
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
