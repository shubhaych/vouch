"use client";

import { useState } from "react";

const STACK = [
  {
    name: "SpacetimeDB",
    role: "Simulates 10,000 shopping agents and refund activity behind the merchant view.",
    note: "All simulation results are labeled Simulated — never as observed real-world fraud rates.",
  },
  {
    name: "Factory",
    role: "Analyzes the submitted video claim and surfaces evidence for the merchant case.",
    note: "Analysis can flag mismatches; it does not prove a video is authentic on its own.",
  },
  {
    name: "Creao",
    role: "Manages trust updates and refund / risk operations after a confirmed decision.",
    note: "Score changes follow confirmed outcomes, not flags alone.",
  },
] as const;

export function PoweredBy() {
  const [open, setOpen] = useState(false);

  return (
    <section className="section journey-section journey-section--compact" id="powered" data-testid="powered-by">
      <button
        type="button"
        className="powered-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="powered-toggle"
      >
        <div>
          <p className="section__eyebrow mb-1">How the demo is powered</p>
          <h2 className="text-xl font-bold tracking-tight">Sponsors inside this claim — not a slide afterthought.</h2>
        </div>
        <span className="powered-toggle__chevron">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div className="powered-grid">
          {STACK.map((s) => (
            <article key={s.name} className="powered-card">
              <h3 className="font-bold">{s.name}</h3>
              <p className="mt-2 text-sm text-ink-soft">{s.role}</p>
              <p className="mt-2 text-xs text-ink-soft">{s.note}</p>
              <span className="badge badge--simulated mt-3">Simulated / demo</span>
            </article>
          ))}
          <aside className="powered-card powered-card--note">
            <h3 className="font-bold">Auditable outcomes, private evidence</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Confirmed outcomes can be made tamper-evident without putting customer videos, identities,
              or order details on a public ledger. A verifiable record of score changes is the clearer trust claim
              than “everything is on-chain.”
            </p>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
