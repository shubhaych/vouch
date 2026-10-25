"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useRowsThrottled } from "@/lib/stdb/hooks";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { businessLabel, money, moneyShort } from "@/lib/format";
import type { Business, MerchantFlowDay } from "@/module_bindings/types";
import { ALL_MERCHANTS_FLOW_ID } from "@vouch/module/simdb";

type ChartPt = {
  day: number;
  inflow: number;
  outflow: number;
  net: number;
};

const INFLOW = "#2f9e7a";
const OUTFLOW = "#c45b6a";
const NET = "#3a0f34";

/** Right rail: merchant purchase inflow vs paid refund outflow from merchant_flow_day. */
export function FlowPanel({
  businesses,
  selectedBusinessId,
  onSelectBusiness,
  running,
}: {
  businesses: Business[];
  selectedBusinessId: number | null;
  onSelectBusiness: (id: number | null) => void;
  running: boolean | null;
}) {
  const scopeId = selectedBusinessId ?? ALL_MERCHANTS_FLOW_ID;
  const sql =
    scopeId === ALL_MERCHANTS_FLOW_ID
      ? `SELECT * FROM merchant_flow_day WHERE business_id = 0`
      : `SELECT * FROM merchant_flow_day WHERE business_id = ${scopeId}`;
  const { rows, ready } = useRowsThrottled<MerchantFlowDay>("merchantFlowDay", sql, 800);

  const selected = selectedBusinessId !== null ? businesses.find((b) => b.id === selectedBusinessId) ?? null : null;

  const series = useMemo(() => {
    const byDay = new Map<number, ChartPt>();
    for (const r of rows) {
      const inflow = Number(r.purchaseCents) / 100;
      const outflow = Number(r.refundPaidCents) / 100;
      byDay.set(r.day, { day: r.day, inflow, outflow, net: inflow - outflow });
    }
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }, [rows]);

  const windowed = useMemo(() => {
    if (series.length <= 48) return series;
    return series.slice(-48);
  }, [series]);

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const p of series) {
      inflow += p.inflow;
      outflow += p.outflow;
    }
    return { inflow, outflow, net: inflow - outflow };
  }, [series]);

  // Live balances for the selected merchant (or sum of all) — not from the ring buffer.
  const balanceCents = useMemo(() => {
    if (selected) return Number(selected.balance);
    return businesses.reduce((s, b) => s + Number(b.balance), 0);
  }, [selected, businesses]);

  return (
    <aside className="sim-panel sim-panel--flow" data-testid="sim-flow-panel">
      <header className="sim-panel__head">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="sim-panel__eyebrow">Merchant money flow</p>
            <h2 className="sim-panel__title">
              {selected ? selected.name : "All merchants"}
            </h2>
          </div>
          {running === false ? (
            <span className="chip chip--review-light" data-testid="sim-paused">
              Simulation paused
            </span>
          ) : null}
        </div>
        <div className="sim-flow__tabs" role="tablist" aria-label="Merchant scope">
          <button
            type="button"
            role="tab"
            aria-selected={selectedBusinessId === null}
            className={`sim-flow__tab ${selectedBusinessId === null ? "is-active" : ""}`}
            onClick={() => onSelectBusiness(null)}
            data-testid="sim-flow-all"
          >
            All merchants
          </button>
          {selected ? (
            <button
              type="button"
              role="tab"
              aria-selected
              className="sim-flow__tab is-active"
              onClick={() => onSelectBusiness(selected.id)}
            >
              {selected.name}
            </button>
          ) : (
            <span className="sim-flow__hint">Click a merchant diamond on the globe</span>
          )}
        </div>
      </header>

      <div className="sim-flow__totals">
        <FlowStat label="Purchase inflow" value={ready ? totals.inflow : null} color={INFLOW} />
        <FlowStat label="Paid refunds" value={ready ? totals.outflow : null} color={OUTFLOW} note="Accepted only" />
        <FlowStat label="Net flow" value={ready ? totals.net : null} color={NET} />
        <FlowStat
          label={selected ? "Balance" : "Balances"}
          value={businesses.length ? balanceCents / 100 : null}
          color="var(--aubergine)"
          money
        />
      </div>

      <div className="sim-flow__chart" data-testid="sim-flow-chart">
        {!ready ? (
          <div className="skeleton h-full w-full rounded-lg" />
        ) : windowed.length < 2 ? (
          <p className="sim-panel__empty">Waiting for purchase and refund day buckets…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={windowed} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="rgba(58,15,52,0.08)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: "#6b4a66", fontSize: 10 }}
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(d) => `D${d}`}
              />
              <YAxis
                tick={{ fill: "#6b4a66", fontSize: 10 }}
                tickFormatter={(v) => moneyShort(Math.round(v * 100))}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#f7f9fb",
                  border: "1px solid #c5ced6",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#3a0f34",
                }}
                labelFormatter={(d) => `Day ${d}`}
                formatter={(v, name) => [
                  money(Math.round(Number(v) * 100)),
                  name === "inflow" ? "Inflow" : name === "outflow" ? "Paid refunds" : "Net",
                ]}
              />
              <Line
                type="linear"
                dataKey="inflow"
                stroke={INFLOW}
                strokeWidth={0}
                dot={{ r: 3.5, fill: INFLOW, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                name="inflow"
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="outflow"
                stroke={OUTFLOW}
                strokeWidth={0}
                dot={{ r: 3.5, fill: OUTFLOW, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                name="outflow"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="net"
                stroke={NET}
                strokeWidth={1.75}
                dot={false}
                name="net"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="sim-panel__footnote">
        Chart from <span className="font-mono">merchant_flow_day</span> aggregates. Requested refunds are not money out.{" "}
        <Badge kind="simulated" />
        {selected ? (
          <button type="button" className="sim-flow__clear" onClick={() => onSelectBusiness(null)}>
            Clear {businessLabel(selected.id)}
          </button>
        ) : null}
      </p>
    </aside>
  );
}

function FlowStat({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number | null;
  color: string;
  note?: string;
  money?: boolean;
}) {
  return (
    <div className="sim-flow__stat">
      <div className="sim-metric__label">
        <span className="sim-flow__swatch" style={{ background: color }} />
        {label} <Badge kind="simulated" />
      </div>
      <div className="sim-metric__value" style={{ color }}>
        {value === null ? (
          <span className="skeleton inline-block h-5 w-14" />
        ) : (
          <Tween value={value} format={(n) => money(Math.round(n * 100))} />
        )}
      </div>
      {note ? <div className="sim-metric__sub">{note}</div> : null}
    </div>
  );
}
