"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/num";
import { useTableVersion } from "@/lib/stdb/hooks";
import { useLatency } from "@/lib/stdb/latency";
import { WORKER_URL } from "@/lib/stdb/config";
import { int } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { ArchitectureDiagram } from "./architecture";

interface Sample { t: number; steps: number; day: number; seq: number }

export function SystemView() {
  const [metricsRows] = useTable(tables.metrics);
  const [runs] = useTable(tables.simRun);
  const [bench] = useTable(tables.benchResult);
  const [feed] = useTable(tables.eventFeed);
  const latency = useLatency();
  const m = metricsRows[0];
  const run = runs[0];
  const counts = useMemo(() => { try { return JSON.parse(m?.rowCounts || "{}") as Record<string, number>; } catch { return {}; } }, [m?.rowCounts]);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  // Time to first sync: from mounting this page to the 10,000-agent subscription being applied.
  const mountedAt = useRef(performance.now());
  const { ready } = useTableVersion("agent", "SELECT * FROM agent", 5000);
  const [firstSync, setFirstSync] = useState<number | null>(null);
  useEffect(() => { if (ready && firstSync === null) setFirstSync(performance.now() - mountedAt.current); }, [ready, firstSync]);

  const topSeq = feed.reduce((mx, r) => (r.seq > mx ? r.seq : mx), 0n);
  const latest = useRef<Sample>({ t: 0, steps: 0, day: 0, seq: 0 });
  latest.current = { t: performance.now(), steps: Number(m?.stepsTotal ?? 0n), day: run?.day ?? 0, seq: Number(topSeq) };
  const [series, setSeries] = useState<Sample[]>([]);
  useEffect(() => {
    const id = setInterval(() => setSeries((s) => [...s.slice(-90), { ...latest.current, t: performance.now() }]), 1000);
    return () => clearInterval(id);
  }, []);
  const rate = (pick: (s: Sample) => number, windowMs: number) => {
    const now = series[series.length - 1];
    const old = [...series].reverse().find((s) => now && now.t - s.t >= windowMs) ?? series[0];
    if (!now || !old || now.t === old.t) return null;
    return (pick(now) - pick(old)) / ((now.t - old.t) / 1000);
  };
  const stepsPerSec = rate((s) => s.steps, 10_000);
  const daysPerMin = (() => { const r = rate((s) => s.day, 30_000); return r === null ? null : r * 60; })();
  const evPerSec = rate((s) => s.seq, 10_000);
  const chart = series.slice(1).map((s, i) => ({ t: i, ev: Math.max(0, ((s.seq - series[i]!.seq) / Math.max(0.001, (s.t - series[i]!.t) / 1000))) }));
  const hist = useMemo(() => {
    const buckets = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
    const out = buckets.map((b) => ({ ms: `≤${b}`, n: 0 }));
    out.push({ ms: ">1280", n: 0 });
    for (const x of latency.samples) { const i = buckets.findIndex((b) => x <= b); out[i === -1 ? out.length - 1 : i]!.n++; }
    return out;
  }, [latency.samples]);

  const runBench = async () => {
    try {
      const r = await fetch(`${WORKER_URL}/bench`, { method: "POST" });
      const j = (await r.json()) as { message?: string; error?: string };
      toast(j.message ?? j.error ?? `worker answered ${r.status}`, r.ok ? "accent" : "fraud");
    } catch {
      toast(`The worker at ${WORKER_URL} is not reachable; run npx tsx scripts/bench.ts on the worker machine.`, "fraud");
    }
  };

  return (
    <main className="app-dark mx-auto max-w-[1400px] space-y-5 px-4 py-6 text-ink-dark sm:px-6" data-testid="system">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section__eyebrow">System</p>
          <h1 className="section__title">The scale claim, as numbers</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft-dark">Every number on this page is computed now from SpacetimeDB rows the browser is subscribed to. The simulation runs inside the module as a scheduled reducer.</p>
        </div>
        <div className="font-mono text-xs text-ink-soft-dark">day {run?.day ?? "…"} · {run?.running ? "running" : "paused"} · {run?.agentsPerTick ?? "…"} agents per tick every {run ? Number(run.tickMicros) / 1000 : "…"} ms <Badge kind="live" /></div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          ["Agents", counts.agent], ["Businesses", counts.business], ["Purchases", counts.purchase], ["Refunds", counts.refund],
          ["Credit events", counts.creditEvent], ["Fraud patterns", counts.fraudPattern], ["Rows (counted)", total],
        ].map(([label, v]) => (
          <div key={label as string} className="glass p-3"><Stat label={label as string} value={v === undefined ? null : (v as number)} prov="live" testId={`stat-${String(label).toLowerCase().replaceAll(" ", "-")}`} /></div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="glass p-3"><Stat label="Agent-steps / second" value={stepsPerSec === null ? null : Math.round(stepsPerSec)} prov="live" testId="steps-per-sec" sub="from metrics.steps_total deltas" /></div>
        <div className="glass p-3"><Stat label="Simulated days / minute" value={daysPerMin === null ? null : Math.round(daysPerMin * 10) / 10} prov="live" format={(n) => n.toFixed(1)} sub="from sim_run.day deltas" /></div>
        <div className="glass p-3"><Stat label="Events / second" value={evPerSec === null ? null : Math.round(evPerSec)} prov="live" testId="system-events-per-sec" sub="from event_feed seq, last 10 s" /></div>
        <div className="glass p-3"><Stat label="Sync latency p50 / p95" value={latency.p50 === null ? null : Math.round(latency.p50)} prov="live" format={(n) => `${Math.round(n)} / ${latency.p95 === null ? "…" : Math.round(latency.p95)} ms`} testId="system-latency" sub="ping reducer round trip on this clock" /></div>
        <div className="glass p-3"><Stat label="Time to first sync" value={firstSync === null ? null : Math.round(firstSync)} prov="live" format={(n) => `${Math.round(n)} ms`} sub="10,000 agents, page mount → applied" /></div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="glass p-4">
          <div className="panel-title mb-2">Events per second (last 90 s) <Badge kind="live" /></div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
                <XAxis dataKey="t" hide />
                <YAxis tick={{ fill: "#8b9aab", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0b0f14", border: "1px solid rgba(148,163,184,0.2)", fontSize: 12 }} formatter={(v) => [`${Math.round(Number(v))} ev/s`, ""]} labelFormatter={() => ""} />
                <Area dataKey="ev" stroke="#22d3ee" fill="rgba(34,211,238,0.15)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass p-4">
          <div className="panel-title mb-2">Sync latency histogram ({latency.samples.length} pings) <Badge kind="live" /></div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
                <XAxis dataKey="ms" tick={{ fill: "#8b9aab", fontSize: 10 }} />
                <YAxis tick={{ fill: "#8b9aab", fontSize: 10 }} allowDecimals={false} />
                <Bar dataKey="n" fill="#34d399" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="glass p-4">
          <div className="panel-title mb-2">Row counts per table <Badge kind="live" /></div>
          <table className="w-full font-mono text-sm" data-testid="row-counts">
            <tbody>
              {Object.entries(counts).map(([k, v]) => (
                <tr key={k} className="border-b border-line-dark/60"><td className="py-1">{k}</td><td className="py-1 text-right">{int(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-soft-dark">Refreshed by the tick every 25 ticks (metrics.row_counts).</p>
        </div>
        <div className="glass p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="panel-title">Benchmark: fresh databases, 30 simulated days each</span>
            <button className="btn btn--ghost-dark btn--xs" onClick={runBench} data-testid="bench-run">Run benchmark</button>
          </div>
          {/* the machine string is long; on a phone the table scrolls inside its panel, not the page (QA-009) */}
          <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="bench-table">
            <thead className="text-left text-xs text-ink-soft-dark"><tr><th className="py-1">Agents</th><th>Days</th><th>Steps / s</th><th>Days / min</th><th>Machine</th><th>Ran</th></tr></thead>
            <tbody className="font-mono">
              {[...bench].sort((a, b) => a.agents - b.agents || a.id - b.id).map((b) => (
                <tr key={b.id} className="border-t border-line-dark/60"><td className="py-1">{int(b.agents)}</td><td>{b.days}</td><td>{int(Math.round(b.stepsPerSec))}</td><td>{b.daysPerMin.toFixed(1)}</td><td className="truncate font-sans text-xs">{b.machine}</td><td className="text-xs">{b.ranAt}</td></tr>
              ))}
              {bench.length === 0 ? <tr><td colSpan={6} className="py-3 font-sans text-xs text-ink-soft-dark">No benchmark has been run against this database yet. A million agents is only shown if it was actually run.</td></tr> : null}
            </tbody>
          </table>
          </div>
          {bench.length ? <p className="mt-2 text-xs text-ink-soft-dark"><Badge kind="live" /> measured by scripts/bench.ts and written to bench_result.</p> : null}
        </div>
      </section>

      <section className="glass p-4">
        <div className="panel-title mb-2">Architecture: three clients, one database, one worker</div>
        <ArchitectureDiagram />
      </section>
    </main>
  );
}
