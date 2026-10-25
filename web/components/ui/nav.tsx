"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/routes";
import { hashIdFromHref, useLenisAnchor } from "@/lib/scroll/use-lenis-anchor";

export function Nav() {
  const path = usePathname();
  const onHome = path === "/";
  const scrollToId = useLenisAnchor();

  const onHashClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const id = hashIdFromHref(href);
    if (!id) return;
    if (!onHome && href.startsWith("/#")) return; // let Next navigate to /#…
    e.preventDefault();
    scrollToId(id);
  };

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
              aria-current={path === n.href ? "page" : undefined}
              data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={(e) => onHashClick(e, n.href)}
            >
              {n.label}
            </a>
          ))}
          <a
            href={onHome ? "#try" : "/#try"}
            className="nav__cta"
            data-testid="nav-try-claim"
            onClick={(e) => onHashClick(e, onHome ? "#try" : "/#try")}
          >
            Try a claim
          </a>
        </div>
      </nav>
    </header>
  );
}
