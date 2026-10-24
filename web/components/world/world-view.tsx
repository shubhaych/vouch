"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { useCall, useRowsThrottled, useStatus } from "@/lib/stdb/hooks";
import type { Business, RegionStat } from "@/module_bindings/types";
import { int } from "@/lib/format";
import { WorldGlobe, type BusinessPoint, type HexPoint, type Pov } from "./globe";
import { arcsFromFeed, ringsFromFeed, useAgents, useFeed, type AgentPoint } from "./use-world";
import { EventMonitor } from "./event-monitor";
import { AgentPanel } from "./agent-panel";
import { PatternsRail } from "./patterns-rail";
import { ReplayPanel, useReplay } from "./replay";
import { METRICS, ObservatoryPanel, RegionPanel, type Metric } from "./observatory";

export type Mode = "live" | "replay" | "observatory";
export type Layer = "shopping" | "refunds" | "patterns" | "credit";

const LAYERS: { id: Layer; label: string }[] = [
  { id: "shopping", label: "Shopping" },
  { id: "refunds", label: "Refunds" },
  { id: "patterns", label: "Fraud patterns" },
  { id: "credit", label: "Agent credit" },
];

export function WorldView() {
  return (
    <Suspense fallback={<div className="skeleton h-[calc(100vh-62px)] w-full rounded-none" />}>
      <WorldInner />
    </Suspense>
  );
}

