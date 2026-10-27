"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { NavBar } from "@/components/NavBar";
import { returnFromImpersonationAction } from "@/app/actions";
import { APP_VERSION_DISPLAY } from "@/lib/version";
import { t } from "@/lib/i18n";

/**
 * AppChrome (§4.1 / §8.2): entscheidet mit usePathname komplett.
 * /map → .atlas-frame (keine NavBar, kein Container, Karte füllt). Impersonation-Streifen
 * steht oben im Fluss und lässt die Karte den Rest füllen (§J2, §8.1).
 * andere (app)-Pfade → bis J5 weiter NavBar + .container.page-dense (§8.2).
 */
export function AppChrome({
  children,
  embedded,
  locale,
  displayName,
  isAdmin,
  impersonating,
}: {
  children: ReactNode;
  embedded: boolean;
  locale: Locale;
  displayName: string;
  isAdmin: boolean;
  impersonating: boolean;
}) {
  const pathname = usePathname();
  const isMap = pathname === "/map";

  const links = [
    { href: "/route", label: t(locale, "nav.route") },
    { href: "/map", label: t(locale, "nav.map") },
    { href: "/stats", label: t(locale, "nav.stats") },
    { href: "/settings", label: t(locale, "nav.settings") },
    ...(isAdmin ? [{ href: "/admin", label: t(locale, "nav.admin") }] : []),
  ];

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
      <NavBar
        links={links}
        greeting={t(locale, "nav.greeting", { name: displayName })}
        logoutLabel={t(locale, "nav.logout")}
        version={APP_VERSION_DISPLAY}
        embedded={embedded}
      />
      {children}
    </main>
  );
}
