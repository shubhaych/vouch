"use client";

import { useMemo, useState } from "react";
import { useRowsThrottled } from "@/lib/stdb/hooks";
import { Badge } from "@/components/ui/badge";
import { money, moneyShort } from "@/lib/format";
import type { Business, CreditEvent, Purchase, Refund } from "@/module_bindings/types";
import { BAND_COLOR, type AgentPoint, type Band } from "@/components/world/use-world";
import { AgentAcrossMerchants, LiveFlow } from "./live-flow";

const IN = "#2f9e7a";
const OUT = "#c45b6a";
const HELD = "#c08a1e";
const WINDOW_DAYS = 30;
const BANDS: { band: Band; label: string; min: number; max: number }[] = [
  { band: "green", label: "750+", min: 750, max: 1e9 },
  { band: "neutral", label: "600–749", min: 600, max: 750 },
  { band: "amber", label: "450–599", min: 450, max: 600 },
  { band: "red", label: "under 450", min: 0, max: 450 },
];
const bandOf = (s: number) => BANDS.find((b) => s >= b.min && s < b.max)!.band;

type Ledger = { key: string; day: number; dir: "in" | "out" | "held"; agentId: number; amount: number; score: number; delta: number | null; status: string };

/**
 * One merchant, last 30 simulated days, straight from purchase / refund / credit_event rows:
 * who paid in (by the buyer's Vouch band), what went back out, and what each refund did to a score.
 */
