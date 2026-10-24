import Link from "next/link";
import { NAV } from "@/lib/routes";
import { NavLinks } from "./nav-links";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
        <Link href="/" className="text-xl font-bold tracking-tight text-accent">Vouch</Link>
        <nav aria-label="Primary" className="flex flex-wrap gap-1">
          <NavLinks items={NAV} />
        </nav>
      </div>
    </header>
  );
}
