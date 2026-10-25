"use client";

import { motion } from "motion/react";
import type { Business, FraudPattern, RegionStat } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { int, money, patternLabel, pct } from "@/lib/format";
import type { AgentPoint } from "./use-world";

export type Metric = "shopping" | "refunds" | "losses" | "honest_declines" | "fraud" | "credit" | "business";

export const METRICS: { id: Metric; label: string }[] = [
  { id: "shopping", label: "Shopping activity" },
  { id: "refunds", label: "Refund requests" },
  { id: "losses", label: "Refund losses" },
  { id: "honest_declines", label: "Honest-customer declines" },
  { id: "fraud", label: "Fraud clusters" },
  { id: "credit", label: "Credit distribution" },
  { id: "business", label: "Business activity" },
];

export function ObservatoryPanel({ metric, onMetric }: { metric: Metric; onMetric: (m: Metric) => void }) {
  return (
    <div className="glass pointer-events-auto flex max-w-[44rem] flex-wrap items-center gap-1 p-1" data-testid="observatory-metrics">
      {METRICS.map((m) => (
        <button key={m.id} onClick={() => onMetric(m.id)} data-testid={`metric-${m.id}`}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${metric === m.id ? "bg-accent text-black" : "text-ink-soft-dark hover:text-ink-dark"}`}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function RegionPanel({ regionId, regions, businesses, patterns, agents, onClose, onPattern }: {
  regionId: number; regions: readonly RegionStat[]; businesses: readonly Business[]; patterns: readonly FraudPattern[]; agents: Map<number, AgentPoint>;
  onClose: () => void; onPattern: (id: number) => void;
}) {
  const r = regions.find((x) => x.regionId === regionId);
  if (!r) return null;
  const decided = r.accepted + r.declined;
  const max = Math.max(1, ...r.scoreHist);
  const local = businesses.filter((b) => b.region === regionId).sort((a, b) => b.sales - a.sales);
  const touching = patterns.filter((p) => p.agentIds.some((id) => agents.get(id)?.region === regionId));
  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.24 }} className="glass flex h-full min-h-0 flex-col" data-testid="region-panel">
      <div className="flex items-start justify-between border-b border-line-dark px-4 py-3">
        <div>
          <div className="panel-title">Region (simulated)</div>
          <h2 className="text-lg font-bold">{r.name}</h2>
          <p className="text-xs text-ink-soft-dark">{int(r.agents)} simulated agents · illustrative position, not anyone&apos;s location</p>
        </div>
        <button className="btn btn--ghost-dark btn--xs" onClick={onClose} aria-label="Close region panel">✕</button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-lenis-prevent>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Cell label="Transactions" value={<Tween value={r.purchases} />} />
          <Cell label="Refund rate" value={r.purchases ? pct(r.refundsRequested / r.purchases) : "0%"} />
          <Cell label="Estimated losses" value={money(r.lossCents)} sub="accepted claims that were false (ground truth, inside reducers)" />
          <Cell label="Honest-customer declines" value={<Tween value={r.honestDeclines} />} sub="genuine claims slowed or declined" />
          <Cell label="Accepted / declined" value={`${int(r.accepted)} / ${int(r.declined)}`} sub={decided ? `${pct(r.accepted / decided)} accepted` : undefined} />
          <Cell label="Pending" value={<Tween value={r.pending} />} />
        </div>
        <div>
          <div className="panel-title mb-1">Credit histogram <Badge kind="live" /></div>
          <div className="flex h-20 items-end gap-1" data-testid="region-histogram">
            {r.scoreHist.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="w-full rounded-t" style={{ height: `${(n / max) * 64}px`, background: i < 4 ? "#F87171" : i < 6 ? "#FBBF24" : i < 7 ? "#94A3B8" : "#34D399" }} title={`${i * 100}–${i * 100 + 99}: ${n}`} />
                <span className="font-mono text-[0.55rem] text-ink-soft-dark">{i * 100}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="panel-title mb-1">Top businesses here</div>
          {local.length ? local.slice(0, 5).map((b) => (
            <div key={b.id} className="flex justify-between text-sm"><span>{b.name}</span><span className="font-mono text-ink-soft-dark">{int(b.sales)} sales</span></div>
          )) : <p className="text-xs text-ink-soft-dark">No businesses are based in this region; agents here buy from stores elsewhere.</p>}
        </div>
        <div>
          <div className="panel-title mb-1">Patterns touching this region</div>
          {touching.length ? touching.map((p) => (
            <button key={p.id} className="chip chip--review mb-1 mr-1" onClick={() => onPattern(p.id)}>{patternLabel(p.id)} · {p.status}</button>
          )) : <p className="text-xs text-ink-soft-dark">None. A shared region is never evidence on its own.</p>}
        </div>
      </div>
    </motion.aside>
  );
}

function Cell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-line-dark bg-white/[0.02] p-2">
      <div className="text-[0.62rem] uppercase tracking-wider text-ink-soft-dark">{label} <Badge kind="live" /></div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
      {sub ? <div className="text-[0.62rem] leading-tight text-ink-soft-dark">{sub}</div> : null}
    </div>
  );
}
