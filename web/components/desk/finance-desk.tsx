"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
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
  const [selectedId, setSelectedId] = useState(0);
  const [period, setPeriod] = useState("2026-09");
  const [controllerCode, setControllerCode] = useState("");
  const [closing, setClosing] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [hoursPerTick, setHoursPerTick] = useState(24);
  const [allStates] = useTable(tables.financeCompanyState);
  const [allHours] = useTable(tables.financeStatsHourly);
  const [obligations] = useTable(tables.financeObligation.where((r) => r.companyId.eq(selectedId || 1)));
  const [entries] = useTable(tables.financeEntry.where((r) => r.companyId.eq(selectedId || 1)));
  const [queue] = useTable(tables.financeQueue.where((r) => r.companyId.eq(selectedId || 1)));
  const [closes] = useTable(tables.financeClose.where((r) => r.companyId.eq(selectedId || 1)));
  const [bridgeRows] = useTable(tables.financeBridge.where((r) => r.companyId.eq(selectedId || 1)));
  const [clusterRows] = useTable(tables.financeCluster.where((r) => r.companyId.eq(selectedId || 1)));
  const [agentRuns] = useTable(tables.financeAgentRun.where((r) => r.companyId.eq(selectedId || 1)));
  const [agentSetup, setAgentSetup] = useState<Record<string, { configured: boolean; found: boolean; nameMatches: boolean; checked: boolean }> | null>(null);
  const [claimAnalysis, setClaimAnalysis] = useState("idle");
  const company = companies.find((c) => c.id === selectedId);
  const state = allStates.find((row) => row.companyId === selectedId);
  const network = selectedId === 0;
  const selectedHours = useMemo(() => allHours.filter((row) => row.companyId === selectedId), [allHours, selectedId]);
  const shownStates = network ? allStates : allStates.filter((row) => row.companyId === selectedId);
  const shownHours = network ? allHours : selectedHours;
  const latest = useMemo(() => [...shownHours].sort((a, b) => Number(b.simHour - a.simHour))[0], [shownHours]);
  const totals = useMemo(() => shownStates.reduce((sum, row) => ({
    orders: sum.orders + row.orders, orderCents: sum.orderCents + row.orderCents,
    refundedCents: sum.refundedCents + row.refundedCents, cashCents: sum.cashCents + row.cashCents,
    claims: sum.claims + row.claims, flags: sum.flags + row.flags, verifiedFraud: sum.verifiedFraud + row.verifiedFraud,
  }), { orders: 0, orderCents: 0n, refundedCents: 0n, cashCents: 0n, claims: 0, flags: 0, verifiedFraud: 0 }), [shownStates]);
  const rolling = useMemo(() => shownHours.filter((row) => latest && row.simHour > latest.simHour - 24 && row.simHour <= latest.simHour).reduce((sum, row) => ({
    orders: sum.orders + row.orders, orderCents: sum.orderCents + row.orderCents,
    refundOutCents: sum.refundOutCents + row.refundOutCents, claims: sum.claims + row.claims,
    flags: sum.flags + row.flags, verifiedFraud: sum.verifiedFraud + row.verifiedFraud,
  }), { orders: 0, orderCents: 0n, refundOutCents: 0n, claims: 0, flags: 0, verifiedFraud: 0 }), [shownHours, latest]);
  const previousFraud = shownHours.filter((row) => latest && row.simHour > latest.simHour - 48 && row.simHour <= latest.simHour - 24).reduce((sum, row) => sum + row.verifiedFraud, 0);
  const pauseRequests = shownStates.filter((row) => { try { return (JSON.parse(row.signalsJson) as { pausePending?: boolean }).pausePending === true; } catch { return false; } }).length;
  const exposureLevel = network ? (shownStates.some((row) => row.rung === "pause") ? "pause proposed" : shownStates.some((row) => row.rung === "hedge") ? "hedge review" : shownStates.some((row) => row.rung === "watch") ? "watch" : "normal") : state?.rung ?? "waiting";
  const payoutGuidance = pauseRequests ? `Controller review requested at ${pauseRequests} shop${pauseRequests === 1 ? "" : "s"}. Payout pause requires a human decision.` : exposureLevel === "pause" ? "A controller-approved pause is active. Keep claims reviewable and tell customers when to expect an update; never auto-deny." : exposureLevel === "hedge" ? "Consider a reserve or hedge review; do not automatically stop or deny refunds." : exposureLevel === "watch" ? "Monitor the spike; keep refunds flowing while the team reviews the evidence." : "No elevated simulated exposure; continue normal refund operations.";
  const illustrativeScore = Math.max(500, Math.min(850, Math.round(820 - (rolling.claims ? rolling.verifiedFraud / rolling.claims * 240 : 0) - (rolling.orderCents ? Number(rolling.refundOutCents) / Number(rolling.orderCents) * 150 : 0) - (rolling.claims ? rolling.flags / rolling.claims * 40 : 0))));
  const openObligations = obligations.filter((o) => o.status === "open");
  const posted = entries.filter((e) => e.status === "posted");
  const unresolved = queue.filter((q) => q.status === "open");
  const claimRef = params.get("claim");
  const companyParam = params.get("company");

  useEffect(() => {
    if (!companyParam) return;
    const id = Number(companyParam);
    if (Number.isInteger(id) && id > 0) setSelectedId(id);
  }, [companyParam]);
  useEffect(() => {
    if (claimRef && !companyParam) setSelectedId(1);
  }, [claimRef, companyParam]);
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

  const setSimulation = async (running: boolean) => {
    setSimBusy(true);
    try {
      const response = await fetch(`${WORKER_URL}/finance/simulation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: controllerCode, running, hoursPerTick }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `Simulation control failed (${response.status})`);
      toast(running ? `Finance simulation running at ${hoursPerTick} simulated hour${hoursPerTick === 1 ? "" : "s"} per tick.` : "Finance simulation paused.", "honest");
    } catch (error) { toast((error as Error).message || "Finance worker is unavailable.", "fraud"); }
    finally { setSimBusy(false); }
  };

  const injectScenario = async (kind: "ring" | "sale_day" | "defect_batch") => {
    setScenarioBusy(true);
    try {
      const scenarioCompanyId = network ? companies[0]?.id ?? 1 : selectedId;
      const response = await fetch(`${WORKER_URL}/finance/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: controllerCode, companyId: scenarioCompanyId, kind, hours: 24 }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `Scenario injection failed (${response.status})`);
      toast(`${kind.replaceAll("_", " ")} queued for ${network ? companies[0]?.name ?? "first shop" : company?.name ?? "selected company"}.`, "honest");
    } catch (error) { toast((error as Error).message || "Finance worker is unavailable.", "fraud"); }
    finally { setScenarioBusy(false); }
  };

  return (
    <main className="app-dark mx-auto min-h-screen max-w-[1440px] space-y-5 px-4 py-6 text-ink-dark sm:px-6" data-testid="finance-desk">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section__eyebrow">Vouch · finance operations</p>
          <h1 className="section__title">Refund Finance Desk</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft-dark">Watch simulated orders arrive, refunds leave, and risk move across a 100-shop economy.</p>
        </div>
        <Link className="btn btn--secondary btn--sm" href={params.get("refund") ? `/business?refund=${encodeURIComponent(params.get("refund")!)}` : "/business"}>Back to refunds</Link>
      </header>

      <div className="glass flex flex-wrap items-center gap-3 p-3">
        <label htmlFor="desk-company" className="text-sm font-semibold">Company</label>
        <select id="desk-company" className="min-w-56 rounded-md border border-line-dark bg-black/30 px-3 py-2 text-sm" value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
          <option value={0}>All 100 shops · network</option>
          {[...companies].sort((a, b) => a.id - b.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="chip chip--accent">{isLivePortfolio ? "Simulated" : "Waiting for portfolio"}</span>
        <span className="text-xs text-ink-soft-dark">{companies.length} partner companies · all amounts in USD</span>
        <label className="text-xs text-ink-soft-dark">Controller code<input aria-label="Controller code" className="ml-2 w-40 rounded-md border border-line-dark bg-black/30 px-2 py-1.5 text-sm" type="password" value={controllerCode} onChange={(e) => setControllerCode(e.target.value)} /></label>
        {simState[0] ? <>
          <select aria-label="Finance simulation speed" className="rounded-md border border-line-dark bg-black/30 px-2 py-1.5 text-sm" value={hoursPerTick} onChange={(e) => setHoursPerTick(Number(e.target.value))}><option value={1}>1×</option><option value={5}>5×</option><option value={24}>Turbo</option></select>
          <button className="btn btn--secondary btn--sm" disabled={simBusy || !controllerCode} onClick={() => void setSimulation(!simState[0]!.running)}>{simBusy ? "Saving…" : simState[0].running ? "Pause portfolio" : "Start portfolio"}</button>
          <div className="flex flex-wrap items-center gap-1" aria-label="Finance scenario console">
            <span className="mr-1 text-xs text-ink-soft-dark">Scenario:</span>
            <button className="btn btn--ghost btn--xs" disabled={scenarioBusy || !controllerCode} onClick={() => void injectScenario("ring")}>Ring attack</button>
            <button className="btn btn--ghost btn--xs" disabled={scenarioBusy || !controllerCode} onClick={() => void injectScenario("sale_day")}>Sale day</button>
            <button className="btn btn--ghost btn--xs" disabled={scenarioBusy || !controllerCode} onClick={() => void injectScenario("defect_batch")}>Defect batch</button>
          </div>
        </> : null}
      </div>

      {claimRef ? <div className="glass border border-accent/30 p-3 text-sm" data-testid="desk-claim-context">Finance impact requested for claim <span className="font-mono font-semibold">{claimRef}</span>. Company-books agents run only after the business decision is final. <span className="ml-1 text-xs text-ink-soft-dark">{claimAnalysis}</span></div> : null}

      <section className="glass overflow-hidden p-4 sm:p-6" aria-label="Simulated company cashflow">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><p className="panel-title">Money moving through the business</p><Badge kind="simulated" /></div><p className="mt-1 text-sm text-ink-soft-dark">{network ? "100 fictional shops · cumulative since simulation reset" : `${company?.name ?? "Selected shop"} · cumulative since simulation reset`}</p></div>
          <div className="text-right"><p className="text-xs uppercase tracking-wider text-ink-soft-dark">Illustrative Vouch score</p><p className="text-4xl font-semibold tabular-nums text-amber-200">{illustrativeScore}</p><p className="text-xs text-ink-soft-dark">Simulation visualization only · not real customer credit</p></div>
        </div>
        <CashflowVisual orderCents={totals.orderCents} refundCents={totals.refundedCents} network={network} />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Orders · all time" value={totals.orders} />
          <Mini label="Gross order value" value={cents(totals.orderCents)} />
          <Mini label="Refunds paid" value={cents(totals.refundedCents)} />
          <Mini label="Cash balance · simulated" value={cents(totals.cashCents)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-dark/70 pt-3 text-sm">
          <p className="text-ink-soft-dark">Last 24 simulated hours: <strong className="text-ink-dark">{rolling.orders.toLocaleString()}</strong> orders · <strong className="text-ink-dark">{cents(rolling.orderCents)}</strong> gross in · <strong className="text-ink-dark">{cents(rolling.refundOutCents)}</strong> refunds out</p>
          <p className="text-ink-soft-dark">Refund risk: <strong className="capitalize text-ink-dark">{exposureLevel}</strong>{network ? " across shops" : ""} · confirmed fraud {rolling.verifiedFraud} vs {previousFraud} in prior 24h</p>
        </div>
        <p className="text-sm text-ink-soft-dark">{payoutGuidance}</p>
        <p className="mt-2 text-xs text-ink-soft-dark">Gross order value is simulated demand, not settled bank cash. Refund outflow counts simulated payouts recorded by SpacetimeDB. {latest ? `Latest simulated hour: ${latest.simHour}.` : "Waiting for the first simulation tick."}</p>
      </section>

      <section className="glass flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="panel-title">Refund risk and payout controls</p><p className="mt-1 text-xs text-ink-soft-dark">A fraud spike can recommend hedge review or ask a controller to pause payouts. No automatic refund denial.</p></div>
        <div className="flex flex-wrap gap-2"><span className="chip">{rolling.claims.toLocaleString()} claims / 24h</span><span className="chip">{rolling.flags.toLocaleString()} flagged</span><span className="chip">{rolling.verifiedFraud.toLocaleString()} confirmed in simulation</span><span className="chip">{unresolved.length} human reviews</span></div>
      </section>

      <details className="glass group p-4" data-testid="finance-detail-records">
        <summary className="cursor-pointer list-none font-semibold">Finance records, Hyphenate controls, and agent evidence <span className="ml-2 text-xs font-normal text-ink-soft-dark">{posted.length} posted entries · {openObligations.length} open obligations · {latestRuns.size} agent seats</span></summary>
        <div className="mt-4 space-y-5">

      <section className="glass space-y-4 p-4" data-testid="finance-close">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="panel-title">Period close · three-way reconciliation</p><p className="mt-1 text-xs text-ink-soft-dark">Processor is authoritative for cash movement, the bank for settlement, and the Vouch log for authorization. The ledger is derived.</p></div>
          <Badge kind="simulated" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-soft-dark">Period<select className="mt-1 block rounded-md border border-line-dark bg-black/30 px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select></label>
          {selectedId === 1 || selectedId === 0 ? <>
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
              const connection = !setup ? "Worker status unavailable" : !setup.configured ? "App ID or API key missing" : !setup.checked ? "App credentials set · live run not verified" : !setup.found ? "App not found" : !setup.nameMatches ? "Name mismatch" : "Found · name matches";
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

      </div>
      </details>

      <p className="text-xs text-ink-soft-dark">Fictional stores for a hackathon demo. Names are parodies; no affiliation with any real company; no real logos. All data is simulated.</p>
    </main>
  );
}

function Mini({ label, value, formatMoney = false }: { label: string; value: number | string; formatMoney?: boolean }) {
  const text = typeof value === "number" ? (formatMoney ? money(value) : value.toLocaleString()) : value;
  return <div className="rounded-lg border border-line-dark/70 p-3"><p className="text-xs text-ink-soft-dark">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{text}</p></div>;
}

function CashflowVisual({ orderCents, refundCents, network }: { orderCents: bigint; refundCents: bigint; network: boolean }) {
  return <div className="rounded-xl border border-line-dark/70 bg-black/20 p-2 sm:p-4">
    <svg className="h-36 w-full sm:h-44" viewBox="0 0 900 190" role="img" aria-labelledby="cashflow-title cashflow-description">
      <title id="cashflow-title">Simulated cash and order flow</title>
      <desc id="cashflow-description">Orders flow from fictional shoppers into the company, while simulated refund payouts flow back to shoppers.</desc>
      <defs><linearGradient id="orders-flow" x1="0" x2="1"><stop stopColor="#91d8bc" stopOpacity=".12"/><stop offset="1" stopColor="#91d8bc" stopOpacity=".8"/></linearGradient><linearGradient id="refund-flow" x1="1" x2="0"><stop stopColor="#edb85b" stopOpacity=".12"/><stop offset="1" stopColor="#edb85b" stopOpacity=".8"/></linearGradient></defs>
      <path d="M190 62 C315 62 325 90 420 90" fill="none" stroke="url(#orders-flow)" strokeWidth="3"/><path d="M480 100 C580 100 595 132 710 132" fill="none" stroke="url(#refund-flow)" strokeWidth="3"/>
      <path d="M190 62 C315 62 325 90 420 90" fill="none" stroke="#91d8bc" strokeOpacity=".28" strokeWidth="1" strokeDasharray="3 9" className="finance-flow finance-flow--in"/><path d="M480 100 C580 100 595 132 710 132" fill="none" stroke="#edb85b" strokeOpacity=".35" strokeWidth="1" strokeDasharray="3 9" className="finance-flow finance-flow--out"/>
      <rect x="20" y="32" width="170" height="62" rx="16" fill="#1f2e29" stroke="#466b5b"/><text x="105" y="58" textAnchor="middle" fill="#d9eee4" fontSize="13">SIMULATED SHOPPERS</text><text x="105" y="78" textAnchor="middle" fill="#91d8bc" fontSize="12">{cents(orderCents)} gross orders</text>
      <rect x="370" y="52" width="180" height="84" rx="20" fill="#302638" stroke="#785d7e"/><text x="460" y="87" textAnchor="middle" fill="#fff4de" fontSize="16" fontWeight="600">THE COMPANY</text><text x="460" y="108" textAnchor="middle" fill="#d7c3d7" fontSize="12">{network ? "100-shop economy" : "selected shop"}</text>
      <rect x="710" y="102" width="170" height="62" rx="16" fill="#332d20" stroke="#80683e"/><text x="795" y="128" textAnchor="middle" fill="#fff0d4" fontSize="13">REFUND PAYOUTS</text><text x="795" y="148" textAnchor="middle" fill="#edb85b" fontSize="12">{cents(refundCents)} paid back</text>
      <circle cx="265" cy="73" r="4" fill="#b5f4d7"/><circle cx="355" cy="83" r="3" fill="#91d8bc"/><circle cx="634" cy="121" r="4" fill="#ffda8f"/><circle cx="555" cy="109" r="3" fill="#edb85b"/>
    </svg>
  </div>;
}
