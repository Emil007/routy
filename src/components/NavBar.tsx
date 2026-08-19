"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { navChromeVisibility } from "@/lib/navChrome";
import { RoutyLogo } from "./RoutyLogo";

export interface NavLink {
  href: string;
  label: string;
}

export function NavBar({
  links,
  greeting,
  logoutLabel,
  version,
  embedded = false,
}: {
  links: NavLink[];
  greeting: string;
  logoutLabel: string;
  version: string;
  /** True for Android admin WebView only — native shell provides nav and logout elsewhere. */
  embedded?: boolean;
}) {
  const pathname = usePathname();
  const { showHeaderChrome, showUserbar } = navChromeVisibility(embedded);

  if (!showHeaderChrome && !showUserbar) return null;

  return (
    <header className="topnav">
      {showHeaderChrome && (
        <>
          <Link href="/route" className="brand">
            <RoutyLogo size={30} />
            Routy
            <span className="brand-version">v{version}</span>
          </Link>
          <nav>
            {links.map((link) => (
              <Link key={link.href} href={link.href} data-active={pathname === link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        </>
      )}
      {showUserbar && (
        <div className="userbar">
          <span>{greeting}</span>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
              {logoutLabel}
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
