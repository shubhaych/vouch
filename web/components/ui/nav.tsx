"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { NAV } from "@/lib/routes";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { Badge } from "./badge";

export function Nav() {
  const path = usePathname();
  const { status, identity } = useStatus();
  const [runs] = useTable(tables.simRun);
  const [roles] = useTable(tables.role);
  const call = useCall();
  const run = runs[0];
  const isController = roles.some((r) => r.role === "controller" && r.who.toHexString() === identity);

  const reset = () => {
    if (!run) return;
    if (!confirm("Reset the demo: reseed the economy (seed 11, 10,000 agents) and replay the showcase? Live shoppers and claims are cleared.")) return;
    void call("seedWorld", (r) => r.seedWorld({ seed: 11n, population: run.population || 10_000, force: true }), "Demo reset: the economy was reseeded");
  };

  return (
    <header className="nav-shell">
      <nav className="nav" aria-label="Main">
        <Link href="/" className="nav__brand" data-testid="nav-home">
          <span className="nav__brand-mark" aria-hidden />
          Vouch
        </Link>
        <div className="nav__links">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav__link hidden sm:inline" aria-current={path.startsWith(n.href) ? "page" : undefined} data-testid={`nav-${n.label.toLowerCase()}`}>
              {n.label}
            </Link>
          ))}
          <span className="nav__live" data-testid="nav-live" title={status === "live" ? "Connected to SpacetimeDB" : status === "error" ? "SpacetimeDB connection failed" : "Connecting to SpacetimeDB"}>
            <span className={`dot ${status === "live" ? "dot--live" : status === "error" ? "dot--off" : "dot--wait"}`} />
            {run?.seeded ? <>Day {run.day} <Badge kind="live" /></> : status === "live" ? "not seeded" : status}
          </span>
          {isController ? (
            <button className="btn btn--glow btn--sm" onClick={reset} data-testid="run-demo">Run demo</button>
          ) : (
            <Link href="/world" className="btn btn--glow btn--sm hidden md:inline-flex">Enter World</Link>
          )}
        </div>
      </nav>
      <div className="flex justify-center gap-4 pt-2 sm:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav__link text-xs" aria-current={path.startsWith(n.href) ? "page" : undefined}>{n.label}</Link>
        ))}
      </div>
    </header>
  );
}
