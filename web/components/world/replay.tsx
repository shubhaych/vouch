"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Business, FraudPattern, PatternEvent } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { agentLabel, businessLabel, money, patternLabel, timeAgo, titleCase } from "@/lib/format";
import type { AgentPoint, Arc, Ring } from "./use-world";
import type { Pov } from "./globe";
import { STATUS_CHIP, STATUS_LABEL } from "./patterns-rail";

const CATEGORY_COLOR: Record<string, string> = {
  electronics: "#22d3ee", apparel: "#f472b6", home: "#fbbf24", beauty: "#c084fc", "sporting goods": "#4ade80", toys: "#fb923c",
};

export interface ReplayState {
  events: PatternEvent[];
  ready: boolean;
  start: number;
  end: number;
  playhead: number;
  setPlayhead: (d: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  arcs: Arc[];
  rings: Ring[];
  members: AgentPoint[];
  dimmed: AgentPoint[];
  businessIds: Set<number>;
  pov: Pov;
  detectionDay: number;
}

/** Everything in Replay is read from pattern_event and the rows it references: nothing is generated in the browser. */
export function useReplay(pattern: FraudPattern | null, agents: Map<number, AgentPoint>, businesses: Map<number, Business>): ReplayState | null {
  const pid = pattern?.id ?? 0;
  const [rows, ready] = useTable(tables.patternEvent.where((r) => r.patternId.eq(pid)), { enabled: !!pattern });
  const events = useMemo(() => [...rows].sort((a, b) => a.day - b.day || Number(a.id - b.id)), [rows]);
  const start = (pattern?.firstDay ?? 0) - 3;
  const end = (pattern?.lastDay ?? 0) + 1;
  const detectionDay = Math.max(pattern?.lastDay ?? 0, Math.min(end, pattern?.flaggedDay ?? end));
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    setPlayhead(start);
    setPlaying(true);
  }, [pid, start]);

  useEffect(() => {
    if (!playing || !pattern) return;
    let raf = 0;
    const tick = (t: number) => {
      const dt = last.current === null ? 0 : (t - last.current) / 1000;
      last.current = t;
      // 1x plays one simulated day every 1.2 s.
      setPlayhead((p) => {
        const n = p + (dt / 1.2) * speed;
        if (n >= end) { setPlaying(false); return end; }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, speed, end, pattern]);

  return useMemo(() => {
    if (!pattern) return null;
    const memberSet = new Set(pattern.agentIds);
    const members: AgentPoint[] = [];
    const dimmed: AgentPoint[] = [];
    for (const a of agents.values()) (memberSet.has(a.id) ? members : dimmed).push(a);
    const businessIds = new Set<number>(pattern.businessIds);
    for (const e of events) if (e.businessId) businessIds.add(e.businessId);

    const arcs: Arc[] = [];
    const rings: Ring[] = [];
    for (const e of events) {
      if (e.day > playhead) break;
      const a = agents.get(e.agentId);
      const b = businesses.get(e.businessId);
      if (!a) continue;
      const age = playhead - e.day;
      if (e.kind === "purchase" && b) {
        const c = CATEGORY_COLOR[b.category] ?? "#22d3ee";
        arcs.push({ id: `rp${e.id}`, startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng, color: [`${c}33`, c], dash: 0.5, stroke: 0.6, kind: "purchase" });
      } else if (e.kind === "delivery") {
        if (age < 1.5) rings.push({ id: `rd${e.id}`, lat: a.lat, lng: a.lng, color: "#22d3ee", max: 2.5, speed: 2 });
      } else if (e.kind === "refund" && b) {
        arcs.push({ id: `rr${e.id}`, startLat: b.lat, startLng: b.lng, endLat: a.lat, endLng: a.lng, color: ["#fbbf24", "#fbbf2433"], dash: 0.12, stroke: 0.7, kind: "refund" });
        if (age < 1.5) rings.push({ id: `rq${e.id}`, lat: a.lat, lng: a.lng, color: "#fbbf24", max: 3, speed: 2 });
      }
    }
    if (playhead >= detectionDay && playhead - detectionDay < 2) {
      for (const m of members) rings.push({ id: `det${m.id}`, lat: m.lat, lng: m.lng, color: "#f87171", max: 7, speed: 3.5 });
    }

    // Fit the camera to every involved agent and business (rings can span continents).
    const pts = [...members.map((m) => [m.lat, m.lng] as const), ...[...businessIds].map((id) => businesses.get(id)).filter(Boolean).map((b) => [b!.lat, b!.lng] as const)];
    let pov: Pov = { lat: 20, lng: 0, altitude: 2.4 };
    if (pts.length) {
      const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const x = pts.reduce((s, p) => s + Math.cos((p[1] * Math.PI) / 180), 0);
      const y = pts.reduce((s, p) => s + Math.sin((p[1] * Math.PI) / 180), 0);
      const lng = (Math.atan2(y, x) * 180) / Math.PI;
      const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - lat, ((((p[1] - lng + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180)))));
      pov = { lat, lng, altitude: Math.min(3.2, Math.max(1.2, spread / 32 + 0.9)) };
    }
    return {
      events, ready, start, end, playhead, setPlayhead, playing, setPlaying, speed, setSpeed, arcs, rings, members, dimmed, businessIds, pov, detectionDay,
    };
  }, [pattern, events, ready, playhead, playing, speed, agents, businesses, start, end, detectionDay]);
}

interface Features { [k: string]: number | string }

function featureSentence(kind: string, f: Features): string {
  const n = (k: string) => (f[k] !== undefined ? String(f[k]) : "?");
  if (kind === "coordinated") return `${n("agents")} agents, ${n("regions")} regions, ${n("businesses")} businesses, claims within ${n("claim_window_hours")} hours, text similarity ${n("text_similarity")}`;
  if (kind === "false_defect") return `${n("defect_claims")} "defective" claims in ${n("window_days")} days, median ${n("median_days_before_window_end")} days before the return window closed`;
  if (kind === "refund_frequency") return `refund ratio ${n("refund_ratio")} over ${n("purchases")} purchases, ${n("ratio_vs_region_median")}× the regional median`;
  return Object.entries(f).map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`).join(", ");
}

export function ReplayPanel({ pattern, replay, onAgent, onClose }: { pattern: FraudPattern; replay: ReplayState; onAgent: (id: number) => void; onClose: () => void }) {
  const [runs] = useTable(tables.agentRun.where((r) => r.caseRef.eq(patternLabel(pattern.id))));
  const [credits] = useTable(tables.creditEvent.where((r) => r.causeTable.eq("fraud_pattern")).where((r) => r.causeId.eq(BigInt(pattern.id))));
  const listRef = useRef<HTMLOListElement>(null);
  const features = useMemo(() => { try { return JSON.parse(pattern.features) as Features; } catch { return {}; } }, [pattern.features]);
  const roles = useMemo(() => { try { return JSON.parse(pattern.rolesJson || "[]") as { id: string; role: string; why?: string }[]; } catch { return []; } }, [pattern.rolesJson]);
  const run = [...runs].sort((a, b) => Number(b.startedAt.microsSinceUnixEpoch - a.startedAt.microsSinceUnixEpoch))[0];
  const current = replay.events.filter((e) => e.day <= replay.playhead).length - 1;

  useEffect(() => {
    if (!listRef.current || current < 0) return;
    const el = listRef.current.children[current] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); replay.setPlaying(!replay.playing); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay]);

  const pct = (d: number) => ((d - replay.start) / Math.max(1, replay.end - replay.start)) * 100;

  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.24 }} className="glass flex h-full min-h-0 flex-col" data-testid="replay-panel">
      <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="border-b border-line-dark px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="panel-title">Fraud Replay · {patternLabel(pattern.id)} · <Badge kind="simulated" /> events</div>
            <h2 className="mt-0.5 text-lg font-bold">Pattern: {titleCase(pattern.kind)}</h2>
          </div>
          <button className="btn btn--ghost-dark btn--xs" onClick={onClose} aria-label="Close replay">✕</button>
        </div>
      </motion.div>

      <div className="border-b border-line-dark px-4 py-3">
        <div className="relative h-8" data-testid="replay-scrubber">
          <input type="range" min={replay.start} max={replay.end} step={0.05} value={replay.playhead} aria-label="Replay day"
            onChange={(e) => { replay.setPlaying(false); replay.setPlayhead(Number(e.target.value)); }} className="absolute inset-x-0 top-3 z-10 w-full accent-cyan-400" />
          {Array.from({ length: replay.end - replay.start + 1 }, (_, i) => replay.start + i).map((d) => (
            <span key={d} className="absolute top-0 h-2 w-px bg-white/20" style={{ left: `${pct(d)}%` }} />
          ))}
          {replay.events.map((e) => (
            <span key={e.id.toString()} className={`absolute top-6 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${e.kind === "refund" ? "bg-review" : e.kind === "delivery" ? "bg-accent/60" : "bg-accent"}`} style={{ left: `${pct(e.day)}%` }} />
          ))}
          <span className="absolute top-5 h-3 w-0.5 bg-fraud" style={{ left: `${pct(replay.detectionDay)}%` }} title="Detection" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn--ghost-dark btn--xs" onClick={() => { if (replay.playhead >= replay.end) replay.setPlayhead(replay.start); replay.setPlaying(!replay.playing); }} data-testid="replay-play">{replay.playing ? "Pause" : "Play"}</button>
          <button className={`btn btn--xs ${replay.speed === 1 ? "btn--review" : "btn--ghost-dark"}`} onClick={() => replay.setSpeed(1)}>1x</button>
          <button className={`btn btn--xs ${replay.speed === 4 ? "btn--review" : "btn--ghost-dark"}`} onClick={() => replay.setSpeed(4)}>4x</button>
          <button className="btn btn--ghost-dark btn--xs" onClick={() => { replay.setPlaying(false); replay.setPlayhead(Math.min(replay.end, Math.floor(replay.playhead) + 1)); }}>+1 day</button>
          <span className="ml-auto font-mono text-xs">day {replay.playhead.toFixed(1)}</span>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-lenis-prevent>
        <div className="rounded-lg border border-review/40 bg-review/5 p-3 text-sm" data-testid="why-flagged">
          <div className="panel-title mb-1">Why it was flagged · {pattern.detectorId} v{pattern.detectorVersion}</div>
          <p>{featureSentence(pattern.kind, features)}.</p>
          <p className="mt-1 text-xs text-ink-soft-dark">Region and business were not used as evidence.</p>
        </div>

        <div className="rounded-lg border border-line-dark p-3 text-sm" data-testid="review-state">
          <div className="flex items-center justify-between">
            <span className="panel-title">CREAO Pattern Analyst</span>
            <span className={`chip ${STATUS_CHIP[pattern.status] ?? ""}`}>{STATUS_LABEL[pattern.status] ?? pattern.status}{run?.status === "running" ? ` · ${timeAgo(Number(run.startedAt.microsSinceUnixEpoch / 1000n))}` : ""}</span>
          </div>
          {pattern.narrative ? <p className="mt-2 text-xs leading-relaxed">{pattern.narrative}</p> : <p className="mt-2 text-xs text-ink-soft-dark">{pattern.status === "detected" ? "Queued for the Pattern Analyst. Only a confirmed pattern changes anyone's credit." : pattern.status === "awaiting_review" ? "Over this run's review budget (12): waiting for a person to request a review." : "Review in progress."}</p>}
          {run ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge kind={run.mode === "fixture" ? "fixture" : "live"} />
              {run.runUrl ? <a className="text-accent underline" href={run.runUrl} target="_blank" rel="noreferrer">Open run</a> : <span className="text-ink-soft-dark">run {run.runId.slice(0, 12)}</span>}
            </div>
          ) : null}
        </div>

        {pattern.status === "confirmed" || pattern.status === "simulated_confirmed" ? (
          <div className="rounded-lg border border-fraud/40 bg-fraud/5 p-3" data-testid="apply-to-credit">
            <div className="panel-title mb-2">Applied to credit · −120 per core agent <Badge kind="live" /></div>
            <ul className="space-y-1 text-sm">
              {credits.map((c, i) => (
                <motion.li key={c.id.toString()} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex justify-between font-mono">
                  <button className="hover:text-accent" onClick={() => onAgent(c.agentId)}>{agentLabel(c.agentId)}</button>
                  <span className="text-fraud"><Tween value={c.after} duration={1.4} /> <span className="text-ink-soft-dark">from {c.before}</span></span>
                </motion.li>
              ))}
              {credits.length === 0 ? <li className="text-xs text-ink-soft-dark">No core agents named, so nobody was penalised.</li> : null}
            </ul>
          </div>
        ) : null}

        <div>
          <div className="panel-title mb-1">Agents</div>
          <div className="flex flex-wrap gap-1">
            {pattern.agentIds.map((id) => {
              const role = roles.find((r) => r.id === agentLabel(id))?.role;
              return <button key={id} className={`chip ${role === "core" ? "chip--fraud" : role === "not_involved" ? "chip--honest" : ""}`} onClick={() => onAgent(id)}>{agentLabel(id)}{role ? ` · ${role.replace("_", " ")}` : ""}</button>;
            })}
          </div>
        </div>

        <div>
          <div className="panel-title mb-1">Events <Badge kind="simulated" /></div>
          <ol ref={listRef} className="space-y-0.5 font-mono text-[0.7rem]" data-testid="replay-events">
            {replay.events.map((e, i) => (
              <li key={e.id.toString()}>
                <button onClick={() => { replay.setPlaying(false); replay.setPlayhead(e.day); }}
                  className={`w-full rounded px-1.5 py-1 text-left transition ${i === current ? "bg-accent/15 text-ink-dark" : e.day <= replay.playhead ? "text-ink-dark" : "text-ink-soft-dark"}`}>
                  <div className="flex justify-between gap-2">
                    <span>d{e.day} {e.kind} {agentLabel(e.agentId)}{e.businessId ? ` → ${businessLabel(e.businessId)}` : ""}</span>
                    <span>{e.amount ? money(e.amount) : ""}</span>
                  </div>
                  {e.kind === "refund" && e.text ? <div className="truncate font-sans italic opacity-80">“{e.text}”</div> : null}
                  <div className="truncate font-sans opacity-60">{e.why}</div>
                </button>
              </li>
            ))}
            {replay.ready && replay.events.length === 0 ? <li className="text-ink-soft-dark">This pattern has no recorded events.</li> : null}
          </ol>
        </div>
      </div>
    </motion.aside>
  );
}
