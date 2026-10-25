"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useConn, useRowsThrottled } from "@/lib/stdb/hooks";
import type { CreditEvent, Purchase, Refund } from "@/module_bindings/types";
import { agentLabel, businessLabel } from "@/lib/format";
import { BAND_COLOR, type AgentPoint } from "@/components/world/use-world";

const IN = "#2f9e7a";
const OUT = "#c45b6a";
const GAIN = "#1f9d55";
const LOSS = "#d1434b";
const SAME = "#e08a1e";
const WINDOW_MS = 40_000;
const BIN_MS = 1000;
const W = 440;
const H = 160;

type Mark =
  | { kind: "in" | "out"; t: number; cents: number; agentId: number; key: string }
  | { kind: "score"; t: number; agentId: number; delta: number; after: number; refundId: bigint; key: string };

/** Score 0..1000 to a chart y: high scores sit at the top. */
const yOf = (score: number, top: number, bottom: number) => top + (1 - Math.min(1000, Math.max(0, score)) / 1000) * (bottom - top);

/**
 * Two live graphs for one merchant, drawn from rows as SpacetimeDB writes them (not from day buckets):
 * money in above a dashed line and refunds out below it, then what each refund did to a shopper's score.
 * Marks slide left as they age; the same shopper written several times in the window is bracketed.
 */
