"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { useCall } from "@/lib/stdb/hooks";

const cents = (n: bigint | number) => money(Number(n) / 100);

export function FinanceDesk() {
  const params = useSearchParams();
  const [companies] = useTable(tables.financeCompany);
  const [simState] = useTable(tables.financeSimState);
  const call = useCall();
  const [selectedId, setSelectedId] = useState(1);
  const [states] = useTable(tables.financeCompanyState.where((r) => r.companyId.eq(selectedId)));
  const [hours] = useTable(tables.financeStatsHourly.where((r) => r.companyId.eq(selectedId)));
  const [obligations] = useTable(tables.financeObligation.where((r) => r.companyId.eq(selectedId)));
  const [entries] = useTable(tables.financeEntry.where((r) => r.companyId.eq(selectedId)));
  const [queue] = useTable(tables.financeQueue.where((r) => r.companyId.eq(selectedId)));
  const company = companies.find((c) => c.id === selectedId);
  const state = states[0];
  const latest = useMemo(() => [...hours].sort((a, b) => Number(b.simHour - a.simHour))[0], [hours]);
  const openObligations = obligations.filter((o) => o.status === "open");
  const posted = entries.filter((e) => e.status === "posted");
  const unresolved = queue.filter((q) => q.status === "open");
  const claimRef = params.get("claim");
  const isLivePortfolio = !!simState[0];

  return (
    <main className="app-dark mx-auto min-h-screen max-w-[1440px] space-y-5 px-4 py-6 text-ink-dark sm:px-6" data-testid="finance-desk">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section__eyebrow">Vouch · finance operations</p>
          <h1 className="section__title">Refund Finance Desk</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft-dark">One refund changes revenue, cash, a customer&apos;s balance and the next-quarter forecast. The Desk ties those effects back to the Vouch decision and keeps controller sign-off visible.</p>
        </div>
        <Link className="btn btn--secondary btn--sm" href={params.get("refund") ? `/business?refund=${encodeURIComponent(params.get("refund")!)}` : "/business"}>Back to refunds</Link>
      </header>

      <div className="glass flex flex-wrap items-center gap-3 p-3">
        <label htmlFor="desk-company" className="text-sm font-semibold">Company</label>
        <select id="desk-company" className="min-w-56 rounded-md border border-line-dark bg-black/30 px-3 py-2 text-sm" value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
          {[...companies].sort((a, b) => a.id - b.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="chip chip--accent">{isLivePortfolio ? "Simulated" : "Waiting for portfolio"}</span>
        <span className="text-xs text-ink-soft-dark">{companies.length} partner companies · all amounts in USD</span>
        {simState[0] ? <button className="btn btn--secondary btn--sm" onClick={() => void call("financeSetRunning", (r) => r.financeSetRunning({ running: !simState[0]!.running, hoursPerTick: 1 }), simState[0].running ? "Portfolio paused" : "Portfolio started")}>{simState[0].running ? "Pause portfolio" : "Start portfolio"}</button> : null}
        <Link className="text-xs text-accent underline" href="/business">Controller access</Link>
      </div>

      {claimRef ? <div className="glass border border-accent/30 p-3 text-sm" data-testid="desk-claim-context">Finance impact requested for claim <span className="font-mono font-semibold">{claimRef}</span>. The portfolio view below is the company-wide context; claim-level posting details appear once the finance hook records this claim.</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Refund sales impact" value={state ? cents(state.refundedCents) : "—"} note="Simulated portfolio total" />
        <Metric title="Net cash position" value={state ? cents(state.cashCents) : "—"} note="Simulated company cash balance" />
        <Metric title="Open return obligations" value={openObligations.length.toLocaleString()} note={`${cents(openObligations.reduce((s, o) => s + BigInt(o.leg2Cents), 0n))} held for verified returns`} />
        <Metric title="Controller queue" value={unresolved.length.toLocaleString()} note="Items awaiting a human decision" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="glass min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><p className="panel-title">Company activity</p><p className="mt-1 text-xs text-ink-soft-dark">{company?.tagline ?? "Select a company"}</p></div>
            <span className="chip">{state?.rung ?? "normal"} exposure</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Mini label="Orders" value={latest?.orders ?? 0} />
            <Mini label="Refund claims" value={latest?.claims ?? 0} />
            <Mini label="Flagged" value={latest?.flags ?? 0} />
            <Mini label="Investigated" value={latest?.investigations ?? 0} />
          </div>
          <p className="mt-3 text-xs text-ink-soft-dark">Latest simulated hour: {latest?.simHour ?? "waiting for first tick"} · {posted.length} posted journal entries · source: SpacetimeDB finance subledger</p>
        </div>
        <div className="glass p-4">
          <p className="panel-title">Finance controls</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft-dark">
            <li>Double-entry journal entries are checked in the SpacetimeDB reducers.</li>
            <li>Posted entries are append-only; corrections require a new entry.</li>
            <li>Locked periods refuse writes and record the control rule.</li>
            <li>Large entries and pause decisions wait for the controller.</li>
          </ul>
          <p className="mt-3 text-xs">Status: <Badge kind="simulated" /></p>
        </div>
      </section>

      <section className="glass overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-dark p-4">
          <div><p className="panel-title">Return obligations</p><p className="mt-1 text-xs text-ink-soft-dark">A conditional refund leg is accrued until the warehouse confirms the return.</p></div>
          <Badge kind="simulated" />
        </div>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-ink-soft-dark"><tr><th className="p-3">Order</th><th className="p-3">Tier</th><th className="p-3">Held refund</th><th className="p-3">Status</th><th className="p-3">Evidence / outcome</th></tr></thead>
            <tbody>{openObligations.slice(0, 12).map((o) => <tr key={String(o.id)} className="border-t border-line-dark/70"><td className="p-3 font-mono">{o.orderRef}</td><td className="p-3">{o.tier}</td><td className="p-3">{cents(o.leg2Cents)}</td><td className="p-3">{o.status}</td><td className="max-w-sm truncate p-3 text-ink-soft-dark">{o.outcomeNote || `Due after hour ${o.dueHour}`}</td></tr>)}
              {!openObligations.length ? <tr><td className="p-4 text-ink-soft-dark" colSpan={5}>No open obligations for this company yet.</td></tr> : null}</tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-ink-soft-dark">Fictional stores for a hackathon demo. Names are parodies; no affiliation with any real company; no real logos. All data is simulated.</p>
    </main>
  );
}

function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className="glass p-4"><p className="text-xs text-ink-soft-dark">{title}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-ink-soft-dark">{note}</p><Badge kind="simulated" /></div>;
}

function Mini({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line-dark/70 p-3"><p className="text-xs text-ink-soft-dark">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p></div>;
}
