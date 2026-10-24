"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Stat, Tween } from "@/components/ui/num";
import { int } from "@/lib/format";

/** Live counters under the hero buttons: they tick up as the economy runs. */
export function HeroCounters() {
  const [metrics] = useTable(tables.metrics);
  const [claims] = useTable(tables.claim);
  const [patterns] = useTable(tables.fraudPattern);
  const counts = (() => { try { return JSON.parse(metrics[0]?.rowCounts || "{}") as Record<string, number>; } catch { return {}; } })();
  const ready = !!metrics[0];
  return (
    <div className="hero__proof" data-testid="hero-counters">
      <Stat label="Agents" value={ready ? counts.agent ?? 0 : null} prov="live" />
      <Stat label="Purchases" value={ready ? counts.purchase ?? 0 : null} prov="live" />
      <Stat label="Investigated" value={ready ? claims.length : null} prov="live" />
      <Stat label="Fraud confirmed" value={ready ? patterns.filter((p) => p.status === "confirmed").length : null} prov="live" />
    </div>
  );
}

const reveal = { initial: { opacity: 0, y: 28 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-12%" }, transition: { duration: 0.85, ease: [0.25, 0.46, 0.45, 0.94] as const } };

export function Experiences() {
  const items = [
    { kicker: "01 · Shopper", title: "Consumer app", body: "Buy, fast-forward to the refund window, record a video claim on your phone with a finger challenge, and watch the decision and your score change.", href: "/shop", preview: <PhonePreview /> },
    { kicker: "02 · Business", title: "Business dashboard", body: "Video, frames with the Evidence Analyst's boxes, the shopper's history, a cited recommendation, the credential check, and your decision.", href: "/business", preview: <OrgPreview /> },
    { kicker: "03 · Flagship", title: "Vouch World", body: "Ten thousand simulated agents shopping inside SpacetimeDB on a 3D globe, with Fraud Replay, the Observatory and a live event monitor.", href: "/world", preview: <GlobePreview /> },
  ];
  return (
    <motion.section {...reveal} className="section section--compact">
      <p className="section__eyebrow">Three experiences, one database</p>
      <h2 className="section__title">Every screen reads the same SpacetimeDB tables.</h2>
      <div className="features">
        {items.map((f) => (
          <Link key={f.title} href={f.href} className="feature--telemetry block" data-testid={`experience-${f.href.slice(1)}`}>
            <div className="mb-4 h-28 overflow-hidden rounded-lg bg-bg-dark">{f.preview}</div>
            <span className="feature__kicker">{f.kicker}</span>
            <h3 className="feature__title">{f.title}</h3>
            <p className="feature__body">{f.body}</p>
          </Link>
        ))}
      </div>
    </motion.section>
  );
}

function PhonePreview() {
  return (
    <div className="flex h-full items-center justify-center gap-3">
      {["Uploaded", "Frames", "Evidence", "Decision"].map((s, i) => (
        <motion.div key={s} className="flex flex-col items-center gap-1" animate={{ opacity: [0.3, 1, 1, 0.3] }} transition={{ duration: 6, repeat: Infinity, delay: i * 1.2 }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-honest text-xs font-bold text-black">✓</span>
          <span className="text-[0.6rem] text-ink-soft-dark">{s}</span>
        </motion.div>
      ))}
    </div>
  );
}

function OrgPreview() {
  return (
    <svg viewBox="0 0 300 110" className="h-full w-full">
      {["Evidence", "Investigator", "Pattern"].map((n, i) => (
        <g key={n}>
          <rect x={14 + i * 98} y={34} width={78} height={40} rx={8} fill="rgba(15,22,40,0.9)" stroke="#a78bfa" strokeOpacity={0.6} />
          <text x={53 + i * 98} y={58} textAnchor="middle" fill="#e8edf2" fontSize={11}>{n}</text>
        </g>
      ))}
      {[0, 1].map((i) => (
        <line key={i} x1={94 + i * 98} y1={54} x2={110 + i * 98} y2={54} stroke="#22d3ee" strokeWidth={2} strokeDasharray="4 3">
          <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.8s" repeatCount="indefinite" />
        </line>
      ))}
    </svg>
  );
}

function GlobePreview() {
  const arcs = [[60, 70, 150, 40], [150, 40, 230, 66], [90, 50, 200, 80], [120, 80, 250, 50]];
  return (
    <svg viewBox="0 0 300 110" className="h-full w-full">
      <circle cx={150} cy={140} r={120} fill="#0a1224" stroke="#22d3ee" strokeOpacity={0.4} />
      {Array.from({ length: 40 }, (_, i) => <circle key={i} cx={40 + ((i * 53) % 220)} cy={40 + ((i * 31) % 60)} r={1.4} fill="#8FB3D9" />)}
      {arcs.map(([x1, y1, x2, y2], i) => (
        <path key={i} d={`M${x1},${y1} Q${(x1! + x2!) / 2},${Math.min(y1!, y2!) - 30} ${x2},${y2}`} fill="none" stroke={i % 2 ? "#fbbf24" : "#22d3ee"} strokeWidth={1.4} strokeDasharray="6 6">
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur={`${1 + i * 0.3}s`} repeatCount="indefinite" />
        </path>
      ))}
    </svg>
  );
}

export function HowItWorks() {
  const steps = [
    ["Purchase", "SpacetimeDB"], ["Refund video", "Worker"], ["Evidence Analyst", "CREAO"], ["Refund Investigator", "CREAO"],
    ["Business decision", "SpacetimeDB"], ["Credit update", "SpacetimeDB"], ["Globe", "SpacetimeDB"],
  ];
  return (
    <motion.section {...reveal} className="section section--compact">
      <p className="section__eyebrow">How it works</p>
      <h2 className="section__title">One loop, from a purchase to the globe.</h2>
      <ol className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-7" data-testid="pipeline">
        {steps.map(([s, tag], i) => (
          <motion.li key={s} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12, duration: 0.4 }}
            className="relative rounded-xl border border-line bg-surface p-3">
            <div className="font-mono text-[0.62rem] text-ink-soft">{String(i + 1).padStart(2, "0")}</div>
            <div className="mt-1 text-sm font-semibold">{s}</div>
            <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[0.62rem] font-bold ${tag === "CREAO" ? "bg-violet-100 text-violet-700" : tag === "Worker" ? "bg-amber-100 text-amber-800" : "bg-cyan-100 text-cyan-800"}`}>{tag}</span>
            {i < steps.length - 1 ? <span className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-ink-soft md:block">→</span> : null}
          </motion.li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-ink-soft">Factory Droid sits beside the loop: when a detector misses or flags the wrong people, it writes and tests a better detector on a fresh simulated world, and a person promotes it.</p>
    </motion.section>
  );
}

export function BuiltOn() {
  const [runs] = useTable(tables.agentRun);
  const [metrics] = useTable(tables.metrics);
  const [labEvents] = useTable(tables.labJob);
  const m = metrics[0];
  const cards = [
    { kicker: "CREAO", title: "Three agents do the investigating", body: "Remove them and nothing gets decided: claims wait as “investigator offline”, and no fraud pattern can be confirmed.", value: runs.length, label: "agent runs recorded", prov: runs.some((r) => r.mode === "live") ? "live" as const : "fixture" as const },
    { kicker: "SpacetimeDB", title: "The whole economy lives in the database", body: "10,000 agents stepping inside a scheduled reducer; every screen is a live subscription.", value: m ? Number(m.eventsTotal) : null, label: "economic events written", prov: "live" as const },
    { kicker: "Factory", title: "Droid improves the detectors", body: "Fenced to one folder and two commands; every plan, tool call, diff and score is a row on /lab.", value: labEvents.length, label: "lab jobs queued", prov: "live" as const },
  ];
  return (
    <motion.section {...reveal} className="section section--compact">
      <p className="section__eyebrow">Built on</p>
      <h2 className="section__title">Each sponsor is load-bearing.</h2>
      <div className="features">
        {cards.map((c) => (
          <article key={c.kicker} className="feature--telemetry" data-testid={`built-on-${c.kicker.toLowerCase()}`}>
            <span className="feature__kicker">{c.kicker}</span>
            <h3 className="feature__title">{c.title}</h3>
            <p className="feature__body">{c.body}</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-2xl font-bold">{c.value === null ? "…" : <Tween value={c.value} />}</span>
              <span className="text-xs text-ink-soft">{c.label}</span>
              <Badge kind={c.prov} />
            </div>
          </article>
        ))}
      </div>
    </motion.section>
  );
}

export function ClosingCta() {
  return (
    <motion.section {...reveal} className="section text-center">
      <h2 className="section__title mx-auto">CREAO decides, SpacetimeDB remembers, Droid improves.</h2>
      <p className="mx-auto mt-3 max-w-xl text-ink-soft">Every dot, score and cluster traces back to a row a judge can inspect.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/world" className="btn btn--primary">Enter Vouch World</Link>
        <Link href="/system" className="btn btn--ghost">See the numbers</Link>
      </div>
      <p className="mt-6 text-xs text-ink-soft">{int(10000)} simulated agents · 60 simulated businesses · 40 simulated regions</p>
    </motion.section>
  );
}
