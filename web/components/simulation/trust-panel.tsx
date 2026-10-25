"use client";

import { useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { agentLabel, businessLabel, money, titleCase } from "@/lib/format";
import { START_SCORE } from "@vouch/module/score";
import { catalogItem } from "@vouch/module/world";
import { BAND_COLOR, type AgentPoint } from "@/components/world/use-world";
import { TotalWrites } from "./live-readings";

export interface TrustCounts {
  agents: number;
  merchants: number;
  purchases: number;
  refundRequests: number;
  confirmed: number;
  scoreChanges: number;
  agentsScored: number;
  ready: boolean;
}

/** Left rail: shared economy counts + one agent's order → refund → decision → score chain. */
export function TrustPanel({
  counts,
  agent,
  highlightRefundId,
  onClearAgent,
}: {
  counts: TrustCounts;
  agent: AgentPoint | null;
  highlightRefundId: bigint | null;
  onClearAgent: () => void;
}) {
  return (
    <aside className="sim-panel sim-panel--trust" data-testid="sim-trust-panel">
      <header className="sim-panel__head">
        <p className="sim-panel__eyebrow">Agents &amp; shared trust</p>
        <p className="sim-panel__note">
          Merchants see a verified-history signal. Raw evidence stays with the company that collected it.
        </p>
      </header>

      <div className="sim-metrics" data-testid="sim-counts">
        <Metric label="Agents" value={counts.ready ? counts.agents : null} />
        <Metric label="Merchants" value={counts.ready ? counts.merchants : null} />
        <Metric label="Purchases" value={counts.ready ? counts.purchases : null} />
        <Metric label="Refund requests" value={counts.ready ? counts.refundRequests : null} />
        <Metric label="Confirmed outcomes" value={counts.ready ? counts.confirmed : null} />
        <Metric label="Score changes" value={counts.ready ? counts.scoreChanges : null} accent="marigold" />
        <Metric
          label="Agents scored"
          value={counts.ready ? counts.agentsScored : null}
          accent="marigold"
          wide
        />
      </div>

      {agent ? null : (
        <div className="sim-trust__live" data-testid="sim-live-writes">
          <p className="sim-panel__eyebrow">SpacetimeDB · total writes <Badge kind="live" /></p>
          <TotalWrites />
        </div>
      )}

      <div className="sim-panel__body" data-lenis-prevent>
        {agent ? (
          <AgentChain agent={agent} highlightRefundId={highlightRefundId} onClear={onClearAgent} />
        ) : (
          <p className="sim-panel__empty">
            Select an agent on the globe for order → refund request → confirmed decision → score.
          </p>
        )}
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  accent,
  wide,
}: {
  label: string;
  value: number | null;
  accent?: "teal" | "marigold" | "outflow";
  wide?: boolean;
}) {
  return (
    <div className={`sim-metric ${wide ? "sim-metric--wide" : ""} ${accent ? `sim-metric--${accent}` : ""}`}>
      <div className="sim-metric__label">
        {label} <Badge kind="simulated" />
      </div>
      <div className="sim-metric__value">
        {value === null ? <span className="skeleton inline-block h-5 w-12" /> : <Tween value={value} />}
      </div>
    </div>
  );
}

function AgentChain({
  agent,
  highlightRefundId,
  onClear,
}: {
  agent: AgentPoint;
  highlightRefundId: bigint | null;
  onClear: () => void;
}) {
  const id = agent.id;
  const [rows] = useTable(tables.agent.where((r) => r.id.eq(id)));
  const [purchases, purchasesReady] = useTable(tables.purchase.where((r) => r.buyer.eq(id)));
  const [refunds, refundsReady] = useTable(tables.refund.where((r) => r.agentId.eq(id)));
  const [credits, creditsReady] = useTable(tables.creditEvent.where((r) => r.agentId.eq(id)));
  const [businesses] = useTable(tables.business);
  const historyReady = purchasesReady && refundsReady && creditsReady;
  const row = rows[0];
  const score = row?.score ?? agent.score;
  const band = (row?.band ?? agent.band) as keyof typeof BAND_COLOR;

  const bizName = (bid: number) => businesses.find((b) => b.id === bid)?.name ?? businessLabel(bid);

  const timeline = useMemo(() => {
    type Step = {
      key: string;
      day: number;
      kind: "purchase" | "refund" | "decision" | "score";
      title: string;
      detail: string;
      hot?: boolean;
      businessId?: number;
    };
    const steps: Step[] = [];
    const sortedP = [...purchases].sort((a, b) => a.day - b.day || Number(a.id - b.id));
    const sortedR = [...refunds].sort((a, b) => a.day - b.day || Number(a.id - b.id));
    const sortedC = [...credits].sort((a, b) => a.day - b.day || Number(a.id - b.id));

    // Keep the chain readable: last few purchases plus every refund/decision/score.
    for (const p of sortedP.slice(-4)) {
      const item = catalogItem(p.item);
      steps.push({
        key: `p${p.id}`,
        day: p.day,
        kind: "purchase",
        title: `Order · ${money(p.amount)}`,
        detail: `${item?.name ?? "item"} at ${bizName(p.business)}`,
        businessId: p.business,
      });
    }
    for (const r of sortedR) {
      const decided = ["accepted", "declined", "withdrawn"].includes(r.status);
      steps.push({
        key: `r${r.id}`,
        day: r.day,
        kind: "refund",
        title: `Refund request · ${money(r.amount)}`,
        detail: `${titleCase(r.reasonCode)} · ${bizName(r.businessId)}`,
        hot: highlightRefundId !== null && r.id === highlightRefundId,
        businessId: r.businessId,
      });
      if (decided) {
        steps.push({
          key: `d${r.id}`,
          day: r.decidedDay || r.day,
          kind: "decision",
          title: `Confirmed · ${r.status}`,
          detail:
            r.status === "accepted"
              ? `Paid ${money(r.amount)} by ${bizName(r.businessId)}`
              : `${titleCase(r.status)} · ${bizName(r.businessId)}`,
          hot: highlightRefundId !== null && r.id === highlightRefundId,
          businessId: r.businessId,
        });
      }
    }
    for (const c of sortedC.slice(-6)) {
      steps.push({
        key: `c${c.id}`,
        day: c.day,
        kind: "score",
        title: `Score ${c.before} → ${c.after}`,
        detail: `${titleCase(c.kind)} · ${c.delta > 0 ? "+" : ""}${c.delta}`,
        hot: c.causeTable === "refund" && highlightRefundId !== null && c.causeId === highlightRefundId,
      });
    }
    return steps.sort((a, b) => a.day - b.day);
    // bizName closes over businesses
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, refunds, credits, businesses, highlightRefundId]);

  const merchants = useMemo(() => {
    const ids = new Set<number>();
    for (const p of purchases) ids.add(p.business);
    for (const r of refunds) ids.add(r.businessId);
    return [...ids];
  }, [purchases, refunds]);

  return (
    <div className="sim-chain" data-testid="sim-agent-chain">
      <div className="sim-chain__head">
        <div>
          <h2 className="sim-chain__title">{agentLabel(id)}</h2>
          <p className="sim-chain__sub">
            Score{" "}
            <span style={{ color: BAND_COLOR[band] }} className="font-semibold tabular-nums">
              <Tween value={score} />
            </span>
            <span className="text-ink-soft"> / 1000</span>
            {score !== START_SCORE ? (
              <span className="text-ink-soft"> · from {START_SCORE}</span>
            ) : null}
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--xs" onClick={onClear} aria-label="Clear agent">
          ✕
        </button>
      </div>

      {merchants.length > 1 ? (
        <p className="sim-chain__shared">
          Outcomes across {merchants.length} merchants — each sees the shared score, not the others&apos; evidence.{" "}
          <Badge kind="simulated" />
        </p>
      ) : (
        <p className="sim-chain__shared">
          Verified score is portable; claim evidence is not broadcast. <Badge kind="simulated" />
        </p>
      )}

      {!historyReady ? (
        <div className="skeleton h-32 w-full rounded-lg" />
      ) : timeline.length === 0 ? (
        <p className="sim-panel__empty">No purchases yet for this agent.</p>
      ) : (
        <ol className="sim-chain__list">
          {timeline.map((s) => (
            <li key={s.key} className={`sim-chain__step sim-chain__step--${s.kind} ${s.hot ? "is-hot" : ""}`}>
              <span className="sim-chain__day">D{s.day}</span>
              <div>
                <div className="sim-chain__step-title">{s.title}</div>
                <div className="sim-chain__step-detail">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
