"use client";

import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";

/**
 * „Zurück zur Karte“-Leiste für die Nicht-Karten-Seiten. Browser: <Link href="/map">
 * (RSC-Navigation). embedded: sichtbare Leiste, gleiche Tokens — nichts navigieren,
 * der WebView fängt /map ab und ruft onDismiss (RoutyWebView).
 */
export function PageBackBar({ locale, embedded }: { locale: Locale; embedded: boolean }) {
  const label = t(locale, "shell.backToMap");
  if (embedded) {
    return (
      <div className="page-back">
        <button type="button" className="page-back-link" tabIndex={-1} aria-hidden="true">
          ← {label}
        </button>
      </div>
    );
  }
  return (
    <div className="page-back">
      <Link href="/map" className="page-back-link">
        ← {label}
      </Link>
    </div>
  );
}
