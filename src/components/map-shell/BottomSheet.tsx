"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t, type Locale } from "@/lib/i18n";
import { useMapShell } from "./MapShellContext";
import type { AtlasStage } from "@/lib/atlasTypes";

const STAGE_HEIGHT: Record<AtlasStage, string | null> = {
  hidden: "0px",
  peek: "var(--sheet-cover-peek)",
  half: "var(--sheet-cover-half)",
  full: "var(--sheet-cover-full)",
  profile: "var(--sheet-cover-full)",
  stats: "var(--sheet-cover-full)",
  settings: "var(--sheet-cover-full)",
  web: "var(--sheet-cover-full)",
  editMenu: "var(--sheet-cover-half)",
  node: "var(--sheet-cover-half)",
  segment: "var(--sheet-cover-half)",
};

function useDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 960px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/**
 * Sheet-Behälter der Hülle: Telefon unten, ab 960px rechts (Desktop/Tablet-Panel).
 * Genau eine Sheet-Stufe ist sichtbar; Esc schließt zuerst das Profil, dann eine Stufe.
 * isDesktop kommt aus useEffect → kein Hydration-Mismatch, sauberes Dev-Gate.
 */
export function BottomSheet({ locale, children }: { locale: Locale; children: ReactNode }) {
  const { stage, setStage, profileOpen, setProfileOpen } = useMapShell();
  const isDesktop = useDesktop();
  // 0.57: Das Profil-Menü schwebt als Dropdown ÜBER der Karte — es klappt das
  // darunterliegende Sheet NICHT zusätzlich auf (vorher „profil“-Stage = voll).
  const openStage = stage;
  const height = STAGE_HEIGHT[openStage] ?? "var(--sheet-cover-half)";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (profileOpen) setProfileOpen(false);
      else if (stage !== "hidden" && stage !== "peek") setStage("peek");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profileOpen, setProfileOpen, stage, setStage]);

  const hidden = openStage === "hidden" || openStage === "peek" || profileOpen;

  return (
    <>
      <section
        className={`sheet ${isDesktop ? "sheet-panel" : "sheet-bottom"} ${hidden ? "sheet-peeked" : ""}`}
        style={hidden ? undefined : isDesktop ? undefined : { height }}
        aria-hidden={hidden}
      >
        {children}
      </section>
      {/* 0.57: Einklapp-Pfeil am Rand statt „Ausblenden“-Button. Liegt AUSSERHALB des
          transformierten Sheets, damit er auch eingeklappt klickbar bleibt.
          Desktop: rechts außen am Panel, Telefon: unterhalb des Peek-Streifens. */}
      {!profileOpen && openStage !== "hidden" && (
        <button
          type="button"
          className={`sheet-collapse-arrow${isDesktop ? " desktop" : " bottom"}${stage === "peek" ? " collapsed" : ""}`}
          aria-label={t(locale, "shell.collapse")}
          title={t(locale, "shell.collapse")}
          onClick={() => setStage(stage === "peek" ? "half" : "peek")}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </>
  );
}
