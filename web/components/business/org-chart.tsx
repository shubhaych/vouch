"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { AgentRun } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { useCall } from "@/lib/stdb/hooks";

const SEATS = [
  { seat: "evidence_analyst", name: "Evidence Analyst", job: "Describes the video frames: item match, defect, challenge, capture flags", standalone: false },
  { seat: "listing_matcher", name: "Listing Matcher", job: "Matches the frames to listings Bright Data scraped and checks the return against the policy", standalone: false },
  { seat: "policy_checker", name: "Policy Checker", job: "Reads the store policy rule by rule: window, reason, video, category note, fee, item identity", standalone: false },
  { seat: "risk_scorecard", name: "Risk Scorecard", job: "Reads history, credential, patterns, identity and item context as supports, neutral or caution", standalone: false },
  { seat: "refund_investigator", name: "Refund Investigator", job: "Recommends accept, decline or more evidence, citing every reason", standalone: false },
  { seat: "pattern_analyst", name: "Pattern Analyst", job: "Confirms or dismisses detector flags; only a confirmation changes credit", standalone: true },
  { seat: "returns_monitor", name: "Returns Monitor", job: "Reads the returns pulse and scraped web signals; notes spikes, never names a shopper", standalone: true },
] as const;

const ms = (t?: { microsSinceUnixEpoch: bigint }) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : 0);

function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), every); return () => clearInterval(id); }, [every]);
  return now;
}

/** The saved CREAO agents as an org chart, with the Desk Lead (worker code) routing between them, and the kill switch. */
export function OrgChart({ canToggle }: { canToggle: boolean }) {
  const [runs] = useTable(tables.agentRun);
  const [controls] = useTable(tables.control);
  const call = useCall();
  const now = useNow();
  const on = controls.find((c) => c.key === "creao_enabled")?.value === "true";
  const last = (seat: string): AgentRun | undefined => [...runs].filter((r) => r.seat === seat).sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0];
  const recentHandOff = (seat: string) => { const r = last(seat); return !!r?.finishedAt && now - ms(r.finishedAt) < 12_000; };

  return (
    <section className="glass p-4" data-testid="org-chart">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="panel-title">CREAO agent org chart</div>
          <p className="text-xs text-ink-soft-dark">Remove the agents and no claim is investigated and no fraud pattern is confirmed.</p>
        </div>
        <button
          role="switch" aria-checked={on} disabled={!canToggle} data-testid="kill-switch"
          onClick={() => void call("setControl", (r) => r.setControl({ key: "creao_enabled", value: on ? "false" : "true" }), on ? "CREAO agents switched OFF: new claims get “Investigator offline”" : "CREAO agents switched ON")}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-honest/60 bg-honest/10 text-honest" : "border-fraud/60 bg-fraud/10 text-fraud"}`}
          title={canToggle ? "Kill switch" : "Take the business seat to use the kill switch"}>
          <span className={`relative h-5 w-9 rounded-full ${on ? "bg-honest/70" : "bg-fraud/60"}`}>
            <motion.span layout className="absolute top-0.5 h-4 w-4 rounded-full bg-white" style={{ left: on ? 18 : 2 }} />
          </span>
          CREAO agents: {on ? "ON" : "OFF"}
        </button>
      </div>
      <div className="relative flex flex-wrap items-stretch gap-3">
        <DeskLead />
        {SEATS.map((s, i) => {
          const r = last(s.seat);
          const running = r?.status === "running";
          const steps = (() => { try { return JSON.parse(r?.stepsJson || "[]") as { step: string }[]; } catch { return []; } })();
          return (
            <div key={s.seat} className="contents">
              {i > 0 ? <HandOff active={recentHandOff(SEATS[i - 1]!.seat) && !s.standalone} dashed={s.standalone} /> : null}
              <motion.div
                className={`min-w-[13rem] flex-1 basis-[14rem] rounded-xl border p-3 ${running ? "border-accent/70 bg-accent/5" : "border-line-dark bg-white/[0.02]"} ${!on ? "opacity-50" : ""}`}
                animate={running ? { boxShadow: ["0 0 0 0 rgba(34,211,238,0)", "0 0 0 6px rgba(34,211,238,0.18)", "0 0 0 0 rgba(34,211,238,0)"] } : {}}
                transition={{ repeat: running ? Infinity : 0, duration: 1.6 }} data-testid={`seat-${s.seat}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{s.name}</span>
                  {r ? <Badge kind={r.mode === "fixture" ? "fixture" : "live"} /> : null}
                </div>
                <p className="mt-0.5 text-[0.7rem] leading-snug text-ink-soft-dark">{s.job}</p>
                <div className="mt-2 text-xs">
                  {!on ? <span className="text-fraud">Offline (kill switch)</span> : r ? (
                    <>
                      <span className={running ? "text-accent" : r.status === "completed" ? "text-honest" : "text-fraud"}>{running ? "Running" : r.status}</span>
                      <span className="text-ink-soft-dark"> · {r.caseRef} · {Math.round(((r.finishedAt ? ms(r.finishedAt) : now) - ms(r.startedAt)) / 1000)} s</span>
                    </>
                  ) : <span className="text-ink-soft-dark">No runs yet</span>}
                </div>
                {steps.length ? (
                  <ol className="mt-1 space-y-0.5 text-[0.68rem] text-ink-soft-dark">
                    {steps.slice(-3).map((st, k) => <li key={k}>· {st.step}</li>)}
                  </ol>
                ) : null}
                {r ? (
                  <div className="mt-2 text-[0.7rem]">
                    {r.runUrl ? <a className="text-accent underline" href={r.runUrl} target="_blank" rel="noreferrer">Open run</a> : <span className="font-mono text-ink-soft-dark" title="CREAO's run share link is copied from its interface into the README">run {r.runId.slice(0, 18)}</span>}
                  </div>
                ) : null}
              </motion.div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeskLead() {
  return (
    <div className="-mb-1 flex w-full items-center gap-2 text-[0.7rem] text-ink-soft-dark">
      <span className="rounded border border-line-dark px-1.5 py-0.5 font-mono">Desk Lead</span>
      worker code, not an agent: routes each claim Evidence Analyst → Listing Matcher → Policy Checker → Risk Scorecard → Refund Investigator → a person, each flagged pattern to the Pattern Analyst, and each returns-pulse window to the Returns Monitor.
    </div>
  );
}

function HandOff({ active, dashed }: { active: boolean; dashed?: boolean }) {
  return (
    <div className="hidden items-center md:flex" aria-hidden>
      <svg width="44" height="20">
        <line x1="2" y1="10" x2="38" y2="10" stroke={active ? "#22d3ee" : "rgba(148,163,184,0.4)"} strokeWidth="2" strokeDasharray={dashed ? "3 4" : active ? "6 4" : undefined}>
          {active ? <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.6s" repeatCount="indefinite" /> : null}
        </line>
        <path d="M36,5 L43,10 L36,15 z" fill={active ? "#22d3ee" : "rgba(148,163,184,0.4)"} />
      </svg>
    </div>
  );
}
