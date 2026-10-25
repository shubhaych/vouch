"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { useCall } from "@/lib/stdb/hooks";
import { WORKER_URL } from "@/lib/stdb/config";
import { toast } from "@/components/ui/toast";

const cents = (n: bigint | number) => money(Number(n) / 100);
const PERIODS = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10"];
const FINANCE_SEATS = [
  ["impact_analyst", "Finance Impact Analyst"], ["impact_reviewer", "Finance Impact Reviewer"],
  ["close_controller", "Close Controller"], ["advisor", "Forecast and Drivers Advisor"], ["guardian", "Exposure Guardian"],
] as const;

export function FinanceDesk() {
  const params = useSearchParams();
  const [companies] = useTable(tables.financeCompany);
  const [simState] = useTable(tables.financeSimState);
  const call = useCall();
  const [selectedId, setSelectedId] = useState(1);
  const [period, setPeriod] = useState("2026-09");
  const [controllerCode, setControllerCode] = useState("");
  const [closing, setClosing] = useState(false);
  const [states] = useTable(tables.financeCompanyState.where((r) => r.companyId.eq(selectedId)));
  const [hours] = useTable(tables.financeStatsHourly.where((r) => r.companyId.eq(selectedId)));
  const [obligations] = useTable(tables.financeObligation.where((r) => r.companyId.eq(selectedId)));
  const [entries] = useTable(tables.financeEntry.where((r) => r.companyId.eq(selectedId)));
  const [queue] = useTable(tables.financeQueue.where((r) => r.companyId.eq(selectedId)));
  const [closes] = useTable(tables.financeClose.where((r) => r.companyId.eq(selectedId)));
  const [bridgeRows] = useTable(tables.financeBridge.where((r) => r.companyId.eq(selectedId)));
  const [clusterRows] = useTable(tables.financeCluster.where((r) => r.companyId.eq(selectedId)));
  const [agentRuns] = useTable(tables.financeAgentRun.where((r) => r.companyId.eq(selectedId)));
  const [agentSetup, setAgentSetup] = useState<Record<string, { configured: boolean; found: boolean; nameMatches: boolean; checked: boolean }> | null>(null);
  const [claimAnalysis, setClaimAnalysis] = useState("idle");
  const company = companies.find((c) => c.id === selectedId);
  const state = states[0];
  const latest = useMemo(() => [...hours].sort((a, b) => Number(b.simHour - a.simHour))[0], [hours]);
  const openObligations = obligations.filter((o) => o.status === "open");
  const posted = entries.filter((e) => e.status === "posted");
  const unresolved = queue.filter((q) => q.status === "open");
  const claimRef = params.get("claim");
  const isLivePortfolio = !!simState[0];
  const close = closes.find((c) => c.period === period);
  const bridge = bridgeRows.filter((b) => b.period === period).sort((a, b) => Number(b.id - a.id));
  const periodClusters = clusterRows.filter((c) => c.period === period);
  const exceptionClusters = periodClusters.filter((c) => !c.cls.startsWith("driver:"));
  const driverClusters = periodClusters.filter((c) => c.cls.startsWith("driver:")).sort((a, b) => Number(b.cents - a.cents));

  useEffect(() => {
    let active = true;
    fetch(`${WORKER_URL}/finance/creao/status`).then((r) => r.ok ? r.json() : []).then((rows: { seat: string; configured: boolean; found: boolean; nameMatches: boolean; checked: boolean }[]) => {
      if (active) setAgentSetup(Object.fromEntries(rows.map((r) => [r.seat, { configured: r.configured, found: r.found, nameMatches: r.nameMatches, checked: r.checked }])));
    }).catch(() => { if (active) setAgentSetup(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!claimRef || selectedId !== 1) return;
    let active = true;
    setClaimAnalysis("checking final decision");
    fetch(`${WORKER_URL}/finance/claim/${encodeURIComponent(claimRef)}/analyze`, { method: "POST" })
      .then(async (response) => {
        const body = await response.json() as { status?: string; error?: string };
        if (!response.ok) throw new Error(body.error || `Analysis request failed (${response.status})`);
        if (active) setClaimAnalysis(body.status === "already_recorded" ? "already recorded" : "queued after final decision");
      })
      .catch((error: Error) => { if (active) setClaimAnalysis(error.message); });
    return () => { active = false; };
  }, [claimRef, selectedId]);

  const latestRuns = useMemo(() => {
    const bySeat = new Map<string, typeof agentRuns[number]>();
    for (const run of agentRuns) {
      const previous = bySeat.get(run.seat);
      if (!previous || run.at.microsSinceUnixEpoch > previous.at.microsSinceUnixEpoch) bySeat.set(run.seat, run);
    }
    return bySeat;
  }, [agentRuns]);

  const runClose = async () => {
    setClosing(true);
    try {
      const response = await fetch(`${WORKER_URL}/finance/close/${period}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: controllerCode }),
      });
      const body = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(body.error || `Close failed (${response.status})`);
      toast(`Close ${period} recorded. Review the bridge before locking.`, "honest");
    } catch (error) {
      toast((error as Error).message || `Finance worker at ${WORKER_URL} is unavailable.`, "fraud");
    } finally {
      setClosing(false);
    }
  };

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

      {claimRef ? <div className="glass border border-accent/30 p-3 text-sm" data-testid="desk-claim-context">Finance impact requested for claim <span className="font-mono font-semibold">{claimRef}</span>. Company-books agents run only after the business decision is final. <span className="ml-1 text-xs text-ink-soft-dark">{claimAnalysis}</span></div> : null}

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

      <section className="glass space-y-4 p-4" data-testid="finance-close">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="panel-title">Period close · three-way reconciliation</p><p className="mt-1 text-xs text-ink-soft-dark">Processor is authoritative for cash movement, the bank for settlement, and the Vouch log for authorization. The ledger is derived.</p></div>
          <Badge kind="simulated" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-soft-dark">Period<select className="mt-1 block rounded-md border border-line-dark bg-black/30 px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select></label>
          {selectedId === 1 ? <>
            <label className="text-xs text-ink-soft-dark">Controller code<input className="mt-1 block w-48 rounded-md border border-line-dark bg-black/30 px-3 py-2 text-sm" type="password" value={controllerCode} onChange={(e) => setControllerCode(e.target.value)} /></label>
            <button className="btn btn--primary btn--sm" onClick={() => void runClose()} disabled={closing || !controllerCode}>{closing ? "Reconciling…" : "Run close"}</button>
          </> : <p className="text-xs text-ink-soft-dark">Lite-company close uses its in-module ledger; the one-million-order reconciliation is available for Brindle &amp; Co.</p>}
        </div>
        {close ? <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <Mini label="Ledger" value={Number(close.ledgerCents) / 100} formatMoney />
            <Mini label="Processor" value={Number(close.processorCents) / 100} formatMoney />
            <Mini label="Bank" value={Number(close.bankCents) / 100} formatMoney />
            <Mini label="Matched / events" value={`${close.matched.toLocaleString()} / ${close.events.toLocaleString()}`} />
            <Mini label="Close status" value={close.status} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Mini label="Closed by playbook" value={close.closedByPlaybook} />
            <Mini label="To investigator" value={close.toInvestigator} />
            <Mini label="To controller" value={close.toController} />
            <Mini label="Unexplained $" value={Number(close.unexplainedCents) / 100} formatMoney />
          </div>
          <p className="text-xs text-ink-soft-dark">{close.memo}</p>
        </> : <p className="text-sm text-ink-soft-dark">No close snapshot for {period} yet.</p>}
        {bridge.length ? <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="text-xs text-ink-soft-dark"><tr><th className="p-2">Variance bridge</th><th className="p-2">Delta</th><th className="p-2">Authority</th><th className="p-2">Explanation</th></tr></thead><tbody>{bridge.map((b) => <tr key={String(b.id)} className="border-t border-line-dark/70"><td className="p-2">{b.cause}</td><td className="p-2 font-mono">{cents(b.cents)}</td><td className="p-2">{b.winner}</td><td className="p-2 text-xs text-ink-soft-dark">{b.why} · {b.explained ? "explained" : "unexplained"}</td></tr>)}</tbody></table><p className="mt-2 text-right text-xs text-ink-soft-dark">Bridge total: {cents(bridge.reduce((sum, b) => sum + b.cents, 0n))}</p></div> : null}
        {exceptionClusters.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs text-ink-soft-dark"><tr><th className="p-2">Exception cluster</th><th className="p-2">Orders</th><th className="p-2">Amount</th><th className="p-2">Playbook</th><th className="p-2">Status</th></tr></thead><tbody>{exceptionClusters.map((c) => <tr key={String(c.id)} className="border-t border-line-dark/70 align-top"><td className="p-2"><div>{c.cls}</div><p className="text-xs text-ink-soft-dark">{c.explanation || c.reason}</p></td><td className="p-2">{c.orders}</td><td className="p-2 font-mono">{cents(c.cents)}</td><td className="p-2 font-mono text-xs">{c.playbook}</td><td className="p-2">{c.status}</td></tr>)}</tbody></table></div> : null}
      </section>

      <section className="glass space-y-3 p-4" data-testid="finance-drivers">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="panel-title">Driver board</p><p className="mt-1 text-xs text-ink-soft-dark">Every exception dollar is assigned to exactly one cause. Defects go to procurement; contradicted claims go to review — never an auto-denial.</p></div>
          <Badge kind="simulated" />
        </div>
        {driverClusters.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs text-ink-soft-dark"><tr><th className="p-2">Driver</th><th className="p-2">Owner</th><th className="p-2">Effect</th><th className="p-2">Action</th></tr></thead><tbody>{driverClusters.map((c) => <tr key={String(c.id)} className="border-t border-line-dark/70 align-top"><td className="p-2 font-mono text-xs">{c.cls.replace("driver:", "")}</td><td className="p-2">{c.winner}</td><td className="p-2 font-mono">{cents(c.cents)}</td><td className="p-2 text-xs text-ink-soft-dark">{c.reason}</td></tr>)}</tbody></table></div> : <p className="text-sm text-ink-soft-dark">Run close on Brindle &amp; Co. to build the driver board from the reconciliation.</p>}
      </section>

      <section className="glass space-y-3 p-4" data-testid="finance-agent-proof">
        <div>
          <p className="panel-title">Finance CREAO agents · proof and run record</p>
          <p className="mt-1 text-xs text-ink-soft-dark">Finance judgments run after the close snapshot is recorded. They cannot hold up the refund flow or change ledger amounts.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-ink-soft-dark"><tr><th className="p-2">Seat</th><th className="p-2">Connection</th><th className="p-2">Latest run</th><th className="p-2">Judgment</th><th className="p-2">Record</th></tr></thead>
            <tbody>{FINANCE_SEATS.map(([seat, name]) => {
              const run = latestRuns.get(seat);
              const setup = agentSetup?.[seat];
              const modeLabel = run?.mode === "live" ? "Live" : run?.mode === "replay" ? "Replay of real run" : run ? "Simulated" : undefined;
              const output = run?.outputJson ? (() => { try { return JSON.parse(run.outputJson) as Record<string, unknown>; } catch { return undefined; } })() : undefined;
              const judgment = output ? (typeof output.rationale === "string" ? output.rationale : typeof output.memo === "string" ? output.memo : typeof output.why_period_moved === "string" ? output.why_period_moved : typeof output.reason === "string" ? output.reason : JSON.stringify(output)) : run?.rejectReason || "No run recorded yet";
              const connection = !setup ? "Worker status unavailable" : !setup.checked ? "Key missing · not checked" : !setup.configured ? "Agent ID missing" : !setup.found ? "ID not found" : !setup.nameMatches ? "Name mismatch" : "Found · name matches";
              return <tr key={seat} className="border-t border-line-dark/70 align-top"><td className="p-2 font-medium">{name}</td><td className="p-2">{connection}</td><td className="p-2">{modeLabel ?? "—"}{run ? <span className="block text-xs text-ink-soft-dark">{run.caseRef} · {run.status} · {run.ms} ms</span> : null}</td><td className="max-w-[32rem] p-2 text-xs text-ink-soft-dark">{judgment}</td><td className="p-2">{run?.runUrl ? <a className="text-accent underline" href={run.runUrl} target="_blank" rel="noreferrer">Open run</a> : run?.valid ? "Schema valid" : run ? "Output rejected" : "—"}</td></tr>;
            })}</tbody>
          </table>
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

function Mini({ label, value, formatMoney = false }: { label: string; value: number | string; formatMoney?: boolean }) {
  const text = typeof value === "number" ? (formatMoney ? money(value) : value.toLocaleString()) : value;
  return <div className="rounded-lg border border-line-dark/70 p-3"><p className="text-xs text-ink-soft-dark">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{text}</p></div>;
}
