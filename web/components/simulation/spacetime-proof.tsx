"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { useConn } from "@/lib/stdb/hooks";
import { useLatency } from "@/lib/stdb/latency";
import { Badge } from "@/components/ui/badge";

const TABLES = ["agent", "purchase", "refund", "creditEvent", "eventFeed", "merchantFlowDay", "business"] as const;

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
    const id = setInterval(() => { const n = count.current; count.current = 0; setSeries((s) => [...s.slice(-39), n]); }, 1000);
    return () => { clearInterval(id); for (const t of TABLES) { db[t]?.removeOnInsert(bump); db[t]?.removeOnUpdate(bump); } };
  }, [conn]);
  return series;
}

/** Ticks as they commit: each metrics update is one finished tick transaction inside the database. */
function useTicks() {
  const [m] = useTable(tables.metrics);
  const row = m[0];
  const [ticks, setTicks] = useState<{ key: string; steps: number; events: number; at: number }[]>([]);
  const last = useRef<bigint | null>(null);
  useEffect(() => {
    if (!row || row.ticksObserved === last.current) return;
    last.current = row.ticksObserved;
    const t = { key: row.ticksObserved.toString(), steps: row.stepsLastTick, events: row.eventsLastTick, at: Date.now() };
    setTicks((xs) => [...xs.slice(-11), t]);
  }, [row]);
  return { ticks, row };
}

/**
 * The middle section's case for SpacetimeDB, shown rather than told. One feature carries it: every
 * simulation tick is ONE database transaction (agents stepped, purchases, refunds, score changes, feed),
 * run by a scheduled reducer inside the database, and its rows reach this browser directly. Numbers
 * here are measured live in this tab; the comparison stack is an illustration, labelled as one.
 */
export function SpacetimeProof({ onClose }: { onClose: () => void }) {
  const reduced = !!useReducedMotion();
  const rate = useRowRate();
  const { ticks, row } = useTicks();
  const latency = useLatency();
  const now = rate.at(-1) ?? 0;
  const peak = Math.max(1, ...rate);
  const avg = rate.length ? Math.round(rate.reduce((a, b) => a + b, 0) / rate.length) : 0;
  const lastTick = ticks.at(-1);

  return (
    <section className="stdb-proof" data-testid="stdb-proof" aria-label="Why SpacetimeDB">
      <header className="stdb-proof__head">
        <div>
          <p className="sim-panel__eyebrow">Why SpacetimeDB</p>
          <h2 className="stdb-proof__title">The economy runs <em>inside</em> the database. One tick = one transaction, pushed straight to you.</h2>
        </div>
        <button type="button" className="merchant-flow__x" onClick={onClose} aria-label="Hide" data-testid="stdb-proof-close">✕</button>
      </header>

      <div className="stdb-proof__grid">
        <div className="stdb-proof__live">
          <div className="stdb-proof__ticks" aria-label="Tick transactions as they commit">
            <span className="stdb-proof__lane-label">tick transactions <Badge kind="live" /></span>
            <div className="stdb-proof__track">
              {ticks.map((t, i) => (
                <motion.div
                  key={t.key}
                  className="stdb-proof__tick"
                  initial={reduced ? false : { x: -40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 - (ticks.length - 1 - i) * 0.07 }}
                  transition={{ duration: 0.35 }}
                  title={`Tick ${t.key}: ${t.steps} agents stepped, ${t.events} events, all-or-nothing`}
                >
                  <b>{t.steps.toLocaleString()}</b>
                  <span>agents · {t.events} ev</span>
                </motion.div>
              ))}
              {ticks.length === 0 ? <span className="stdb-proof__wait">waiting for the next tick…</span> : null}
              <span className="stdb-proof__you">→ your browser</span>
            </div>
          </div>

          <div className="stdb-proof__stats">
            <Stat label="rows into this tab / s" value={now.toLocaleString()} sub={`avg ${avg.toLocaleString()} · peak ${peak.toLocaleString()}`} />
            <Stat label="round trip to the database" value={latency.p50 === null ? "…" : `${Math.round(latency.p50)} ms`} sub={latency.p95 === null ? "measuring" : `p95 ${Math.round(latency.p95)} ms · your clock`} />
            <Stat label="last tick" value={lastTick ? `${lastTick.steps.toLocaleString()} agents` : "…"} sub={row ? `${row.eventsLastTick} events in 1 transaction` : ""} />
          </div>

          <svg viewBox="0 0 200 34" className="stdb-proof__spark" preserveAspectRatio="none" aria-label="Rows received per second, last 40 s">
            <path d={rate.map((v, i) => `${i ? "L" : "M"}${(i / 39) * 200},${32 - (v / peak) * 30}`).join(" ")} fill="none" stroke="#2f9e7a" strokeWidth={1.6} />
          </svg>
        </div>

        <div className="stdb-proof__compare">
          <div className="stdb-proof__stack is-other">
            <span className="stdb-proof__lane-label">usual stack <Badge kind="fixture" /></span>
            <div className="stdb-proof__hops">
              {["sim worker", "API", "Postgres", "pub/sub", "socket server", "browser"].map((h, i, a) => (
                <span key={h} className="stdb-proof__hop">{h}{i < a.length - 1 ? <i>→</i> : null}</span>
              ))}
            </div>
            <p>5 services, 4 network hops. A refund and its score change travel as separate messages and can land out of order.</p>
          </div>
          <div className="stdb-proof__stack is-us">
            <span className="stdb-proof__lane-label">Vouch on SpacetimeDB <Badge kind="live" /></span>
            <div className="stdb-proof__hops">
              <span className="stdb-proof__hop is-db">scheduled reducer inside the DB<i>→</i></span>
              <span className="stdb-proof__hop">browser</span>
            </div>
            <p>1 service, 1 hop. The refund, the score change, the merchant&apos;s day total and the globe event commit together or not at all.</p>
          </div>
          <p className="stdb-proof__foot">Comparison stack is an illustration. Tick, row and latency numbers are measured in this tab now.</p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stdb-proof__stat">
      <div className="stdb-proof__stat-v">{value}</div>
      <div className="stdb-proof__stat-l">{label}</div>
      <div className="stdb-proof__stat-s">{sub}</div>
    </div>
  );
}