function WorldInner() {
  const params = useSearchParams();
  const router = useRouter();
  const agents = useAgents();
  const { events, people } = useFeed();
  const { rows: businessRows } = useRowsThrottled<Business>("business", "SELECT * FROM business", 1000);
  const { rows: regions } = useRowsThrottled<RegionStat>("regionStat", "SELECT * FROM region_stat", 1000);
  const [patterns] = useTable(tables.fraudPattern);
  const [runs] = useTable(tables.simRun);
  const run = runs[0];

  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "live");
  const [layer, setLayer] = useState<Layer>("shopping");
  const [selectedId, setSelectedId] = useState<number | null>(params.get("agent") ? Number(params.get("agent")) : null);
  const [patternId, setPatternId] = useState<number | null>(params.get("pattern") ? Number(params.get("pattern")) : null);
  const [metric, setMetric] = useState<Metric>("shopping");
  const [regionId, setRegionId] = useState<number | null>(null);
  const [pov, setPov] = useState<Pov | null>({ lat: 28, lng: -40, altitude: 2.4 });
  const [highlightCause, setHighlightCause] = useState<string | null>(null);

  const businesses = useMemo(() => new Map(businessRows.map((b) => [b.id, b])), [businessRows]);
  const selected = selectedId !== null ? agents.byId.get(selectedId) ?? null : null;
  const pattern = patternId !== null ? patterns.find((p) => p.id === patternId) ?? null : null;
  const replay = useReplay(mode === "replay" ? pattern : null, agents.byId, businesses);

  const selectAgent = useCallback((id: number | null, cause?: string) => {
    setSelectedId(id);
    setHighlightCause(cause ?? null);
    if (id !== null) {
      const a = agents.byId.get(id);
      if (a) setPov({ lat: a.lat, lng: a.lng, altitude: 1.4 });
    }
  }, [agents.byId]);

  const openPattern = useCallback((id: number) => {
    setPatternId(id);
    setMode("replay");
  }, []);

  // ---- layers for the globe
  const bizPoints: BusinessPoint[] = useMemo(() => {
    const maxSales = Math.max(1, ...businessRows.map((b) => b.sales));
    return businessRows.map((b) => ({
      id: b.id, lat: b.lat, lng: b.lng, name: b.name, category: b.category,
      size: mode === "observatory" && metric === "business" ? 6 + (b.sales / maxSales) * 20 : 7,
      dim: mode === "replay" && replay ? !replay.businessIds.has(b.id) : false,
    }));
  }, [businessRows, mode, metric, replay]);

  const liveArcs = useMemo(() => {
    const bmap = new Map(businessRows.map((b) => [b.id, { lat: b.lat, lng: b.lng, category: b.category }]));
    const all = arcsFromFeed(events, agents.byId, bmap, 160);
    if (layer === "refunds") return all.filter((a) => a.kind !== "purchase").slice(0, 120);
    if (layer === "shopping") return all.filter((a) => a.kind === "purchase").slice(0, 120);
    return all.slice(0, 60);
  }, [events, agents.byId, businessRows, layer]);

  const liveRings = useMemo(() => {
    const r = ringsFromFeed(events, agents.byId);
    if (layer === "patterns") {
      for (const p of patterns) {
        if (p.status === "dismissed") continue;
        const first = agents.byId.get(p.agentIds[0] ?? -1);
        if (first) r.push({ id: `fp${p.id}`, lat: first.lat, lng: first.lng, color: p.status === "confirmed" ? "#f87171" : "#fbbf24", max: 2 + Math.min(8, p.agentIds.length), speed: 1.5 });
      }
    }
    return r;
  }, [events, agents.byId, layer, patterns]);

  const hex = useMemo((): { points: HexPoint[] | null; colorBy: "weight" | "score"; max: number } => {
    if (mode !== "observatory" || metric === "business") return { points: null, colorBy: "weight", max: 1 };
    const regionRow = new Map(regions.map((r) => [r.regionId, r]));
    const inPattern = new Set<number>();
    for (const p of patterns) if (p.status !== "dismissed") for (const a of p.agentIds) inPattern.add(a);
    const pts: HexPoint[] = [];
    for (const a of agents.all) {
      const r = regionRow.get(a.region);
      const share = r && r.agents ? 1 / r.agents : 0;
      let w = 0;
      if (metric === "shopping") w = a.purchases;
      else if (metric === "refunds") w = a.refunds;
      else if (metric === "losses") w = r ? (Number(r.lossCents) / 100) * share : 0;
      else if (metric === "honest_declines") w = r ? r.honestDeclines * share : 0;
      else if (metric === "fraud") w = inPattern.has(a.id) ? 1 : 0;
      else if (metric === "credit") w = 1;
      if (w > 0 || metric === "credit") pts.push({ lat: a.lat, lng: a.lng, weight: w, score: a.score });
    }
    // Normalise height against a typical busy hex, not the single largest one.
    const total = pts.reduce((s, x) => s + x.weight, 0);
    return { points: pts, colorBy: metric === "credit" ? "score" : "weight", max: Math.max(1, (total / 180) * 4) };
  }, [mode, metric, agents.all, regions, patterns]);

  const onGlobe = (lat: number, lng: number) => {
    if (mode === "observatory") return;
    const a = agents.nearest(lat, lng);
    if (a) selectAgent(a.id);
  };

  const onHex = (lat: number, lng: number) => {
    let best: number | null = null;
    let bestD = Infinity;
    for (const r of regions) {
      const d = (r.lat - lat) ** 2 + (r.lng - lng) ** 2;
      if (d < bestD) { bestD = d; best = r.regionId; }
    }
    setRegionId(best);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m !== "replay") setPatternId(null);
    if (m !== "observatory") setRegionId(null);
    router.replace(m === "live" ? "/world" : `/world?mode=${m}`, { scroll: false });
  };

  const dim = mode === "replay" && replay ? replay.dimmed : null;
  const highlight = mode === "replay" && replay ? replay.members : null;

  return (
    <main className="app-dark relative h-[calc(100vh-62px)] min-h-[640px] w-full overflow-hidden bg-bg-dark" data-testid="world">
      <WorldGlobe
        byBand={agents.byBand}
        live={agents.live}
        dimmed={dim}
        highlight={highlight}
        selected={mode === "replay" ? null : selected}
        businesses={bizPoints}
        arcs={mode === "replay" && replay ? replay.arcs : mode === "observatory" ? [] : liveArcs}
        rings={mode === "replay" && replay ? replay.rings : mode === "observatory" ? [] : liveRings}
        hexPoints={hex.points}
        hexColorBy={hex.colorBy}
        hexMax={hex.max}
        pov={mode === "replay" && replay ? replay.pov : pov}
        autoRotate={mode === "live" && !selected}
        onAgent={(id) => selectAgent(id)}
        onGlobe={onGlobe}
        onHex={onHex}
        onBusiness={() => undefined}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        <div className="glass pointer-events-auto flex items-center gap-1 p-1" role="tablist" aria-label="World mode">
          {(["live", "replay", "observatory"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} data-testid={`mode-${m}`}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${mode === m ? "bg-accent text-black" : "text-ink-soft-dark hover:text-ink-dark"}`}>
              {m}
            </button>
          ))}
        </div>
        {mode === "live" ? (
          <div className="glass pointer-events-auto flex flex-wrap items-center gap-1 p-1" aria-label="Layers">
            {LAYERS.map((l) => (
              <button key={l.id} onClick={() => setLayer(l.id)} data-testid={`layer-${l.id}`}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${layer === l.id ? "bg-white/10 text-ink-dark" : "text-ink-soft-dark hover:text-ink-dark"}`}>
                {l.label}
              </button>
            ))}
          </div>
        ) : mode === "observatory" ? (
          <ObservatoryPanel metric={metric} onMetric={setMetric} />
        ) : <div />}
        <SimControls />
      </div>

      {/* Left rail: patterns list and the Droid mini panel */}
      <div className="absolute left-3 top-20 bottom-[13.5rem] z-10 hidden w-72 lg:block">
        <PatternsRail patterns={patterns} selectedId={patternId} onOpen={openPattern} />
      </div>

      {/* Right drawer */}
      <div className="absolute right-3 top-20 bottom-[13.5rem] z-10 w-[min(25rem,calc(100vw-1.5rem))]">
        {mode === "replay" && pattern && replay ? (
          <ReplayPanel pattern={pattern} replay={replay} onAgent={(id) => { switchMode("live"); selectAgent(id, `fraud_pattern:${pattern.id}`); }} onClose={() => switchMode("live")} />
        ) : mode === "observatory" && regionId !== null ? (
          <RegionPanel regionId={regionId} regions={regions} businesses={businessRows} patterns={patterns} agents={agents.byId} onClose={() => setRegionId(null)} onPattern={openPattern} />
        ) : selected ? (
          <AgentPanel agent={selected} highlightCause={highlightCause} onClose={() => selectAgent(null)} onPattern={openPattern} />
        ) : mode === "replay" ? (
          <div className="glass p-4 text-sm text-ink-soft-dark">Pick a pattern on the left to replay it. Every frame is read from <span className="font-mono">pattern_event</span> rows; nothing is generated in the browser.</div>
        ) : null}
      </div>

      {/* Bottom: live event monitor */}
      <div className="absolute inset-x-3 bottom-3 z-10 h-[12.5rem]">
        <EventMonitor events={events} people={people} onAgent={(id) => { if (mode !== "live") switchMode("live"); selectAgent(id); }} onPattern={openPattern} />
      </div>

      {/* Counters and the honesty line */}
      <div className="pointer-events-none absolute left-3 top-[4.6rem] z-10 hidden text-xs text-ink-soft-dark lg:hidden" />
      <div className="pointer-events-none absolute right-3 bottom-[13.6rem] z-0 text-right text-[0.7rem] text-ink-soft-dark">
        <div data-testid="agent-count">{int(agents.count)} agents <Badge kind="simulated" /> · {businessRows.length} businesses · day {run?.day ?? "…"} <Badge kind="live" /></div>
        <div className="mt-0.5" data-testid="honesty-line">Simulated agents. Vouch does not track real locations.</div>
      </div>
      {!agents.ready ? <ConnectingNote /> : null}
    </main>
  );
}

