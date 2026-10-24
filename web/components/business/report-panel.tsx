"use client";

import { useMemo, useState } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { AnalysisJob, Claim, Report as ReportRow } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { claimLabel, money, pct, titleCase } from "@/lib/format";
import { STEP_KEYS, STEP_LABEL, type DroidSessionSummary, type Report, type ReportArtifact, type ReportFinding } from "@vouch/module/review-types";
import { TIER_LABEL } from "@vouch/module/review-score";
import type { SpokenClaim } from "@vouch/module/review-score";
import { parse } from "./investigation";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const hms = (t: number) => {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.max(0, t) - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

const KIND_CHIP: Record<string, string> = { supports: "chip chip--honest", contradicts: "chip chip--fraud", integrity: "chip chip--review", neutral: "chip" };
const MARK: Record<string, string> = { claim: "bg-slate-300", supports: "bg-honest", contradicts: "bg-fraud", integrity: "bg-review", challenge: "bg-review" };
const IMAGE_KINDS = new Set(["frame", "mosaic", "crop", "chart"]);

/** The compact panel shown while the reviewer is still running: steps with the business-side summary. */
export function ReviewingPanel({ job }: { job: AnalysisJob }) {
  const [rows] = useTable(tables.analysisStep.where((r) => r.jobId.eq(job.id)));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <div className="space-y-4" data-testid="reviewing-panel">
      <div className="glass p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="panel-title">Video reviewer · {titleCase(job.status)} · {job.mode}</span>
          <Badge kind="live" />
        </div>
        <ol className="space-y-1.5">
          {STEP_KEYS.map((k) => {
            const s = byKey.get(k);
            return (
              <li key={k} className="flex items-start gap-2 text-sm" data-status={s?.status ?? "pending"}>
                <StepDot status={s?.status ?? "pending"} />
                <div className="min-w-0">
                  <span className="font-medium">{STEP_LABEL[k]}</span>
                  {s?.summary ? <span className="ml-2 text-xs text-ink-soft-dark">{s.summary}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
        {job.costNote ? <p className="mt-3 text-xs text-ink-soft-dark">{job.costNote}</p> : null}
      </div>
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  const cls = status === "done" ? "bg-honest text-black" : status === "running" ? "animate-pulse bg-accent text-black" : status === "failed" ? "bg-fraud text-black" : "bg-white/10 text-ink-soft-dark";
  const glyph = status === "done" ? "✓" : status === "failed" ? "!" : status === "skipped" ? "–" : status === "running" ? "…" : "·";
  return <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold ${cls}`}>{glyph}</span>;
}

export function ReportPanel({ claim, row }: { claim: Claim; row: ReportRow }) {
  const report = useMemo(() => parse<Report | null>(row.json, null), [row.json]);
  const [recs] = useTable(tables.recommendation.where((r) => r.claimId.eq(claim.id)));
  const rec = recs[0];
  const [active, setActive] = useState<number | null>(null);
  if (!report) return <div className="glass p-4 text-sm text-review" data-testid="report-panel">The report for this claim could not be read.</div>;

  const R = report.recommendation;
  const arts = new Map(report.artifacts.map((a) => [a.id, a]));
  const claimsById = new Map(report.claimSummary.spokenClaims.map((c) => [c.id, c]));
  const reel = report.video.proofReelUrl || row.proofReelUrl || report.artifacts.find((a) => a.kind === "video" && a.path.endsWith("video.mp4"))?.url;
  const logs = report.artifacts.filter((a) => a.kind === "log");
  const duration = report.video.durationS;
  const pos = (t: number) => (duration > 0 ? clamp01(t / duration) * 100 : 0);
  const focus = (id: number) => {
    setActive(id);
    document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const review = report.creaoReview;
  const h = report.history;

  return (
    <div className="space-y-4" data-testid="report-panel">
      <div className="glass space-y-3 p-4" data-testid="report-header">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="panel-title">Video reviewer report · {claimLabel(claim.id)}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge kind="live" />
            {report.method.lanesOnly ? <span className="chip chip--review">Automated checks only</span> : null}
            {rec?.autoDecided ? <span className="chip chip--honest">Auto-approved</span> : null}
            <span className={`chip ${row.auditPassed ? "chip--honest" : "chip--review"}`}>{row.auditPassed ? "Audit passed" : "Audit not passed"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="chip chip--accent font-mono" data-testid="report-tier">{R.tier}</span>
              <span className="text-xl font-bold">{TIER_LABEL[R.tier] ?? R.tier}</span>
            </div>
            <div className="mt-1 text-sm text-ink-soft-dark">
              Refund now <b className="text-ink-dark">{money(R.refundNow)}</b> · on return <b className="text-ink-dark">{money(R.refundOnReturn)}</b>
              {R.returnRequired ? " · return required" : ""}{R.replacementOffered ? " · replacement offered" : ""}
            </div>
            {R.creditPreview ? <div className="mt-0.5 text-xs text-ink-soft-dark">Credit preview: {titleCase(R.creditPreview.base)} ({R.creditPreview.delta >= 0 ? "+" : ""}{R.creditPreview.delta})</div> : null}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" data-testid="report-plegit">{Math.round(report.score.pLegit * 100)}%</div>
            <div className="text-xs text-ink-soft-dark">P(legit) · formula {report.formulaVersion}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Bar label="E evidence" value={report.score.eSupport} />
          <Bar label="C coverage" value={report.score.coverage} />
          <Bar label="I integrity" value={report.score.integrity} />
        </div>
        <ol className="space-y-1 text-sm">
          {R.reasons.map((r, i) => (
            <li key={i} className="flex gap-2"><span className="chip chip--accent shrink-0 font-mono">{r.cites}</span><span>{r.text}</span></li>
          ))}
        </ol>
        {R.evidenceRequested?.length ? (
          <div className="rounded-lg border border-review/50 bg-review/10 p-3 text-sm" data-testid="evidence-requested">
            <b>Evidence requested</b>
            <ul className="mt-1 list-disc pl-5">{R.evidenceRequested.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : null}
      </div>

      <div className="glass overflow-hidden">
        {reel ? (
          <video controls preload="metadata" src={reel} className="aspect-video w-full bg-black" data-testid="proof-reel" />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-black/40 text-sm text-ink-soft-dark">No proof reel for this claim.</div>
        )}
        <div className="space-y-1 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft-dark">
            <span className="font-mono">{hms(0)}</span>
            <span>{duration.toFixed(1)}s · {report.video.resolution} · {report.video.audio ? "audio" : "no audio"} · sha256 {report.video.sha256.slice(0, 12)} <Badge kind="live" /></span>
            <span className="font-mono">{hms(duration)}</span>
          </div>
          <div className="relative h-6 rounded-full bg-white/10" data-testid="timeline">
            {report.timeline.map((e, i) => (
              <button key={i} type="button" title={`${hms(e.t)} · ${e.label}`} aria-label={e.label} onClick={() => { if (e.findingId !== undefined) focus(e.findingId); }}
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 ${MARK[e.kind] ?? "bg-slate-300"} ${e.findingId !== undefined ? "cursor-pointer hover:scale-125" : "cursor-default"}`}
                style={{ left: `${pos(e.t)}%` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="glass p-3 text-sm" data-testid="spoken-claims">
        <div className="panel-title mb-2">What was claimed <Badge kind="live" /></div>
        <p className="mb-2"><span className="text-ink-soft-dark">{titleCase(report.claimSummary.reasonCode)} · written:</span> <i>“{report.claimSummary.reasonText}”</i></p>
        {report.claimSummary.spokenClaims.length ? (
          <ul className="space-y-1">
            {report.claimSummary.spokenClaims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                <span className="chip shrink-0 font-mono">{c.id}</span>
                <span className="chip shrink-0">{c.kind}</span>
                {report.claimSummary.claimsFrom === "transcript" ? <span className="shrink-0 font-mono text-xs text-ink-soft-dark">{hms(c.tSaid)}</span> : <span className="chip shrink-0 text-xs">from the written reason</span>}
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-ink-soft-dark">Nothing was said on the recording.</p>}
      </div>

      <div className="space-y-2" data-testid="findings">
        <div className="flex items-center justify-between"><span className="panel-title">Findings ({report.findings.length})</span><Badge kind="live" /></div>
        {report.findings.length === 0 ? <div className="glass p-3 text-sm text-ink-soft-dark">No finding passed the audit.</div> : null}
        {report.findings.map((f) => <FindingCard key={f.id} f={f} claim={f.claimId ? claimsById.get(f.claimId) : undefined} arts={arts} active={active === f.id} />)}
        {report.rejectedFindings.length ? (
          <details className="glass p-3" data-testid="rejected-findings">
            <summary className="cursor-pointer text-sm text-ink-soft-dark">Rejected by the audit ({report.rejectedFindings.length})</summary>
            <div className="mt-2 space-y-2">
              {report.rejectedFindings.map((f) => <FindingCard key={f.id} f={f} claim={f.claimId ? claimsById.get(f.claimId) : undefined} arts={arts} active={active === f.id} />)}
            </div>
          </details>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass p-3 text-sm" data-testid="integrity">
          <div className="panel-title mb-2">Integrity {Math.round(report.integrity.score * 100)}% <Badge kind="live" /></div>
          {report.integrity.flags.length ? (
            <ul className="space-y-1">
              {report.integrity.flags.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <span className="chip chip--review">{titleCase(f.kind)}</span>
                  <span className="text-xs text-ink-soft-dark">{Math.round(f.confidence * 100)}%{f.tStart !== undefined ? ` · ${hms(f.tStart)}${f.tEnd !== undefined ? `–${hms(f.tEnd)}` : ""}` : ""}</span>
                  {f.note ? <span className="text-xs">{f.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-ink-soft-dark">No integrity flags.</p>}
          <p className="mt-2 text-[0.7rem] text-ink-soft-dark">Internally consistent, not proof of authenticity.</p>
        </div>
        <div className="glass p-3 text-sm" data-testid="history">
          <div className="panel-title mb-2">History <Badge kind="live" /></div>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-0.5">
            <dt className="text-ink-soft-dark">Tenure</dt><dd>{h.tenureDays} days</dd>
            <dt className="text-ink-soft-dark">Orders</dt><dd>{h.orders}</dd>
            <dt className="text-ink-soft-dark">Refunds (365 d)</dt><dd>{h.refunds365}</dd>
            <dt className="text-ink-soft-dark">Refund rate</dt><dd>{pct(h.smoothedRefundRate)} smoothed vs {pct(h.categoryBaseline)} category baseline</dd>
            <dt className="text-ink-soft-dark">Excess ratio</dt><dd className="font-mono">{h.excessRatio.toFixed(2)}</dd>
            <dt className="text-ink-soft-dark">Anomaly</dt>
            <dd className="flex flex-wrap items-center gap-1">
              <span className="font-mono">{h.anomaly.score.toFixed(2)}</span>
              {h.anomaly.thin ? <span className="chip">thin history</span> : null}
              {h.anomaly.unusual ? <span className="chip chip--review">unusual</span> : null}
              {h.anomaly.windowEdge ? <span className="chip chip--review">window edge</span> : null}
            </dd>
            <dt className="text-ink-soft-dark">Identity</dt><dd>{titleCase(h.verifiedIdentity)}</dd>
          </dl>
        </div>
      </div>

      <div className="glass p-3 text-sm" data-testid="score-components">
        <div className="panel-title mb-2">Score components · logit {report.score.logit.toFixed(2)} → P {Math.round(report.score.pLegit * 100)}% <Badge kind="live" /></div>
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(report.score.components).map(([k, v]) => (
              <tr key={k} className="border-t border-line-dark/60">
                <td className="py-0.5 text-ink-soft-dark">{titleCase(k)}</td>
                <td className="py-0.5 text-right font-mono">{v >= 0 ? "+" : ""}{v.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass p-3 text-sm" data-testid="creao-review">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="panel-title">CREAO Refund Reviewer</span>
          {review ? review.provenance === "offline" ? <span className="chip chip--review">Reviewer offline</span> : <Badge kind={review.provenance} /> : null}
        </div>
        {review ? (
          <>
            <div className={`font-semibold ${review.agrees ? "text-honest" : "text-review"}`}>{review.agrees ? "Agrees with the tier" : "Disagrees with the tier"}</div>
            {review.businessSummary ? <p className="mt-1">{review.businessSummary}</p> : null}
            {review.concerns.length ? <ul className="mt-1 list-disc pl-5 text-xs">{review.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
            {review.runId ? <p className="mt-1 font-mono text-xs text-ink-soft-dark">run {review.runId.slice(0, 14)}</p> : null}
          </>
        ) : <p className="text-ink-soft-dark">No reviewer opinion recorded.</p>}
      </div>

      <div className="glass space-y-3 p-3 text-sm" data-testid="method">
        <div className="flex items-center justify-between"><span className="panel-title">How this was investigated</span><Badge kind="live" /></div>
        {report.method.droidSessions.length === 0 ? <p className="text-ink-soft-dark">No Droid sessions: automated checks only.</p> : null}
        {report.method.droidSessions.map((s, i) => <DroidSession key={`${s.name}-${i}`} s={s} />)}
        {report.method.toolsUsed.length ? <div className="flex flex-wrap gap-1">{report.method.toolsUsed.map((t) => <span key={t} className="chip">{t}</span>)}</div> : null}
        {logs.length ? (
          <div className="flex flex-wrap gap-3 text-xs">
            {logs.map((l) => l.url ? <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="text-accent underline">{l.label || l.path}</a> : <span key={l.id} className="text-ink-soft-dark">{l.label || l.path}</span>)}
          </div>
        ) : null}
        {report.method.ingestLog.length ? (
          <details>
            <summary className="cursor-pointer text-xs text-ink-soft-dark">Ingest log ({report.method.ingestLog.length} lines)</summary>
            <pre className="scroll-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[0.68rem]">{report.method.ingestLog.join("\n")}</pre>
          </details>
        ) : null}
      </div>

      <div className="glass p-3 text-sm" data-testid="limits">
        {report.limits.length ? (
          <>
            <div className="panel-title mb-1">Limits</div>
            <ul className="list-disc pl-5 text-xs">{report.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </>
        ) : null}
        <p className={`text-[0.7rem] text-ink-soft-dark ${report.limits.length ? "mt-2" : ""}`}>Findings describe the footage, never the person. Internally consistent footage is not proof of authenticity.</p>
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const p = Math.round(clamp01(value) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-soft-dark"><span>{label}</span><span>{p}%</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-accent" style={{ width: `${p}%` }} /></div>
    </div>
  );
}

function FindingCard({ f, claim, arts, active }: { f: ReportFinding; claim?: SpokenClaim; arts: Map<number, ReportArtifact>; active: boolean }) {
  return (
    <div id={`finding-${f.id}`} className={`glass space-y-2 p-3 text-sm transition ${active ? "ring-2 ring-accent" : ""}`} data-testid={`finding-${f.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={KIND_CHIP[f.kind] ?? "chip"}>{f.kind}</span>
        {f.claimId ? <span className="chip font-mono">{f.claimId}</span> : null}
        <span className="font-mono text-xs text-ink-soft-dark">{hms(f.tStart)}–{hms(f.tEnd)}</span>
        <span className="text-xs text-ink-soft-dark">{Math.round(f.confidence * 100)}% · {f.method}</span>
        {f.auditStatus !== "passed" ? <span className="chip chip--review">audit {f.auditStatus}</span> : null}
      </div>
      {claim ? <p className="text-xs text-ink-soft-dark">Claim: “{claim.text}”</p> : null}
      <p>{f.observation}</p>
      {f.auditNote ? <p className="text-xs text-review">Audit: {f.auditNote}</p> : null}
      {f.artifactIds.length ? (
        <div className="flex flex-wrap gap-2">
          {f.artifactIds.map((id) => { const a = arts.get(id); return a ? <ArtifactView key={id} a={a} /> : null; })}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactView({ a }: { a: ReportArtifact }) {
  const title = `${a.label || a.path} · ${hms(a.tStart)}${a.tEnd > a.tStart ? `–${hms(a.tEnd)}` : ""}`;
  if (!a.url) return <span className="chip" title={title}>{a.kind} · {a.label || a.path}</span>;
  if (a.kind === "clip") return <video controls preload="metadata" src={a.url} title={title} className="h-28 rounded bg-black" />;
  if (IMAGE_KINDS.has(a.kind)) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" title={title} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.label || a.kind} className="h-20 rounded border border-line-dark object-cover" />
      </a>
    );
  }
  return <a href={a.url} target="_blank" rel="noreferrer" className="chip chip--accent" title={title}>{a.kind} · {a.label || a.path}</a>;
}

function DroidSession({ s }: { s: DroidSessionSummary }) {
  const ran = s.mode === "live" || s.mode === "replay";
  return (
    <div className="space-y-1.5 rounded-lg border border-line-dark p-2.5" data-testid="droid-session">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{s.name}</span>
        {s.mode === "live" ? <Badge kind="live" /> : s.mode === "replay" ? <Badge kind="replay" /> : <span className="chip chip--review">{titleCase(s.mode)}{s.note ? ` · ${s.note}` : ""}</span>}
        {ran && s.note ? <span className="text-xs text-ink-soft-dark">{s.note}</span> : null}
      </div>
      {s.plan ? (
        <details>
          <summary className="cursor-pointer text-xs text-ink-soft-dark">Plan</summary>
          <pre className="scroll-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[0.68rem]">{s.plan}</pre>
        </details>
      ) : null}
      {s.commands.length ? (
        <ul className="space-y-0.5 font-mono text-[0.7rem]">
          {s.commands.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className={`w-5 shrink-0 text-right ${c.exitCode === 0 ? "text-honest" : c.exitCode === null ? "text-ink-soft-dark" : "text-fraud"}`}>{c.exitCode ?? "–"}</span>
              <span className="min-w-0 flex-1 truncate" title={c.cmd}>{c.cmd}</span>
              <span className="shrink-0 text-ink-soft-dark">{c.ms} ms</span>
            </li>
          ))}
        </ul>
      ) : null}
      {s.filesWritten.length ? <div className="flex flex-wrap gap-1">{s.filesWritten.map((f) => <span key={f} className="chip font-mono">{f}</span>)}</div> : null}
    </div>
  );
}
