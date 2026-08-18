"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions";
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
}: {
  links: NavLink[];
  greeting: string;
  logoutLabel: string;
  version: string;
}) {
  const pathname = usePathname();

  return (
    <header className="topnav">
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
      <div className="userbar">
        <span>{greeting}</span>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
            {logoutLabel}
          </button>
        </form>
      </div>
    </header>
  );
}
