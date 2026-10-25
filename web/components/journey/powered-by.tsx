"use client";

import { useState } from "react";

const STACK = [
  {
    name: "SpacetimeDB",
    role: "The only database. Your claim, every analysis step, every finding and decision, and every score change are rows the phone and the merchant desk watch live. The 10,000-agent economy runs inside it as a scheduled reducer.",
    note: "The shoppers are simulated; your claim and video are real.",
    badge: "Live",
  },
  {
    name: "Factory",
    role: "A fenced Droid session investigates your video: it reads frames, runs measurement probes, records one finding per spoken claim with a cited clip, and a second session audits every finding.",
    note: "Findings are internally consistent, not proof that a video is authentic.",
    badge: "Live",
  },
  {
    name: "CREAO",
    role: "Saved agents review the Droid report, propose accept or decline, and a three-agent panel decides how far the Vouch score moves, inside fixed bounds.",
    note: "The score moves only after a confirmed verdict; a kill switch puts every claim back with a person.",
    badge: "Live",
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
              <span className="badge badge--live mt-3">{s.badge}</span>
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