export function MerchantFlow({ business, day, agents, businesses, running, onClose }: {
  business: Business;
  day: number;
  agents: Map<number, AgentPoint>;
  businesses: Map<number, string>;
  running: boolean | null;
  onClose: () => void;
}) {
  const from = Math.max(0, day - WINDOW_DAYS);
  const id = business.id;
  // A shopper picked from the ledger or a score mark: the live graphs switch to every merchant moving their score.
  // The scene keys this panel by merchant, so the pick resets when another merchant opens.
  const [focusAgent, setFocusAgent] = useState<number | null>(null);
  const { rows: purchasesAll, ready: pReady } = useRowsThrottled<Purchase>("purchase", `SELECT * FROM purchase WHERE business = ${id} AND day >= ${from}`, 1000);
  const { rows: refundsAll, ready: rReady } = useRowsThrottled<Refund>("refund", `SELECT * FROM refund WHERE business_id = ${id} AND day >= ${from}`, 1000);
  const { rows: creditsAll } = useRowsThrottled<CreditEvent>("creditEvent", `SELECT * FROM credit_event WHERE cause_table = 'refund' AND day >= ${from}`, 1500);
  const [hoverBand, setHoverBand] = useState<Band | null>(null);

  // The client cache holds every subscription's rows, so filter to this merchant again.
  const purchases = useMemo(() => purchasesAll.filter((p) => p.business === id && p.day >= from), [purchasesAll, id, from]);
  const refunds = useMemo(() => refundsAll.filter((r) => r.businessId === id && r.day >= from), [refundsAll, id, from]);
  const deltaByRefund = useMemo(() => {
    const ids = new Set(refunds.map((r) => r.id));
    const m = new Map<bigint, number>();
    for (const c of creditsAll) if (ids.has(c.causeId)) m.set(c.causeId, (m.get(c.causeId) ?? 0) + c.delta);
    return m;
  }, [creditsAll, refunds]);

  const scoreOf = (agentId: number) => agents.get(agentId)?.score ?? 600;

  const flow = useMemo(() => {
    const inBy = new Map<Band, { cents: number; n: number }>(BANDS.map((b) => [b.band, { cents: 0, n: 0 }]));
    for (const p of purchases) { const x = inBy.get(bandOf(scoreOf(p.buyer)))!; x.cents += p.amount; x.n += 1; }
    let paid = 0, declined = 0, open = 0, nPaid = 0, nDecl = 0, nOpen = 0;
    for (const r of refunds) {
      if (r.status === "accepted") { paid += r.amount; nPaid += 1; }
      else if (r.status === "declined" || r.status === "withdrawn") { declined += r.amount; nDecl += 1; }
      else { open += r.amount; nOpen += 1; }
    }
    const totalIn = [...inBy.values()].reduce((s, x) => s + x.cents, 0);
    return { inBy, totalIn, paid, declined, open, nPaid, nDecl, nOpen };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, refunds, agents]);

  const ledger: Ledger[] = useMemo(() => {
    const rows: Ledger[] = [];
    for (const p of purchases) rows.push({ key: `p${p.id}`, day: p.day, dir: "in", agentId: p.buyer, amount: p.amount, score: scoreOf(p.buyer), delta: null, status: "purchase" });
    for (const r of refunds) rows.push({
      key: `r${r.id}`, day: r.decidedDay || r.day, dir: r.status === "accepted" ? "out" : "held", agentId: r.agentId, amount: r.amount,
      score: scoreOf(r.agentId), delta: deltaByRefund.get(r.id) ?? null, status: r.status,
    });
    return rows.filter((x) => !hoverBand || bandOf(x.score) === hoverBand).sort((a, b) => b.day - a.day || (a.key < b.key ? 1 : -1)).slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, refunds, deltaByRefund, agents, hoverBand]);

  // Sankey-ish map: bands (left) → merchant (centre) → paid / declined / open (right).
  const W = 560, H = 220, nodeX = 250, nodeW = 60;
  const maxCents = Math.max(1, flow.totalIn, flow.paid + flow.declined + flow.open);
  const scale = (c: number) => Math.max(c > 0 ? 2 : 0, (c / maxCents) * 150);
  const stacked = BANDS.reduce<{ rows: (typeof BANDS[number] & { cents: number; n: number; y: number; link: { y0: number; y1: number; h: number } })[]; end: number }>((acc, b) => {
    const v = flow.inBy.get(b.band)!;
    const h = scale(v.cents);
    const y = 18 + BANDS.indexOf(b) * 50;
    return { rows: [...acc.rows, { ...b, ...v, y, link: { y0: y + 14, y1: acc.end + h / 2, h } }], end: acc.end + h };
  }, { rows: [], end: 30 });
  const left = stacked.rows;
  const yIn = stacked.end;
  const outs = [
    { key: "paid", label: "Refunds paid", cents: flow.paid, n: flow.nPaid, color: OUT },
    { key: "declined", label: "Declined (kept)", cents: flow.declined, n: flow.nDecl, color: "#7a6a78" },
    { key: "open", label: "Still open", cents: flow.open, n: flow.nOpen, color: HELD },
  ];
  const stackedOut = outs.reduce<{ rows: (typeof outs[number] & { y: number; link: { y0: number; y1: number; h: number } })[]; end: number }>((acc, o, i) => {
    const h = scale(o.cents);
    const y = 30 + i * 62;
    return { rows: [...acc.rows, { ...o, y, link: { y0: acc.end + h / 2, y1: y + 14, h } }], end: acc.end + h };
  }, { rows: [], end: 30 });
  const right = stackedOut.rows;
  const yOut = stackedOut.end;
  const curve = (x0: number, y0: number, x1: number, y1: number) => `M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`;

  return (
    <section className="merchant-flow" data-testid="merchant-flow" aria-label={`${business.name} money flow`}>
      <header className="merchant-flow__head">
        <div>
          <p className="sim-panel__eyebrow">Merchant flow · last {WINDOW_DAYS} days · day {from}–{day}</p>
          <h2 className="sim-panel__title">{business.name} <span className="text-ink-soft font-normal text-sm">{business.category}</span></h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge kind="simulated" />
          <button type="button" className="merchant-flow__x" onClick={onClose} aria-label="Back to the globe" data-testid="merchant-flow-close">✕</button>
        </div>
      </header>

      <div className="merchant-flow__grid">
        <div className="merchant-flow__map">
          {!pReady || !rReady ? <div className="skeleton h-full w-full rounded-lg" /> : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="Money in by shopper Vouch band, money out by refund outcome">
              {left.map((b) => (
                <path key={b.band} d={curve(118, b.link.y0, nodeX, b.link.y1)} fill="none" stroke={BAND_COLOR[b.band]} strokeOpacity={hoverBand && hoverBand !== b.band ? 0.12 : 0.55} strokeWidth={Math.max(1, b.link.h)} />
              ))}
              {right.map((o) => (
                <path key={o.key} d={curve(nodeX + nodeW, o.link.y0, 442, o.link.y1)} fill="none" stroke={o.color} strokeOpacity={0.55} strokeWidth={Math.max(1, o.link.h)} />
              ))}
              {left.map((b) => (
                <g key={b.band} onMouseEnter={() => setHoverBand(b.band)} onMouseLeave={() => setHoverBand(null)} style={{ cursor: "pointer" }}>
                  <rect x={4} y={b.y} width={114} height={28} rx={6} fill="#fff" stroke={BAND_COLOR[b.band]} strokeWidth={1.5} />
                  <text x={12} y={b.y + 12} fontSize={9} fill="#6b4a66">Vouch {b.label}</text>
                  <text x={12} y={b.y + 23} fontSize={10} fontWeight={650} fill={IN}>+{moneyShort(b.cents)} · {b.n}</text>
                </g>
              ))}
              <rect x={nodeX} y={26} width={nodeW} height={Math.max(30, yIn - 26, yOut - 26)} rx={8} fill="#3a0f34" />
              <text x={nodeX + nodeW / 2} y={20} fontSize={10} textAnchor="middle" fill="#3a0f34" fontWeight={650}>B-{String(id).padStart(3, "0")}</text>
              {right.map((o) => (
                <g key={o.key}>
                  <rect x={442} y={o.y} width={114} height={28} rx={6} fill="#fff" stroke={o.color} strokeWidth={1.5} />
                  <text x={450} y={o.y + 12} fontSize={9} fill="#6b4a66">{o.label}</text>
                  <text x={450} y={o.y + 23} fontSize={10} fontWeight={650} fill={o.color}>{o.key === "paid" ? "−" : ""}{moneyShort(o.cents)} · {o.n}</text>
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="merchant-flow__chart">
          <p className="sim-panel__eyebrow">{focusAgent === null ? "Live · rows as SpacetimeDB writes them · last 40 s" : "Live · one shopper, every merchant"} <Badge kind="simulated" /></p>
          {focusAgent === null ? (
            <LiveFlow businessId={id} day={day} running={running} onSelectAgent={setFocusAgent} />
          ) : (
            <AgentAcrossMerchants agentId={focusAgent} agent={agents.get(focusAgent)} businesses={businesses} day={day} onBack={() => setFocusAgent(null)} />
          )}
        </div>

        <div className="merchant-flow__ledger" data-lenis-prevent>
          <p className="sim-panel__eyebrow">Ledger {hoverBand ? `· Vouch ${BANDS.find((b) => b.band === hoverBand)!.label}` : ""} <span className="font-normal normal-case tracking-normal">· click a shopper</span></p>
          {ledger.length === 0 ? <p className="sim-panel__empty">No purchases or refunds in this window yet.</p> : (
            <table>
              <thead><tr><th>Day</th><th>Shopper</th><th>Vouch</th><th>Event</th><th className="text-right">Amount</th><th className="text-right">Δ</th></tr></thead>
              <tbody>
                {ledger.map((x) => (
                  <tr key={x.key} className={`is-${x.dir} ${focusAgent === x.agentId ? "is-focus" : ""}`} onClick={() => setFocusAgent(x.agentId)} style={{ cursor: "pointer" }} data-testid="ledger-row" data-agent={x.agentId}>
                    <td>D{x.day}</td>
                    <td className="font-mono">A-{x.agentId}</td>
                    <td><span className="merchant-flow__dot" style={{ background: BAND_COLOR[bandOf(x.score)] }} />{x.score}</td>
                    <td>{x.status === "purchase" ? "Purchase" : x.status === "accepted" ? "Refund paid" : `Refund ${x.status.replaceAll("_", " ")}`}</td>
                    <td className="text-right font-mono">{x.dir === "in" ? "+" : x.dir === "out" ? "−" : ""}{money(x.amount)}</td>
                    <td className="text-right font-mono">{x.delta === null ? "" : x.delta > 0 ? `+${x.delta}` : x.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
