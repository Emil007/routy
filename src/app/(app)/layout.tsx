import { requireUser } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { NavBar } from "@/components/NavBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);

  const links = [
    { href: "/route", label: t(locale, "nav.route") },
    { href: "/import", label: t(locale, "nav.import") },
    { href: "/map", label: t(locale, "nav.map") },
    { href: "/stats", label: t(locale, "nav.stats") },
    { href: "/settings", label: t(locale, "nav.settings") },
  ];

  return (
    <>
      <NavBar
        links={links}
        greeting={t(locale, "nav.greeting", { name: user.displayName })}
        logoutLabel={t(locale, "nav.logout")}
        locale={locale}
      />
      <main className="container">{children}</main>
    </>
  );
}
