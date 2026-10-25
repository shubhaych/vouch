"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/routes";

export function Nav() {
  const path = usePathname();
  const onHome = path === "/";

  return (
    <header className={`nav-shell ${onHome ? "nav-shell--over-hero" : ""}`}>
      <nav className="nav" aria-label="Main">
        <Link href="/" className="nav__brand" data-testid="nav-home">
          Vouch
        </Link>
        <div className="nav__links">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="nav__link"
              data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {n.label}
            </a>
          ))}
          <a href={onHome ? "#demo" : "/#demo"} className="nav__cta" data-testid="nav-see-demo">
            Watch the demo
          </a>
        </div>
      </nav>
    </header>
  );
}
