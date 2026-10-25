"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { useCall } from "@/lib/stdb/hooks";
import { agentLabel, businessLabel, money, patternLabel, refundLabel, titleCase } from "@/lib/format";
import { BAND_COLOR, type AgentPoint, type Band } from "./use-world";
import { catalogItem, regionById } from "@vouch/module/world";

interface Cause { table: string; id: bigint; eventId: bigint }

export function AgentPanel({ agent, highlightCause, onClose, onPattern }: { agent: AgentPoint; highlightCause: string | null; onClose: () => void; onPattern: (id: number) => void }) {
  const id = agent.id;
  const [rows] = useTable(tables.agent.where((r) => r.id.eq(id)));
  const [credits, creditsReady] = useTable(tables.creditEvent.where((r) => r.agentId.eq(id)));
  const [purchases] = useTable(tables.purchase.where((r) => r.buyer.eq(id)));
  const [refunds] = useTable(tables.refund.where((r) => r.agentId.eq(id)));
  const [businesses] = useTable(tables.business);
  const [patterns] = useTable(tables.fraudPattern);
  const [runs] = useTable(tables.simRun);
  const row = rows[0];
  const [cause, setCause] = useState<Cause | null>(() => {
    if (!highlightCause) return null;
    const [table, cid] = highlightCause.split(":");
    return table && cid ? { table, id: BigInt(cid), eventId: 0n } : null;
  });

  const score = row?.score ?? agent.score;
  const band = (row?.band ?? agent.band) as Band;
  const sorted = useMemo(() => [...credits].sort((a, b) => Number(a.id - b.id)), [credits]);
  const startDay = runs[0]?.startDay ?? 0;
  const series = useMemo(() => {
    const first = sorted[0];
    const pts = [{ day: first ? Math.min(first.day, startDay) : startDay, score: first ? first.before : score, id: 0n, kind: "start", causeTable: "", causeId: 0n }];
    for (const e of sorted) pts.push({ day: e.day, score: e.after, id: e.id, kind: e.kind, causeTable: e.causeTable, causeId: e.causeId });
    return pts;
  }, [sorted, startDay, score]);

  const bizCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of purchases) m.set(p.business, (m.get(p.business) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [purchases]);
  const bizName = (bid: number) => businesses.find((b) => b.id === bid)?.name ?? businessLabel(bid);
  const regionsShopped = useMemo(() => {
    const s = new Set<string>();
    for (const [bid] of bizCounts) {
      const b = businesses.find((x) => x.id === bid);
      if (b) s.add(regionById(b.region)?.name ?? "");
    }
    return [...s].filter(Boolean);
  }, [bizCounts, businesses]);
  const accepted = refunds.filter((r) => r.status === "accepted").length;
  const myPatterns = patterns.filter((p) => p.agentIds.includes(id));
  const region = regionById(row?.region ?? agent.region);

  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.24, ease: "easeOut" }}
      className="glass flex h-full min-h-0 flex-col" data-testid="agent-panel">
      <div className="flex items-start justify-between gap-2 border-b border-line-dark px-4 py-3">
        <div>
          <h2 className="font-mono text-lg font-bold">Agent {agentLabel(id)}</h2>
          <p className="text-xs text-ink-soft-dark">{agent.isLive ? "Live shopper agent" : "Simulated shopping agent"} · Region: {region?.name ?? "?"} (simulated)</p>
        </div>
        <button className="btn btn--ghost-dark btn--xs" onClick={onClose} aria-label="Close agent panel" data-testid="agent-close">✕</button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-lenis-prevent>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-line-dark bg-white/[0.03] p-2">
            <div className="text-[0.62rem] uppercase tracking-wider text-ink-soft-dark">Credit <Badge kind={agent.isLive ? "live" : "simulated"} /></div>
            <div className="mt-1 text-2xl font-bold" style={{ color: BAND_COLOR[band] }} data-testid="agent-score"><Tween value={score} /></div>
            <div className="text-[0.65rem] text-ink-soft-dark">/ 1000 · {band}</div>
          </div>
          <div className="rounded-lg border border-line-dark bg-white/[0.03] p-2">
            <div className="text-[0.62rem] uppercase tracking-wider text-ink-soft-dark">Purchases <Badge kind="simulated" /></div>
            <div className="mt-1 text-2xl font-bold"><Tween value={row?.purchases ?? agent.purchases} /></div>
            <div className="text-[0.65rem] text-ink-soft-dark">across {bizCounts.length} businesses</div>
          </div>
          <div className="rounded-lg border border-line-dark bg-white/[0.03] p-2">
            <div className="text-[0.62rem] uppercase tracking-wider text-ink-soft-dark">Refunds <Badge kind="simulated" /></div>
            <div className="mt-1 text-2xl font-bold"><Tween value={row?.refunds ?? agent.refunds} /></div>
            <div className="text-[0.65rem] text-ink-soft-dark">{refunds.length ? `${Math.round((accepted / refunds.length) * 100)}% accepted` : "none yet"}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {regionsShopped.slice(0, 4).map((r) => <span key={r} className="chip">{r}</span>)}
          {bizCounts.slice(0, 4).map(([bid, n]) => <span key={bid} className="chip chip--accent">{bizName(bid)} ×{n}</span>)}
          {myPatterns.map((p) => (
            <button key={p.id} className={`chip ${p.status === "confirmed" ? "chip--fraud" : "chip--review"}`} onClick={() => onPattern(p.id)}>{patternLabel(p.id)} {p.status}</button>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="panel-title">Credit progression</span>
            <span className="text-[0.65rem] text-ink-soft-dark">click a point to open its cause</span>
          </div>
          <div className="h-40" data-testid="credit-chart">
            {!creditsReady ? <div className="skeleton h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="day" tick={{ fill: "#8b9aab", fontSize: 10 }} type="number" domain={["dataMin", "dataMax"]} />
                  <YAxis tick={{ fill: "#8b9aab", fontSize: 10 }} domain={["dataMin - 15", "dataMax + 15"]} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0f14", border: "1px solid rgba(148,163,184,0.2)", fontSize: 12 }} labelFormatter={(d) => `Day ${d}`}
                    formatter={(v, _n, item) => [`${v} (${titleCase(String((item.payload as { kind: string }).kind))})`, "score"]} />
                  <Line type="stepAfter" dataKey="score" stroke="#22d3ee" strokeWidth={1.5} isAnimationActive={false}
                    dot={(props: { cx?: number; cy?: number; payload?: { id: bigint; causeTable: string; causeId: bigint; kind: string } }) => {
                      const pl = props.payload;
                      if (!pl || props.cx === undefined || props.cy === undefined) return <g />;
                      const hot = cause && pl.causeTable === cause.table && pl.causeId === cause.id;
                      const color = pl.kind.includes("declined") || pl.kind.includes("fraud") || pl.kind.includes("ratio") ? "#f87171" : pl.kind.includes("refund") ? "#34d399" : "#22d3ee";
                      return (
                        <circle key={String(pl.id)} cx={props.cx} cy={props.cy} r={hot ? 6 : 3.5} fill={color} stroke={hot ? "#fff" : "none"} strokeWidth={2} style={{ cursor: pl.causeTable ? "pointer" : "default" }}
                          onClick={() => pl.causeTable && setCause({ table: pl.causeTable, id: pl.causeId, eventId: pl.id })} data-testid="credit-dot" />
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <AnimatePresence>
          {cause ? <CauseCard key={`${cause.table}${cause.id}`} cause={cause} agentId={id} onClose={() => setCause(null)} onPattern={onPattern} /> : null}
        </AnimatePresence>

        <div>
          <div className="panel-title mb-1">Credit events <Badge kind={agent.isLive ? "live" : "simulated"} /></div>
          <ol className="space-y-0.5 font-mono text-[0.72rem]">
            {[...sorted].reverse().slice(0, 40).map((e) => (
              <li key={e.id.toString()}>
                <button className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5" onClick={() => setCause({ table: e.causeTable, id: e.causeId, eventId: e.id })}>
                  <span className="truncate">d{e.day} {titleCase(e.kind)}</span>
                  <span className={e.delta < 0 ? "text-fraud" : "text-honest"}>{e.delta > 0 ? "+" : ""}{e.delta} → {e.after}</span>
                </button>
              </li>
            ))}
            {sorted.length === 0 && creditsReady ? <li className="text-ink-soft-dark">No credit events yet: every agent starts at 600.</li> : null}
          </ol>
        </div>

        <p className="text-[0.68rem] text-ink-soft-dark">Synthetic agent. In production, agent-level data needs business authorisation and consumer consent.</p>
      </div>
    </motion.aside>
  );
}

function CauseCard({ cause, agentId, onClose, onPattern }: { cause: Cause; agentId: number; onClose: () => void; onPattern: (id: number) => void }) {
  const [purchases] = useTable(tables.purchase.where((r) => r.id.eq(cause.id)), { enabled: cause.table === "purchase" });
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(cause.id)), { enabled: cause.table === "refund" });
  const refund = refunds[0];
  const [refundPurchase] = useTable(tables.purchase.where((r) => r.id.eq(refund?.purchaseId ?? 0n)), { enabled: !!refund });
  const [claims] = useTable(tables.claim.where((r) => r.refundId.eq(refund?.id ?? 0n)), { enabled: !!refund });
  const purchase = purchases[0] ?? refundPurchase[0];
  const call = useCall();
  const claim = claims[0];

  let body: React.ReactNode = <div className="skeleton h-12 w-full" />;
  if (cause.table === "fraud_pattern") {
    body = (
      <div>
        <div className="font-semibold">Confirmed fraud pattern {patternLabel(Number(cause.id))}</div>
        <button className="btn btn--fraud btn--xs mt-2" onClick={() => onPattern(Number(cause.id))}>Open in Replay</button>
      </div>
    );
  } else if (cause.table === "agent") {
    body = <div>Inactivity drift: no activity for 60 simulated days moves the score one point a week toward 600.</div>;
  } else if (refund) {
    const item = purchase ? catalogItem(purchase.item) : undefined;
    body = (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between"><span className="font-mono font-semibold">{refundLabel(refund.id)}</span><span className="chip">{titleCase(refund.status)}</span></div>
        <div className="text-xs text-ink-soft-dark">{item?.name ?? "item"} from {businessLabel(refund.businessId)} · {money(refund.amount)} · filed day {refund.day}{refund.decidedDay ? `, decided day ${refund.decidedDay}` : ""} · {refund.path === "fast" ? "fast policy path" : "investigated"}</div>
        <blockquote className="border-l-2 border-review/50 pl-2 text-xs italic">“{refund.reasonText}”</blockquote>
        <div className="flex flex-wrap gap-2 pt-1">
          {claim ? (
            <Link className="btn btn--primary btn--xs" href={`/business?refund=${refund.id}`} data-testid="open-in-business">Open investigation</Link>
          ) : (
            <button className="btn btn--ghost-dark btn--xs" data-testid="investigate-sim"
              onClick={() => void call("openInvestigation", (r) => r.openInvestigation({ refundId: refund.id }), "Opened for investigation on /business")}>
              Investigate with CREAO
            </button>
          )}
        </div>
      </div>
    );
  } else if (purchase) {
    const item = catalogItem(purchase.item);
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between"><span className="font-mono font-semibold">Purchase P-{purchase.id.toString()}</span><span className="chip">{titleCase(purchase.status)}</span></div>
        <div className="text-xs text-ink-soft-dark">{item?.name} from {businessLabel(purchase.business)} · {money(purchase.amount)} · bought day {purchase.day}, delivered day {purchase.deliverDay}, kept past the window (day {purchase.windowEndDay})</div>
      </div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm" data-testid="cause-card">
      <div className="mb-1 flex items-center justify-between">
        <span className="panel-title">Cause · {cause.table.replace("_", " ")} <Badge kind={agentId > 900000 ? "live" : "simulated"} /></span>
        <button className="text-xs text-ink-soft-dark hover:text-ink-dark" onClick={onClose}>close</button>
      </div>
      {body}
    </motion.div>
  );
}
