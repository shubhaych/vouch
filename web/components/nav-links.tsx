"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/routes";

const active = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(path, i.href) ? "page" : undefined}
          className="rounded-md px-3 py-1.5 font-medium text-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
        >
          {i.label}
        </Link>
      ))}
    </>
  );
}

export function TabLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="mb-6 flex gap-1 border-b border-line">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(path, i.href) ? "page" : undefined}
          className="-mb-px border-b-2 border-transparent px-4 py-2 font-medium text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:text-accent"
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
