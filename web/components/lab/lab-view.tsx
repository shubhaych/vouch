"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Bot, Clock, Hand, Zap } from "lucide-react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { LabEvent, LabJob } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { titleCase } from "@/lib/format";

// Mirrors PRESET_GOALS in module/src/lab.ts (the reducer only accepts an index).
const PRESETS = [
  "Reduce honest agents flagged by the coordinated-claims detector without losing recall.",
  "Raise recall of the false-defect detector on opportunist agents without flagging more honest agents.",
  "Make the refund-frequency detector robust to agents with few purchases.",
  "Make the coordinated-claims detector catch rings that spread claims over three days.",
  "Explain the false-defect detector features more clearly for the Pattern Analyst.",
];

const TRIGGER_ICON: Record<string, React.ReactNode> = {
  event: <Zap size={14} aria-label="event trigger" />, schedule: <Clock size={14} aria-label="schedule trigger" />,
  user: <Hand size={14} aria-label="user trigger" />, agent: <Bot size={14} aria-label="agent trigger" />,
};
const STATUS_CHIP: Record<string, string> = {
  queued: "chip", running: "chip chip--accent", succeeded: "chip chip--honest", failed: "chip chip--fraud", promote_requested: "chip chip--review",
  promoted: "chip chip--credential", rejected: "chip", cancelled: "chip",
};

export function LabView() {
  return <Suspense fallback={<main className="app-dark min-h-screen" />}><LabInner /></Suspense>;
}

function LabInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [jobs] = useTable(tables.labJob);
  const [roles] = useTable(tables.role);
  const { identity } = useStatus();
  const call = useCall();
  const sorted = useMemo(() => [...jobs].sort((a, b) => b.id - a.id), [jobs]);
  const selected = sorted.find((j) => String(j.id) === params.get("job")) ?? sorted.find((j) => j.status !== "failed") ?? sorted[0];
  const isController = roles.some((r) => r.role === "controller" && r.who.toHexString() === identity);

  return (
    <main className="app-dark mx-auto max-w-[1600px] space-y-4 px-3 py-4 text-ink-dark sm:px-5" data-testid="lab">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section__eyebrow">Factory Droid Detector Lab</p>
          <h1 className="section__title">Droid writes and tests better fraud detectors</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft-dark">
            Each job runs a Droid SDK session in a throwaway copy of <span className="font-mono">detectors/</span>. It may write only <span className="font-mono">candidates/&lt;job&gt;/</span> and run two commands (the tests and the fixed evaluator); everything else is cancelled. The evaluator grows a fresh simulated world Droid has never seen. A person promotes.
          </p>
        </div>
        <AskDroid onAsk={(i) => void call("enqueueLab", (r) => r.enqueueLab({ preset: i }), "Queued a Droid job (user trigger)")} />
      </header>
      <div className="grid gap-4 xl:grid-cols-[18rem_1fr_22rem]">
        <aside className="glass flex max-h-[78vh] flex-col" data-testid="lab-queue">
          <div className="flex items-center justify-between border-b border-line-dark px-3 py-2">
            <span className="panel-title">Jobs</span>
            <span className="text-xs text-ink-soft-dark">{jobs.length} <Badge kind="live" /></span>
          </div>
          <ol className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {sorted.length === 0 ? <li className="p-2 text-xs text-ink-soft-dark">No jobs yet. Triggers: a business override or a dismissed pattern (event), every 30 simulated days (schedule), Ask Droid (user), two undecided reviews (another agent).</li> : null}
            {sorted.map((j) => (
              <li key={j.id}>
                <button onClick={() => router.replace(`/lab?job=${j.id}`, { scroll: false })} data-testid={`job-${j.id}`}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left ${selected?.id === j.id ? "border-accent/70 bg-accent/5" : "border-line-dark hover:border-accent/40"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-sm font-bold">{TRIGGER_ICON[j.trigger]} Job {j.id}</span>
                    <span className={STATUS_CHIP[j.status] ?? "chip"}>{titleCase(j.status)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-ink-soft-dark">{j.trigger} · {j.detectorId} · {j.goal}</div>
                </button>
              </li>
            ))}
          </ol>
        </aside>
        {selected ? <JobDetail job={selected} isController={isController} onReview={(promote) => void call("reviewCandidate", (r) => r.reviewCandidate({ jobId: selected.id, promote }), promote ? "Promotion requested: the worker copies it into detectors/live" : "Candidate rejected")} /> : <div className="glass p-6 text-sm text-ink-soft-dark xl:col-span-2">No job selected.</div>}
      </div>
    </main>
  );
}

function AskDroid({ onAsk }: { onAsk: (i: number) => void }) {
  return (
    <details className="glass relative p-2" data-testid="ask-droid">
      <summary className="btn btn--glow btn--sm list-none">Ask Droid</summary>
      <ol className="absolute right-0 z-20 mt-2 w-[26rem] space-y-1 rounded-xl border border-line-dark bg-bg-dark-elevated p-2 shadow-xl">
        {PRESETS.map((p, i) => (
          <li key={i}><button className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5" onClick={() => onAsk(i)} data-testid={`preset-${i}`}>{p}</button></li>
        ))}
        <li className="px-2 pt-1 text-[0.65rem] text-ink-soft-dark">Five preset goals only (no free text): cheap and safe. At most 6 jobs per simulation run.</li>
      </ol>
    </details>
  );
}

interface Score { detector: string; version: number; flagged: number; precision: number; recall: Record<string, number>; targetKind: string; targetRecall: number; honestFlagged: number; honestTotal: number; runMs: number }

function JobDetail({ job, isController, onReview }: { job: LabJob; isController: boolean; onReview: (promote: boolean) => void }) {
  const [rows] = useTable(tables.labEvent.where((r) => r.jobId.eq(job.id)));
  const events = useMemo(() => [...rows].sort((a, b) => Number(a.id - b.id)), [rows]);
  const plan = events.find((e) => e.kind === "plan");
  const bullets = (plan?.text ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const afterPlan = plan ? events.filter((e) => e.id > plan.id && e.kind === "tool_result").length : 0;
  const diff = events.filter((e) => e.kind === "diff").pop();
  const metrics = events.filter((e) => e.kind === "metrics").pop();
  const scores = useMemo(() => { try { return (JSON.parse(metrics?.json || job.scoresJson || "{}") as { scores?: Score[] }).scores ?? []; } catch { return []; } }, [metrics, job.scoresJson]);
  const [live, cand] = scores.length === 2 ? scores : [undefined, scores[0]];

  return (
    <>
      <section className="space-y-4">
        <div className="glass p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><span className="font-mono font-bold">Job {job.id}</span><span className={STATUS_CHIP[job.status] ?? "chip"}>{titleCase(job.status)}</span><Badge kind={job.mode === "replay" ? "replay" : "live"} /></div>
            <span className="text-xs text-ink-soft-dark">{job.trigger} trigger · {job.detectorId}</span>
          </div>
          <p className="mt-2 text-sm">{job.goal}</p>
          {job.summary ? <p className="mt-2 rounded-lg border border-line-dark bg-white/[0.03] p-2 text-sm" data-testid="job-summary">{job.summary}</p> : null}
        </div>

        <div className="glass p-4" data-testid="lab-plan">
          <div className="panel-title mb-2">Plan</div>
          {bullets.length ? (
            <ol className="space-y-1 text-sm">
              {bullets.map((b, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-start gap-2">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.6rem] ${i < afterPlan ? "bg-honest text-black" : "border border-line-dark"}`}>{i < afterPlan ? "✓" : ""}</span>{b}
                </motion.li>
              ))}
            </ol>
          ) : <p className="text-sm text-ink-soft-dark">{job.status === "queued" ? "Waiting in the queue." : "No plan streamed for this job."}</p>}
        </div>

        <div className="glass p-4" data-testid="lab-steps">
          <div className="panel-title mb-2">Every step Droid took <Badge kind={job.mode === "replay" ? "replay" : "live"} /></div>
          <ol className="space-y-1 font-mono text-[0.72rem]">
            {events.filter((e) => e.kind !== "plan" && e.kind !== "diff").map((e, i, xs) => <StepRow key={e.id.toString()} e={e} prev={xs[i - 1]} />)}
            {events.length === 0 ? <li className="font-sans text-ink-soft-dark">No events yet.</li> : null}
          </ol>
        </div>

        {diff ? <DiffView text={(() => { try { return (JSON.parse(diff.json) as { diff: string }).diff; } catch { return ""; } })()} title={diff.text} /> : null}
      </section>

      <aside className="space-y-4">
        <div className="glass p-4" data-testid="scorecard">
          <div className="panel-title mb-2">Scorecard on a fresh world</div>
          {cand ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-soft-dark"><tr><th /><th>Live v{live?.version ?? "-"}</th><th>Candidate v{cand.version}</th></tr></thead>
              <tbody className="font-mono">
                <ScoreRow label={`Recall (${cand.targetKind})`} a={live?.targetRecall} b={cand.targetRecall} pct higherIsBetter />
                <ScoreRow label="Recall ring" a={live?.recall.ring} b={cand.recall.ring} pct higherIsBetter />
                <ScoreRow label="Recall opportunist" a={live?.recall.opportunist} b={cand.recall.opportunist} pct higherIsBetter />
                <ScoreRow label="Recall serial" a={live?.recall.serial} b={cand.recall.serial} pct higherIsBetter />
                <ScoreRow label="Precision" a={live?.precision} b={cand.precision} pct higherIsBetter />
                <ScoreRow label="Honest agents flagged" a={live?.honestFlagged} b={cand.honestFlagged} />
                <ScoreRow label="Run time (ms)" a={live?.runMs} b={cand.runMs} />
              </tbody>
            </table>
          ) : <p className="text-sm text-ink-soft-dark">The worker evaluates every candidate itself, on a world grown from a seed it draws, and never trusts numbers Droid reports.</p>}
          {cand ? <p className="mt-2 text-[0.65rem] text-ink-soft-dark">Measured on a simulated economy with designed behaviour; not a claim about real fraud.</p> : null}
        </div>
        <div className="glass space-y-2 p-4" data-testid="lab-review">
          <div className="panel-title">Promote or reject (controller)</div>
          {job.status === "succeeded" ? (
            <div className="flex gap-2">
              <button className="btn btn--honest btn--sm" disabled={!isController} onClick={() => onReview(true)} data-testid="promote">Promote</button>
              <button className="btn btn--fraud btn--sm" disabled={!isController} onClick={() => onReview(false)} data-testid="reject">Reject</button>
            </div>
          ) : <p className="text-sm text-ink-soft-dark">{job.status === "promoted" ? "Promoted: the next detector run uses it, and new pattern cards show the new version." : job.status === "promote_requested" ? "Promoting…" : "Available once a job finishes with a candidate."}</p>}
          {!isController && job.status === "succeeded" ? <p className="text-xs text-review">Take the controller seat on /business to promote.</p> : null}
        </div>
      </aside>
    </>
  );
}

function StepRow({ e, prev }: { e: LabEvent; prev?: LabEvent }) {
  const dt = prev ? Math.max(0, Number(e.at.microsSinceUnixEpoch - prev.at.microsSinceUnixEpoch) / 1e6) : 0;
  const cancelled = e.text.startsWith("CANCELLED");
  const color = e.kind === "tool_call" ? (cancelled ? "text-fraud" : "text-accent") : e.kind === "tool_result" ? "text-honest" : e.kind === "metrics" ? "text-credential" : e.kind === "verdict" || e.kind === "promoted" ? "text-review" : "text-ink-soft-dark";
  let detail = "";
  try {
    const j = JSON.parse(e.json || "{}") as { output?: string; command?: string; isError?: boolean };
    detail = j.command ?? (j.output ? j.output.split("\n").filter(Boolean).slice(-2).join(" ⏎ ") : "");
  } catch { detail = ""; }
  return (
    <li className="rounded px-1 py-0.5 hover:bg-white/5">
      <span className="text-ink-soft-dark">{e.kind.padEnd(11)}</span> <span className={color}>{e.text.slice(0, 220)}</span>
      {detail ? <div className="truncate pl-24 text-ink-soft-dark">{detail.slice(0, 240)}</div> : null}
      {dt > 0.05 ? <span className="float-right text-ink-soft-dark">{dt.toFixed(1)}s</span> : null}
    </li>
  );
}

function ScoreRow({ label, a, b, pct, higherIsBetter }: { label: string; a?: number; b?: number; pct?: boolean; higherIsBetter?: boolean }) {
  const f = (x?: number) => (x === undefined ? "-" : pct ? `${(x * 100).toFixed(1)}%` : Math.round(x).toLocaleString());
  const better = a !== undefined && b !== undefined && a !== b ? (higherIsBetter ? b > a : b < a) : null;
  return (
    <tr className="border-t border-line-dark/50">
      <td className="py-1 font-sans text-xs">{label}</td><td>{f(a)}</td>
      <td className={better === null ? "" : better ? "text-honest" : "text-fraud"}>{f(b)}{better === null ? "" : better ? " ▲" : " ▼"}</td>
    </tr>
  );
}

/** Unified diff rendered side by side: removed lines left, added lines right. */
function DiffView({ text, title }: { text: string; title: string }) {
  const rows: { l: string; r: string; kind: "same" | "del" | "add" | "hunk" }[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (line.startsWith("@@")) rows.push({ l: line, r: line, kind: "hunk" });
    else if (line.startsWith("-")) rows.push({ l: line.slice(1), r: "", kind: "del" });
    else if (line.startsWith("+")) {
      const lastDel = [...rows].reverse().find((x) => x.kind === "del" && !x.r);
      if (lastDel) { lastDel.r = line.slice(1); lastDel.kind = "del"; } else rows.push({ l: "", r: line.slice(1), kind: "add" });
    } else rows.push({ l: line.slice(1), r: line.slice(1), kind: "same" });
  }
  return (
    <div className="glass overflow-hidden" data-testid="lab-diff">
      <div className="border-b border-line-dark px-4 py-2 panel-title">Diff · {title}</div>
      <div className="scroll-thin max-h-[28rem] overflow-auto font-mono text-[0.68rem]">
        <table className="w-full table-fixed">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.kind === "hunk" ? "bg-accent/10 text-accent" : ""}>
                <td className={`w-1/2 whitespace-pre-wrap border-r border-line-dark px-2 align-top ${r.kind === "del" && r.l ? "bg-fraud/10" : ""}`}>{r.l}</td>
                <td className={`w-1/2 whitespace-pre-wrap px-2 align-top ${(r.kind === "add" || r.kind === "del") && r.r ? "bg-honest/10" : ""}`}>{r.r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
