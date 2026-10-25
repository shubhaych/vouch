"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { useConn } from "@/lib/stdb/hooks";
import { useLatency } from "@/lib/stdb/latency";
import { Badge } from "@/components/ui/badge";

const TABLES = ["agent", "purchase", "refund", "creditEvent", "eventFeed", "merchantFlowDay", "business"] as const;
const WINDOW = 60;

/** Rows this browser received per second, counted from the SpacetimeDB row callbacks themselves. */
function useRowRate() {
  const conn = useConn();
  const count = useRef(0);
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    if (!conn) return;
    const bump = () => { count.current += 1; };
    const db = conn.db as unknown as Record<string, { onInsert(cb: () => void): void; onUpdate(cb: () => void): void; removeOnInsert(cb: () => void): void; removeOnUpdate(cb: () => void): void }>;
    for (const t of TABLES) { db[t]?.onInsert(bump); db[t]?.onUpdate(bump); }
    const id = setInterval(() => { const n = count.current; count.current = 0; setSeries((s) => [...s.slice(-(WINDOW - 1)), n]); }, 1000);
    return () => { clearInterval(id); for (const t of TABLES) { db[t]?.removeOnInsert(bump); db[t]?.removeOnUpdate(bump); } };
  }, [conn]);
  return series;
}

/** Live readings measured in this tab: rows arriving per second, the last tick, and round trip. */
export function LiveReadings() {
  const rate = useRowRate();
  const [m] = useTable(tables.metrics);
  const row = m[0];
  const latency = useLatency();
  const now = rate.at(-1) ?? 0;
  const peak = Math.max(1, ...rate);
  const pts = rate.map((v, i) => `${((i + WINDOW - rate.length) / (WINDOW - 1)) * 200},${38 - (v / peak) * 34}`);
  const line = pts.length ? `M${pts.join(" L")}` : "";
  const area = pts.length ? `${line} L200,40 L${pts[0]!.split(",")[0]},40 Z` : "";

  return (
    <section className="live-readings" data-testid="live-readings" aria-label="Live readings">
      <header className="live-readings__head">
        <span className="live-readings__title">Live readings</span>
        <Badge kind="live" />
      </header>
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="live-readings__chart" aria-label="Rows received per second, last 60 seconds">
        <path d={area} fill="color-mix(in srgb, #2f9e7a 14%, transparent)" />
        <path d={line} fill="none" stroke="#2f9e7a" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="live-readings__stats">
        <div><dt>rows / s</dt><dd>{now.toLocaleString()}</dd></div>
        <div><dt>last tick</dt><dd>{row ? `${row.eventsLastTick} events` : "…"}</dd></div>
        <div><dt>round trip</dt><dd>{latency.p50 === null ? "…" : `${Math.round(latency.p50)} ms`}</dd></div>
      </dl>
    </section>
  );
}

const TOTAL_WINDOW = 40;

/** Running total of every row SpacetimeDB holds for the economy, from the module's own metrics row. */
export function TotalWrites() {
  const [m] = useTable(tables.metrics);
  const row = m[0];
  const raw = row?.rowCounts;
  const counts = useMemo(() => {
    try { return JSON.parse(raw || "{}") as Record<string, number>; } catch { return {} as Record<string, number>; }
  }, [raw]);
  const total = Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);
  const [series, setSeries] = useState<number[]>([]);
  const last = useRef(0);
  useEffect(() => {
    if (!total || total === last.current) return;
    last.current = total;
    setSeries((s) => [...s.slice(-(TOTAL_WINDOW - 1)), total]);
  }, [total]);
  const lo = Math.min(...series), hi = Math.max(...series);
  const range = Math.max(1, hi - lo);
  const pts = series.map((v, i) => `${((i + TOTAL_WINDOW - series.length) / (TOTAL_WINDOW - 1)) * 200},${46 - ((v - lo) / range) * 40}`);
  const line = pts.length > 1 ? `M${pts.join(" L")}` : "";
  const area = line ? `${line} L200,48 L${pts[0]!.split(",")[0]},48 Z` : "";
  const added = series.length > 1 ? hi - lo : 0;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <div className="total-writes" data-testid="total-writes">
      <div className="total-writes__value">{total ? total.toLocaleString() : "…"}</div>
      <div className="total-writes__sub">rows written in total{added ? ` · +${added.toLocaleString()} since you opened this` : ""}</div>
      <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="total-writes__chart" aria-label="Total rows written, recent ticks">
        <path d={area} fill="color-mix(in srgb, #3a0f34 10%, transparent)" />
        <path d={line} fill="none" stroke="#3a0f34" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <ul className="total-writes__tables">
        {top.map(([t, n]) => <li key={t}><span>{t}</span><b>{Number(n).toLocaleString()}</b></li>)}
      </ul>
    </div>
  );
}
