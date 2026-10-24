"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { FeedEvent } from "./use-world";
import { useLatency } from "@/lib/stdb/latency";

const KIND_COLOR: Record<string, string> = {
  purchase: "text-accent", refund: "text-review", refund_accepted: "text-honest", refund_declined: "text-fraud",
  credit: "text-credential", pattern: "text-fraud", claim: "text-accent", decision: "text-honest", delivery: "text-ink-soft-dark",
  join: "text-accent", system: "text-ink-soft-dark",
};

/** Events per second over the last 10 s, from feed seq deltas the client observes. */
export function useEventRate(events: FeedEvent[]) {
  const samples = useRef<{ t: number; seq: number }[]>([]);
  const [rate, setRate] = useState<{ now: number; series: number[] }>({ now: 0, series: [] });
  const top = events[0] ? Number(events[0].seq) : 0;
  const topRef = useRef(top);
  topRef.current = top;
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      samples.current.push({ t: now, seq: topRef.current });
      samples.current = samples.current.filter((s) => now - s.t <= 60_000);
      const s = samples.current;
      const win = s.filter((x) => now - x.t <= 10_000);
      const first = win[0];
      const last = win[win.length - 1];
      const r = first && last && last.t > first.t ? ((last.seq - first.seq) / (last.t - first.t)) * 1000 : 0;
      const series: number[] = [];
      for (let i = 1; i < s.length; i++) series.push(((s[i]!.seq - s[i - 1]!.seq) / Math.max(1, s[i]!.t - s[i - 1]!.t)) * 1000);
      setRate({ now: r, series: series.slice(-40) });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return rate;
}

export function Sparkline({ values, color = "#22d3ee", w = 120, h = 28 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function EventMonitor({ events, onAgent, onPattern }: { events: FeedEvent[]; onAgent: (id: number) => void; onPattern: (id: number) => void }) {
  const [paused, setPaused] = useState<FeedEvent[] | null>(null);
  const shown = useMemo(() => (paused ?? events).slice(0, 60), [paused, events]);
  const rate = useEventRate(events);
  const latency = useLatency();
  // Hundreds of purchases a second would turn every line cyan; flash only the events a person acts on.
  const fresh = (e: FeedEvent) => ["pattern", "claim", "decision", "join", "refund_declined"].includes(e.kind);

  return (
    <div className="glass flex h-full min-h-0 flex-col" data-testid="event-monitor">
      <div className="flex items-center justify-between gap-3 border-b border-line-dark px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="panel-title">Live event monitor</span>
          <Badge kind="live" />
          {paused ? <span className="chip chip--review">paused</span> : null}
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-soft-dark">
          <span className="flex items-center gap-2" title="Events per second over the last 10 s, from event_feed sequence numbers">
            <Sparkline values={rate.series} />
            <span className="font-mono text-ink-dark" data-testid="events-per-sec">{rate.now.toFixed(0)}</span> ev/s <Badge kind="live" />
          </span>
          <span className="font-mono" title="Round trip: ping reducer to row arrival, on this browser's clock" data-testid="latency-p50">
            sync p50 <span className="text-ink-dark">{latency.p50 === null ? "…" : `${latency.p50.toFixed(0)} ms`}</span> <Badge kind="live" />
          </span>
        </div>
      </div>
      <ol
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[0.72rem] leading-5"
        onMouseEnter={() => setPaused(events)}
        onMouseLeave={() => setPaused(null)}
      >
        {shown.length === 0 ? <li className="px-1 py-2 text-ink-soft-dark">Waiting for the first event…</li> : null}
        {shown.map((e) => (
          <li key={e.seq.toString()} className={fresh(e) ? (e.kind === "pattern" || e.kind === "refund_declined" ? "flash-fraud" : "flash-accent") : ""}>
            <button
              className={`w-full truncate rounded px-1 text-left hover:bg-white/5 ${KIND_COLOR[e.kind] ?? "text-ink-dark"}`}
              onClick={() => (e.kind === "pattern" ? onPattern(Number(e.refId)) : e.agentId ? onAgent(e.agentId) : undefined)}
              data-testid="monitor-line"
            >
              <span className="mr-2 text-ink-soft-dark">d{e.day}</span>
              {e.line}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
