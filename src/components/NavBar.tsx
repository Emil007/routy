"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { setLocaleAction } from "@/app/actions";
import { logoutAction } from "@/app/actions";

export interface NavLink {
  href: string;
  label: string;
}

export function NavBar({
  links,
  greeting,
  logoutLabel,
  locale,
}: {
  links: NavLink[];
  greeting: string;
  logoutLabel: string;
  locale: string;
}) {
  const pathname = usePathname();

  return (
    <header className="topnav">
      <Link href="/route" className="brand">
        🐾 Routy
      </Link>
      <nav>
        {links.map((link) => (
          <Link key={link.href} href={link.href} data-active={pathname === link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="userbar">
        <span>{greeting}</span>
        <form action={setLocaleAction}>
          <input type="hidden" name="locale" value={locale === "de" ? "en" : "de"} />
          <button type="submit" className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
            {locale === "de" ? "EN" : "DE"}
          </button>
        </form>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
            {logoutLabel}
          </button>
        </form>
      </div>
    </header>
  );
}
