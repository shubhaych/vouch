"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Business } from "@/module_bindings/types";
import { useRowsThrottled, useStatus } from "@/lib/stdb/hooks";
import { Badge } from "@/components/ui/badge";
import { START_SCORE } from "@vouch/module/score";
import { WorldGlobe, type BusinessPoint, type Pov } from "@/components/world/globe";
import {
  arcsFromFeed,
  ringsFromFeed,
  useAgents,
  useFeed,
  useStableById,
  type FeedEvent,
} from "@/components/world/use-world";
import { TrustPanel, type TrustCounts } from "./trust-panel";
import { FlowPanel } from "./flow-panel";
import { EventRail } from "./event-rail";
import { MerchantFlow } from "./merchant-flow";

/**
 * Judge-facing simulation: one Lenis sticky scroll scene.
 * Opening = globe alone; settled = trust | globe | flow + event rail.
 * One mounted globe and stable SpacetimeDB subscriptions throughout.
 */
export function SimulationView() {
  return (
    <Suspense fallback={<div className="skeleton sim-scene__fallback" />}>
      <SimulationInner />
    </Suspense>
  );
}

function SimulationInner() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = !!useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  // Compact scroll map — settled by ~70% so reverse scroll isn't dead air.
  // Panels grow into space; globe flex-shrinks to ~48% — no CSS scale on the WebGL canvas.
  const leftT = useTransform(scrollYProgress, [0.06, 0.32], [0, 1]);
  const rightT = useTransform(scrollYProgress, [0.18, 0.48], [0, 1]);
  const railT = useTransform(scrollYProgress, [0.38, 0.68], [0, 1]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.08, 0.18], [1, 0.85, 0]);

  const leftWidth = useProgressWidth(leftT, 24, reduced);
  const rightWidth = useProgressWidth(rightT, 28, reduced);
  const leftOpacity = useProgressUnit(leftT, reduced);
  const rightOpacity = useProgressUnit(rightT, reduced);
  const railHeight = useTransform(railT, (t) => `${(reduced ? 1 : t) * 7.25}rem`);
  const railOpacity = useProgressUnit(railT, reduced);
  const leftPointer = useTransform(leftOpacity, (o) => (o > 0.55 ? "auto" : "none"));
  const rightPointer = useTransform(rightOpacity, (o) => (o > 0.55 ? "auto" : "none"));

  const agents = useAgents();
  const { events } = useFeed();
  const { rows: businessRows } = useRowsThrottled<Business>("business", "SELECT * FROM business", 1000);
  const [runs] = useTable(tables.simRun);
  const [metrics] = useTable(tables.metrics);
  const run = runs[0];
  const running = run ? run.running : null;

  const rowCounts = useMemo(() => {
    try {
      return JSON.parse(metrics[0]?.rowCounts || "{}") as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  }, [metrics]);

  const agentsScored = useMemo(() => {
    let n = 0;
    for (const a of agents.byId.values()) if (a.score !== START_SCORE) n += 1;
    return n;
  }, [agents.byId, agents.version]);

  const confirmed = useMemo(
    () => businessRows.reduce((s, b) => s + b.refundsPaid, 0),
    [businessRows],
  );

  const counts: TrustCounts = {
    agents: agents.count,
    merchants: businessRows.length,
    purchases: rowCounts.purchase ?? [...agents.byId.values()].reduce((s, a) => s + a.purchases, 0),
    refundRequests: rowCounts.refund ?? [...agents.byId.values()].reduce((s, a) => s + a.refunds, 0),
    confirmed,
    scoreChanges: rowCounts.creditEvent ?? 0,
    agentsScored,
    ready: agents.ready,
  };

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<number | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<bigint | null>(null);
  const [highlightRefundId, setHighlightRefundId] = useState<bigint | null>(null);
  const [pov, setPov] = useState<Pov | null>({ lat: 28, lng: -40, altitude: 2.35 });
  const [layer, setLayer] = useState<"purchases" | "refunds" | "scores">("purchases");

  const selected = selectedId !== null ? agents.byId.get(selectedId) ?? null : null;
  const focusBiz = selectedBiz !== null ? businessRows.find((b) => b.id === selectedBiz) ?? null : null;

  const selectAgent = useCallback(
    (id: number | null) => {
      setSelectedId(id);
      if (id !== null) {
        const a = agents.byId.get(id);
        if (a) setPov({ lat: a.lat, lng: a.lng, altitude: 1.45 });
      }
    },
    [agents.byId],
  );

  const onEvent = useCallback(
    (e: FeedEvent) => {
      setSelectedSeq(e.seq);
      if (e.agentId) selectAgent(e.agentId);
      if (e.kind === "refund" || e.kind === "refund_accepted" || e.kind === "refund_declined") {
        setHighlightRefundId(e.refId);
      } else {
        setHighlightRefundId(null);
      }
    },
    [selectAgent],
  );

  const bizPoints: BusinessPoint[] = useMemo(
    () =>
      businessRows.map((b) => ({
        id: b.id,
        lat: b.lat,
        lng: b.lng,
        name: b.name,
        category: b.category,
        size: selectedBiz === b.id ? 14 : 7,
        dim: selectedBiz !== null && selectedBiz !== b.id,
      })),
    [businessRows, selectedBiz],
  );

  const liveArcs = useMemo(() => {
    const bmap = new Map(businessRows.map((b) => [b.id, { lat: b.lat, lng: b.lng, category: b.category }]));
    const all = arcsFromFeed(events, agents.byId, bmap, 160);
    if (layer === "refunds") return all.filter((a) => a.kind !== "purchase").slice(0, 120);
    if (layer === "purchases") return all.filter((a) => a.kind === "purchase").slice(0, 120);
    return all.filter((a) => a.kind !== "purchase").slice(0, 80);
  }, [events, agents.byId, businessRows, layer]);

  const liveRings = useMemo(() => {
    const r = ringsFromFeed(events, agents.byId);
    if (layer !== "scores") return r.slice(0, 40);
    return r;
  }, [events, agents.byId, layer]);

  const globeArcs = useStableById(liveArcs);
  const globeRings = useStableById(liveRings);

  const onGlobe = (lat: number, lng: number) => {
    // Merchant dots are small and moving; a click near one opens it rather than a shopper.
    let near: { id: number; d: number } | null = null;
    for (const b of businessRows) {
      const dLng = ((b.lng - lng + 540) % 360) - 180;
      const d = Math.hypot(b.lat - lat, dLng * Math.cos((lat * Math.PI) / 180));
      if (d < 2.5 && (!near || d < near.d)) near = { id: b.id, d };
    }
    if (near) return setSelectedBiz(near.id);
    const a = agents.nearest(lat, lng);
    if (a) selectAgent(a.id);
  };

  return (
    <main className={`sim-scene light ${focusBiz ? "is-merchant" : ""}`} data-testid="simulation" ref={trackRef}>
      <div className="sim-scene__sticky">
        <div className="sim-scene__atmosphere" aria-hidden />

        <div className="sim-scene__chrome" data-testid="sim-scale-band">
          <div className="sim-scene__intro">
            <p className="section__eyebrow" style={{ margin: 0 }}>Vouch at scale</p>
            <span className="sim-scene__stat"><b>{counts.agents.toLocaleString()}</b> shoppers</span>
            <span className="sim-scene__stat"><b>{counts.merchants}</b> merchants</span>
            <span className="sim-scene__stat"><b>{counts.purchases.toLocaleString()}</b> purchases</span>
            <span className="sim-scene__stat"><b>{counts.refundRequests.toLocaleString()}</b> refund requests</span>
            <span className="sim-scene__stat" data-testid="sim-day">{running ? <span className="sim-scene__live" /> : null}Day <b>{run?.day ?? "…"}</b>{running === false ? " · paused" : ""}</span>
            <Badge kind="simulated" />
            <p className="sim-scene__honesty">Simulated agents. Vouch does not track real locations.</p>
          </div>
          <div className="sim-scene__layers" aria-label="Event layer">
            {(
              [
                ["purchases", "Purchases"],
                ["refunds", "Refunds"],
                ["scores", "Scores"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLayer(id)}
                data-testid={`sim-layer-${id}`}
                className={`sim-scene__layer ${layer === id ? "is-active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="sim-scene__stage">
          <motion.div
            className="sim-scene__col sim-scene__col--left"
            style={{ width: leftWidth, opacity: leftOpacity, pointerEvents: leftPointer }}
          >
            <TrustPanel
              counts={counts}
              agent={selected}
              highlightRefundId={highlightRefundId}
              onClearAgent={() => selectAgent(null)}
            />
          </motion.div>

          <div className="sim-scene__globe">
            {focusBiz ? (
              <div className="sim-scene__merchant">
                <MerchantFlow business={focusBiz} day={run?.day ?? 0} agents={agents.byId} onClose={() => setSelectedBiz(null)} />
              </div>
            ) : null}
            <WorldGlobe
              byBand={agents.byBand}
              live={agents.live}
              dimmed={null}
              highlight={null}
              selected={selected}
              businesses={bizPoints}
              arcs={globeArcs}
              rings={globeRings}
              hexPoints={null}
              hexMax={1}
              pov={pov}
              autoRotate={!focusBiz}
              look="ice"
              onAgent={(id) => selectAgent(id)}
              onGlobe={onGlobe}
              onHex={() => undefined}
              onBusiness={(id) => setSelectedBiz(id)}
            />
          </div>

          <motion.div
            className="sim-scene__col sim-scene__col--right"
            style={{ width: rightWidth, opacity: rightOpacity, pointerEvents: rightPointer }}
          >
            <FlowPanel
              businesses={businessRows}
              selectedBusinessId={selectedBiz}
              onSelectBusiness={setSelectedBiz}
              running={running}
            />
          </motion.div>
        </div>

        <motion.div className="sim-scene__rail" style={{ height: railHeight, opacity: railOpacity }}>
          <EventRail
            events={events}
            selectedSeq={selectedSeq}
            chainAgentId={selectedId}
            onSelect={onEvent}
            running={running}
          />
        </motion.div>

        <motion.p className="sim-scene__cue" style={{ opacity: reduced ? 0 : cueOpacity }} aria-hidden>
          Scroll to open the economy
        </motion.p>

        {!agents.ready ? <ConnectingNote /> : null}
      </div>
    </main>
  );
}

function useProgressWidth(t: MotionValue<number>, pct: number, reduced: boolean) {
  return useTransform(t, (v) => `${(reduced ? 1 : v) * pct}%`);
}

function useProgressUnit(t: MotionValue<number>, reduced: boolean) {
  return useTransform(t, (v) => (reduced ? 1 : v));
}

function ConnectingNote() {
  const { status, error } = useStatus();
  return (
    <div className="sim-scene__connecting">
      {status === "error" ? <>Cannot reach SpacetimeDB: {error}</> : <>Subscribing to 10,000 agents…</>}
    </div>
  );
}