export function LiveFlow({ businessId, day, running, onSelectAgent, scores: showScores = true }: {
  /** null: every merchant. */
  businessId: number | null;
  day: number;
  running: boolean | null;
  onSelectAgent: (id: number) => void;
  scores?: boolean;
}) {
  const mine = (b: number) => businessId === null || b === businessId;
  const conn = useConn();
  const reduced = !!useReducedMotion();
  // Row callbacks append here; the clock below copies it into state, so rendering never reads the ref.
  const marks = useRef<Mark[]>([]);
  const [frame, setFrame] = useState<{ now: number; marks: Mark[] }>(() => ({ now: performance.now(), marks: [] }));

  // Live rows, not the subscription's backfill: a row from an earlier simulated day is history, not an event.
  useEffect(() => {
    if (!conn) return;
    const since = performance.now();
    const fresh = (rowDay: number) => performance.now() - since > 800 && rowDay >= day - 1;
    const push = (m: Mark) => {
      marks.current.push(m);
      if (marks.current.length > 600) marks.current.splice(0, marks.current.length - 600);
    };
    const onPurchase = (_c: unknown, p: Purchase) => {
      if (mine(p.business) && fresh(p.day)) push({ kind: "in", t: performance.now(), cents: p.amount, agentId: p.buyer, key: `p${p.id}` });
    };
    const onRefund = (_c: unknown, old: Refund, r: Refund) => {
      if (mine(r.businessId) && r.status === "accepted" && old.status !== "accepted" && fresh(r.decidedDay || r.day)) {
        push({ kind: "out", t: performance.now(), cents: r.amount, agentId: r.agentId, key: `r${r.id}` });
      }
    };
    const onCredit = (_c: unknown, c: CreditEvent) => {
      if (c.causeTable !== "refund" || !fresh(c.day)) return;
      const r = conn.db.refund.id.find(c.causeId);
      if (!r || !mine(r.businessId)) return;
      push({ kind: "score", t: performance.now(), agentId: c.agentId, delta: c.delta, after: c.after, refundId: c.causeId, key: `c${c.id}` });
    };
    conn.db.purchase.onInsert(onPurchase as never);
    conn.db.refund.onUpdate(onRefund as never);
    conn.db.creditEvent.onInsert(onCredit as never);
    return () => {
      conn.db.purchase.removeOnInsert(onPurchase as never);
      conn.db.refund.removeOnUpdate(onRefund as never);
      conn.db.creditEvent.removeOnInsert(onCredit as never);
    };
  }, [conn, businessId, day]);

  // The clock that slides marks left. Twelve frames a second is smooth enough for a 40 s window and cheap for the globe beside it.
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now();
      marks.current = marks.current.filter((m) => t - m.t < WINDOW_MS + 1500);
      setFrame({ now: t, marks: marks.current.slice() });
    }, reduced ? 1000 : 80);
    return () => clearInterval(id);
  }, [reduced]);

  const { now, marks: all } = frame;
  const xOf = (t: number) => W - ((now - t) / WINDOW_MS) * (W - 8) - 4;

  const flow = useMemo(() => {
    const bins = new Map<number, { t: number; inC: number; outC: number; writers: Set<number> }>();
    for (const m of all) {
      if (m.kind === "score") continue;
      const b = Math.floor(m.t / BIN_MS);
      const x = bins.get(b) ?? { t: b * BIN_MS + BIN_MS / 2, inC: 0, outC: 0, writers: new Set<number>() };
      if (m.kind === "in") x.inC += m.cents; else x.outC += m.cents;
      x.writers.add(m.agentId);
      bins.set(b, x);
    }
    let max = 1;
    for (const b of bins.values()) max = Math.max(max, b.inC, b.outC);
    const recent = all.filter((m) => m.kind !== "score" && now - m.t < 10_000);
    const writers = new Set(recent.map((m) => m.agentId)).size;
    const inN = recent.filter((m) => m.kind === "in").length;
    const outN = recent.filter((m) => m.kind === "out").length;
    return { bins: [...bins.values()], max, writers, inN, outN, rows: recent.length };
  }, [all, now]);

  const scores = useMemo(() => {
    const list = all.filter((m): m is Extract<Mark, { kind: "score" }> => m.kind === "score");
    const byAgent = new Map<number, typeof list>();
    for (const m of list) byAgent.set(m.agentId, [...(byAgent.get(m.agentId) ?? []), m]);
    const repeated = [...byAgent.entries()].filter(([, ms]) => ms.length >= 2);
    return { list, repeated };
  }, [all]);

  const mid = H / 2;
  const barW = Math.max(3, ((BIN_MS / WINDOW_MS) * W) - 1);
  const idle = running === false;

  return (
    <div className="live-flow" data-testid="live-flow">
      <div className="live-flow__chart" data-testid="live-flow-money">
        <p className="merchant-flow__legend">
          <span style={{ background: IN }} />Payments in
          <span style={{ background: OUT }} />Refunds out
          <span className="live-flow__writers" title="Rows written to this merchant in the last 10 seconds, and how many different shoppers wrote them at the same time" data-testid="live-flow-writers">
            last 10 s: <b>{flow.inN}</b> payments in · <b>{flow.outN}</b> refunds out · <b>{flow.writers}</b> shoppers writing at once
          </span>
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="Live payments in above the line and refunds out below it, last 40 seconds">
          <line x1={0} x2={W} y1={mid} y2={mid} stroke="#3a0f34" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 4" />
          <text x={6} y={12} fontSize={9} fill={IN} fontWeight={650}>IN</text>
          <text x={6} y={H - 5} fontSize={9} fill={OUT} fontWeight={650}>OUT</text>
          {flow.bins.map((b) => {
            const x = xOf(b.t);
            if (x < -barW) return null;
            const hIn = (b.inC / flow.max) * (mid - 16);
            const hOut = (b.outC / flow.max) * (mid - 16);
            return (
              <g key={b.t}>
                {b.inC > 0 ? <rect x={x - barW / 2} y={mid - hIn - 1} width={barW} height={hIn} rx={1.5} fill={IN} opacity={0.85} /> : null}
                {b.outC > 0 ? <rect x={x - barW / 2} y={mid + 1} width={barW} height={hOut} rx={1.5} fill={OUT} opacity={0.85} /> : null}
                {b.writers.size > 1 ? <circle cx={x} cy={mid} r={2.2} fill="#3a0f34" /> : null}
              </g>
            );
          })}
          {flow.bins.length === 0 ? (
            <text x={W / 2} y={mid - 8} fontSize={11} textAnchor="middle" fill="#6b4a66">{idle ? "Simulation paused: no rows are being written." : "Waiting for the next rows written to this merchant…"}</text>
          ) : null}
        </svg>
      </div>

      {showScores ? <div className="live-flow__chart" data-testid="live-flow-scores">
        <p className="merchant-flow__legend">
          <span style={{ background: GAIN }} />Score up
          <span style={{ background: LOSS }} />Score down
          <span style={{ background: SAME }} />Refund, no change
          <span className="live-flow__hint">Click an arrow or a ledger row: every merchant moving that shopper&apos;s score.</span>
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="Live score changes from this merchant's refunds, last 40 seconds">
          {[750, 600, 450].map((s) => (
            <g key={s}>
              <line x1={0} x2={W} y1={yOf(s, 14, H - 14)} y2={yOf(s, 14, H - 14)} stroke={BAND_COLOR[s === 750 ? "green" : s === 600 ? "neutral" : "amber"]} strokeOpacity={0.35} strokeDasharray="2 5" />
              <text x={W - 4} y={yOf(s, 14, H - 14) - 2} fontSize={8} textAnchor="end" fill="#6b4a66">{s}</text>
            </g>
          ))}
          {scores.repeated.map(([agentId, ms]) => {
            const xs = ms.map((m) => xOf(m.t));
            const ys = ms.map((m) => yOf(m.after, 14, H - 14));
            return (
              <g key={`rep${agentId}`} opacity={0.7}>
                <path d={ms.map((m, i) => `${i ? "L" : "M"}${xs[i]},${ys[i]}`).join(" ")} fill="none" stroke="#3a0f34" strokeOpacity={0.35} strokeWidth={1} />
                <text x={Math.max(...xs) + 6} y={ys[xs.indexOf(Math.max(...xs))] - 8} fontSize={8} fill="#3a0f34">{agentLabel(agentId)} ×{ms.length}</text>
              </g>
            );
          })}
          {scores.list.map((m) => {
            const x = xOf(m.t);
            if (x < -20) return null;
            const y = yOf(m.after, 14, H - 14);
            const up = m.delta > 0;
            const color = m.delta === 0 ? SAME : up ? GAIN : LOSS;
            return (
              <g key={m.key} className="live-flow__mark" style={{ cursor: "pointer" }} onClick={() => onSelectAgent(m.agentId)} data-testid="live-flow-mark" data-agent={m.agentId}>
                <title>{agentLabel(m.agentId)} · refund R-{m.refundId.toString()} · score {m.after}{m.delta ? ` (${m.delta > 0 ? "+" : ""}${m.delta})` : ""}</title>
                {m.delta === 0 ? (
                  <circle cx={x} cy={y} r={5} fill={color} />
                ) : (
                  <motion.path
                    d={up ? `M${x},${y - 7} L${x + 6},${y + 3} L${x - 6},${y + 3} Z` : `M${x},${y + 7} L${x + 6},${y - 3} L${x - 6},${y - 3} Z`}
                    fill={color}
                    initial={reduced ? false : { y: up ? 10 : -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                )}
                {m.delta !== 0 ? (
                  <text x={x + 9} y={y + 3} fontSize={10} fontWeight={700} fill={color}>{up ? `+${m.delta}` : `−${Math.abs(m.delta)}`}</text>
                ) : null}
              </g>
            );
          })}
          {scores.list.length === 0 ? (
            <text x={W / 2} y={H / 2 + 4} fontSize={11} textAnchor="middle" fill="#6b4a66">{idle ? "Simulation paused: no score changes." : "Waiting for this merchant's next refund decision…"}</text>
          ) : null}
        </svg>
      </div> : null}
    </div>
  );
}

/**
 * One shopper across every merchant: each lane is a merchant that decided one of their refunds, with the
 * score change it caused. New rows for this shopper land in all lanes at once as they are written.
 */
export function AgentAcrossMerchants({ agentId, agent, businesses, day, onBack }: {
  agentId: number;
  agent: AgentPoint | undefined;
  businesses: Map<number, string>;
  day: number;
  onBack: () => void;
}) {
  const reduced = !!useReducedMotion();
  const { rows: creditsAll, ready: cReady } = useRowsThrottled<CreditEvent>("creditEvent", `SELECT * FROM credit_event WHERE agent_id = ${agentId}`, 400);
  const { rows: refundsAll, ready: rReady } = useRowsThrottled<Refund>("refund", `SELECT * FROM refund WHERE agent_id = ${agentId}`, 400);
  const from = Math.max(0, day - 60);

  const lanes = useMemo(() => {
    const refunds = new Map(refundsAll.filter((r) => r.agentId === agentId).map((r) => [r.id, r]));
    const byBiz = new Map<number, { id: number; name: string; marks: { key: string; day: number; delta: number; after: number }[] }>();
    for (const c of creditsAll) {
      if (c.agentId !== agentId || c.causeTable !== "refund") continue;
      const r = refunds.get(c.causeId);
      if (!r) continue;
      const lane = byBiz.get(r.businessId) ?? { id: r.businessId, name: businesses.get(r.businessId) ?? businessLabel(r.businessId), marks: [] };
      lane.marks.push({ key: `c${c.id}`, day: c.day, delta: c.delta, after: c.after });
      byBiz.set(r.businessId, lane);
    }
    return [...byBiz.values()].sort((a, b) => Math.max(...b.marks.map((m) => m.day)) - Math.max(...a.marks.map((m) => m.day))).slice(0, 8);
  }, [creditsAll, refundsAll, agentId, businesses]);

  const total = lanes.reduce((s, l) => s + l.marks.length, 0);
  const laneH = 26;
  const height = 30 + Math.max(1, lanes.length) * laneH;
  // Marks sit in order along each lane (oldest left), evenly spaced so arrows and labels never stack.
  const x0 = 100;
  const span = W - x0 - 30;
  const maxN = Math.max(1, ...lanes.map((l) => l.marks.length));
  const step = Math.min(44, span / maxN);
  const showLabels = step >= 26;

  return (
    <div className="live-flow live-flow--agent" data-testid="agent-merchants">
      <button type="button" className="agent-back" onClick={onBack} data-testid="agent-merchants-back">← Back to merchant flow</button>
      <p className="merchant-flow__legend">
          <span className="merchant-flow__dot" style={{ background: BAND_COLOR[agent?.band ?? "neutral"] }} />
          <b className="font-mono">{agentLabel(agentId)}</b>&nbsp;· score {agent?.score ?? "…"} · {lanes.length} merchant{lanes.length === 1 ? "" : "s"} moved it {total} time{total === 1 ? "" : "s"} · days {from}–{day}
      </p>
      {!cReady || !rReady ? <div className="skeleton h-24 w-full rounded-lg" /> : lanes.length === 0 ? (
        <p className="sim-panel__empty">No decided refunds for this shopper yet; purchases alone do not move a score.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Score changes for ${agentLabel(agentId)} by merchant`}>
          {lanes.map((lane, i) => {
            const y = 20 + i * laneH;
            return (
              <g key={lane.id}>
                <text x={4} y={y + 4} fontSize={9.5} fill="#3a0f34" fontWeight={650}>{lane.name.length > 15 ? `${lane.name.slice(0, 14)}…` : lane.name}</text>
                <line x1={x0} x2={W - 8} y1={y} y2={y} stroke="#3a0f34" strokeOpacity={0.12} strokeDasharray="3 4" />
                {[...lane.marks].sort((a, b) => a.day - b.day).map((m, j) => {
                  const x = x0 + 8 + j * step;
                  const up = m.delta > 0;
                  const color = m.delta === 0 ? SAME : up ? GAIN : LOSS;
                  return (
                    <motion.g
                      key={m.key}
                      initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, delay: Math.min(0.6, j * 0.04) }}
                      style={{ transformOrigin: `${x}px ${y}px` }}
                      data-testid="agent-merchants-mark"
                    >
                      <title>Day {m.day} · {lane.name} · score {m.after}{m.delta ? ` (${m.delta > 0 ? "+" : ""}${m.delta})` : ""}</title>
                      {m.delta === 0 ? <circle cx={x} cy={y} r={4.5} fill={color} /> : (
                        <path d={up ? `M${x},${y - 7} L${x + 5.5},${y + 3} L${x - 5.5},${y + 3} Z` : `M${x},${y + 7} L${x + 5.5},${y - 3} L${x - 5.5},${y - 3} Z`} fill={color} />
                      )}
                      {m.delta !== 0 && showLabels ? <text x={x + 7} y={y + 3.5} fontSize={9} fontWeight={700} fill={color}>{up ? `+${m.delta}` : `−${Math.abs(m.delta)}`}</text> : null}
                    </motion.g>
                  );
                })}
              </g>
            );
          })}
          <text x={x0} y={height - 2} fontSize={8} fill="#6b4a66">oldest</text>
          <text x={W - 8} y={height - 2} fontSize={8} fill="#6b4a66" textAnchor="end">newest · hover an arrow for its day</text>
          <text x={W / 2} y={12} fontSize={9} textAnchor="middle" fill="#6b4a66">Every merchant that decided one of this shopper&apos;s refunds, newest first</text>
        </svg>
      )}
    </div>
  );
}
