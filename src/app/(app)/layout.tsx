import { requireUser, isImpersonating } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { NavBar } from "@/components/NavBar";
import { returnFromImpersonationAction } from "@/app/actions";
import { APP_VERSION_DISPLAY } from "@/lib/version";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const impersonating = await isImpersonating();

  const links = [
    { href: "/route", label: t(locale, "nav.route") },
    { href: "/map", label: t(locale, "nav.map") },
    { href: "/stats", label: t(locale, "nav.stats") },
    { href: "/settings", label: t(locale, "nav.settings") },
    ...(user.role === "admin" ? [{ href: "/admin", label: t(locale, "nav.admin") }] : []),
  ];

  return (
    <>
      {/* client=app → admin WebView only; native Android tabs authenticate via Bearer token */}
      <NavBar
        links={links}
        greeting={t(locale, "nav.greeting", { name: user.displayName })}
        logoutLabel={t(locale, "nav.logout")}
        version={APP_VERSION_DISPLAY}
        embedded={user.client === "app"}
      />
      {impersonating && (
        <div className="alert alert-error" style={{ margin: "0 0 0", borderRadius: 0 }}>
          {t(locale, "nav.impersonating", { name: user.displayName })}{" "}
          <form action={returnFromImpersonationAction} style={{ display: "inline" }}>
            <button type="submit" className="btn-secondary" style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}>
              {t(locale, "nav.returnToAdmin")}
            </button>
          </form>
        </div>
      )}
      <main className="container page-dense">{children}</main>
    </>
  );
}
