"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { PageBackBar } from "./PageBackBar";
import { returnFromImpersonationAction } from "@/app/actions";
import { t } from "@/lib/i18n";

/**
 * AppChrome (§4.1 / §8.2): entscheidet mit usePathname komplett.
 * /map → .atlas-frame (keine NavBar, kein Container, Karte füllt). Impersonation-Streifen
 * steht oben im Fluss und lässt die Karte den Rest füllen (§J2, §8.1).
 * andere (app)-Pfade ab J5 → PageBackBar statt NavBar + .container.page-dense (§8.2).
 */
export function AppChrome({
  children,
  embedded,
  locale,
  displayName,
  impersonating,
}: {
  children: ReactNode;
  embedded: boolean;
  locale: Locale;
  displayName: string;
  impersonating: boolean;
}) {
  const pathname = usePathname();
  const isMap = pathname === "/map";

  if (isMap) {
    return (
      <div className="atlas-frame">
        {impersonating && (
          <div className="alert alert-error impersonation-strip" style={{ margin: 0 }}>
            {t(locale, "nav.impersonating", { name: displayName })}{" "}
            <form action={returnFromImpersonationAction} style={{ display: "inline" }}>
              <button type="submit" className="btn-secondary" style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}>
                {t(locale, "nav.returnToAdmin")}
              </button>
            </form>
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <main className="container page-dense" style={{ display: "flex", flexDirection: "column" }}>
      {impersonating && (
        <div className="alert alert-error impersonation-strip" style={{ margin: 0 }}>
          {t(locale, "nav.impersonating", { name: displayName })}{" "}
          <form action={returnFromImpersonationAction} style={{ display: "inline" }}>
            <button type="submit" className="btn-secondary" style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}>
              {t(locale, "nav.returnToAdmin")}
            </button>
          </form>
        </div>
      )}
      <PageBackBar locale={locale} embedded={embedded} />
      {children}
    </main>
  );
}