function ConnectingNote() {
  const { status, error } = useStatus();
  return (
    <div className="glass absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 px-5 py-4 text-center text-sm">
      {status === "error" ? <>Cannot reach SpacetimeDB: {error}</> : <>Subscribing to 10,000 agents…</>}
    </div>
  );
}

function SimControls() {
  const [runs] = useTable(tables.simRun);
  const [roles] = useTable(tables.role);
  const { identity } = useStatus();
  const call = useCall();
  const run = runs[0];
  const isController = roles.some((r) => r.role === "controller" && r.who.toHexString() === identity);
  if (!run) return <div className="glass pointer-events-auto px-3 py-2 text-xs text-ink-soft-dark">…</div>;
  const set = (running: boolean, agentsPerTick: number, tickMicros: bigint) =>
    call("setSim", (r) => r.setSim({ running, agentsPerTick, tickMicros, maxDay: 0 }));
  const speeds: { label: string; apt: number; micros: bigint }[] = [
    { label: "0.25x", apt: 250, micros: 200_000n },
    { label: "1x", apt: 1000, micros: 200_000n },
    { label: "2x", apt: 2000, micros: 200_000n },
  ];
  return (
    <div className="glass pointer-events-auto flex items-center gap-2 px-2 py-1.5" data-testid="sim-controls" title={isController ? "Simulation controls" : "Take the controller seat on /business to change the simulation"}>
      <button className="btn btn--ghost-dark btn--xs" disabled={!isController} onClick={() => set(!run.running, run.agentsPerTick, run.tickMicros)} data-testid="sim-play">
        {run.running ? "Pause" : "Play"}
      </button>
      {speeds.map((s) => (
        <button key={s.label} disabled={!isController} onClick={() => set(true, s.apt, s.micros)}
          className={`btn btn--xs ${run.agentsPerTick === s.apt ? "btn--review" : "btn--ghost-dark"}`}>{s.label}</button>
      ))}
      <span className="font-mono text-xs text-ink-dark" data-testid="sim-day">Day {run.day}</span>
      <Badge kind="live" />
      {!run.running ? <span className="chip chip--review">paused</span> : null}
    </div>
  );
}

export type { AgentPoint };
export { METRICS };
