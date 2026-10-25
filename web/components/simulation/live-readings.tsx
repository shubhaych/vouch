"use client";

import { useEffect, useRef, useState } from "react";
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
