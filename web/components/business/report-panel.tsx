"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
    <div className="min-w-0 space-y-4 break-words" data-testid="reviewing-panel">
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

export function ReportPanel({ claim, row, order, actions }: { claim: Claim; row: ReportRow; order?: Report["order"]; actions?: ReactNode }) {
  const report = useMemo(() => parse<Report | null>(row.json, null), [row.json]);
  const [recs] = useTable(tables.recommendation.where((r) => r.claimId.eq(claim.id)));
  const rec = recs.find((r) => r.jobId === row.jobId);
  if (!report) return <div className="glass p-4 text-sm text-review" data-testid="report-panel">The report for this claim could not be read.</div>;
  return <ReportContent key={String(row.jobId)} report={report.order || !order ? report : { ...report, order }} claimId={claim.id} auditPassed={row.auditPassed} autoDecided={!!rec?.autoDecided} fallbackReel={row.proofReelUrl} actions={actions} />;
}

type OpenImage = (list: ReportArtifact[], index: number) => void;

/** Presentational report, also used by browser regression fixtures without a live database. */
export function ReportContent({ report, claimId, auditPassed, autoDecided = false, fallbackReel = "", actions }: { report: Report; claimId: bigint; auditPassed: boolean; autoDecided?: boolean; fallbackReel?: string; actions?: ReactNode }) {
  const [active, setActive] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ list: ReportArtifact[]; index: number } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const R = report.recommendation;
  const A = report.factoryAssessment;
  const arts = new Map(report.artifacts.map((a) => [a.id, a]));
  const claimsById = new Map(report.claimSummary.spokenClaims.map((c) => [c.id, c]));
  const source = report.video.sourceUrl || report.artifacts.find((a) => a.kind === "video" && a.path === "video.mp4")?.url;
  const reel = report.video.proofReelUrl || fallbackReel;
  const frames = report.artifacts.filter((a) => (a.kind === "frame" || a.kind === "crop") && a.url).sort((a, b) => a.tStart - b.tStart);
  const sheets = report.artifacts.filter((a) => a.kind === "mosaic" && a.url);
  const audio = report.video.audioUrl || report.artifacts.find((a) => a.kind === "audio")?.url;
  const logs = report.artifacts.filter((a) => a.kind === "log");
  const duration = report.video.durationS;
  // The stored size can predate rotation handling; the player's real size wins once it loads.
  const [portrait, setPortrait] = useState(() => isPortrait(report.video.resolution));
  const clips = report.video.clips ?? [];
  const pos = (t: number) => (duration > 0 ? clamp01(t / duration) * 100 : 0);
  const focus = (id: number) => {
    setActive(id);
    document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const seek = (t: number) => {
    if (source && player.current) {
      player.current.currentTime = Math.max(0, Math.min(duration, t));
      player.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };
  const openImage: OpenImage = (list, index) => setViewer({ list, index });
  const review = report.creaoReview;
  const h = report.history;
  const transcript = report.transcript?.segments ?? [];

  return (
    <div className="min-w-0 max-w-full space-y-4 [overflow-wrap:anywhere]" data-testid="report-panel">
      {A ? <Verdict A={A} claimsById={claimsById} focus={focus} actions={actions} />
        : actions ? <section className="glass p-4" data-testid="decision">{actions}</section> : null}

      <section className="glass min-w-0 space-y-3 p-4" data-testid="customer-request">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="panel-title">The customer&apos;s request · {claimLabel(claimId)}</span>
          <Badge kind="live" />
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 text-sm">
            {report.order ? (
              <div>
                <div className="text-xs text-ink-soft-dark">Ordered (the store&apos;s description, taken as true)</div>
                <div className="font-semibold">{report.order.item} · {money(report.order.priceCents)}</div>
                {report.order.description ? <p className="text-ink-soft-dark">{report.order.description}</p> : null}
              </div>
            ) : null}
            <div>
              <div className="text-xs text-ink-soft-dark">Asking for</div>
              <div className="font-semibold">{report.order ? money(report.order.requestedCents) : A ? money(A.requestedCents) : "–"} · {titleCase(report.claimSummary.reasonCode)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-soft-dark">Written reason</div>
              <blockquote className="border-l-2 border-accent/60 pl-3 italic">“{report.claimSummary.reasonText}”</blockquote>
            </div>
          </div>
          <div className="min-w-0 text-sm" data-testid="audio-transcript">
            <div className="text-xs text-ink-soft-dark">What they said on video{report.transcript?.language ? ` (${report.transcript.language})` : ""}</div>
            {transcript.length ? (
              <ol className="scroll-thin mt-1 max-h-56 space-y-1.5 overflow-y-auto pr-1" data-testid="transcript">
                {transcript.map((seg, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <button className="shrink-0 font-mono text-xs text-accent underline disabled:no-underline" onClick={() => seek(seg.start)} disabled={!source}>{hms(seg.start)}</button>
                    <span className="min-w-0">{seg.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-ink-soft-dark">{report.transcript?.note || (report.video.audio ? "No transcript was saved for this report. Play the video to hear it." : "The uploaded video has no sound, so nothing could be transcribed.")}</p>
            )}
            {transcript.length ? <p className="mt-1 text-[0.7rem] text-ink-soft-dark">Machine transcript; check the recording for uncertain words.</p> : null}
          </div>
        </div>
      </section>

      <section className="glass min-w-0 p-4" data-testid="footage">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="panel-title">{source ? "Footage · source timestamps" : "Proof reel · edited excerpts"}</span>
          <span className="text-xs text-ink-soft-dark">{duration.toFixed(1)} s · {report.video.resolution} · {report.video.audio ? "with sound" : "no sound"}</span>
        </div>
        <div className={`grid min-w-0 gap-4 ${portrait ? "md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]" : ""}`}>
          <div className="min-w-0 space-y-2">
            {source || reel ? (
              <div className="flex justify-center overflow-hidden rounded-lg bg-black">
                <video ref={player} controls playsInline preload="metadata" src={source || reel} data-testid="source-video"
                  onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setPortrait(v.videoHeight > v.videoWidth); }}
                  className={`block max-w-full object-contain ${portrait ? "max-h-[32rem] w-auto" : "aspect-video max-h-[28rem] w-full"}`} />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-black/40 text-sm text-ink-soft-dark">No video for this claim.</div>
            )}
            {clips.length > 1 ? (
              <div className="flex flex-wrap gap-2" data-testid="clip-chips">
                {clips.map((c) => (
                  <button key={c.n} className={`chip ${c.n === 2 ? "chip--review" : ""}`} onClick={() => seek(c.tStart)} disabled={!source}>
                    {c.n === 1 ? "Claim video" : "Extra clip"} · {hms(c.tStart)}–{hms(c.tEnd)}{c.audio ? "" : " · no sound"}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="relative h-6 rounded-full bg-white/10" data-testid="timeline">
              {clips.slice(1).map((c) => <span key={c.n} aria-hidden title={`extra clip starts ${hms(c.tStart)}`} className="absolute inset-y-0 w-0.5 bg-review" style={{ left: `${pos(c.tStart)}%` }} />)}
              {report.timeline.map((e, i) => (
                <button key={i} type="button" title={`${hms(e.t)} · ${e.label}`} aria-label={e.label} onClick={() => { if (source) seek(e.t); else if (e.findingId !== undefined) focus(e.findingId); }}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 ${MARK[e.kind] ?? "bg-slate-300"} cursor-pointer hover:scale-125`}
                  style={{ left: `${Math.min(98, Math.max(2, pos(e.t)))}%` }} />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[0.7rem] text-ink-soft-dark"><span>{hms(0)}</span><span>{hms(duration)}</span></div>
          </div>
          <div className="min-w-0" data-testid="key-frames">
            <div className="mb-2 text-xs text-ink-soft-dark">Key frames · click to enlarge</div>
            {frames.length ? (
              <ul className={`grid gap-2 ${portrait ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
                {frames.map((a, i) => (
                  <li key={a.id} className="min-w-0">
                    <Thumb a={a} portrait={portrait} onOpen={() => openImage(frames, i)} />
                    <div className="mt-0.5 truncate text-[0.7rem] text-ink-soft-dark" title={a.label}>
                      <button className="font-mono text-accent underline disabled:no-underline" onClick={() => seek(a.tStart)} disabled={!source}>{hms(a.tStart)}</button> {a.label}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-soft-dark">No frames were registered for this report.</p>}
          </div>
        </div>
      </section>

      <div className="space-y-2" data-testid="findings">
        <div className="flex items-center justify-between"><span className="panel-title">Findings ({report.findings.length})</span><Badge kind="live" /></div>
        {report.findings.length === 0 ? <div className="glass p-3 text-sm text-ink-soft-dark">No finding passed the audit.</div> : null}
        {report.findings.map((f) => <FindingCard key={f.id} f={f} claim={f.claimId ? claimsById.get(f.claimId) : undefined} arts={arts} active={active === f.id} portrait={portrait} onOpen={openImage} onSeek={source ? seek : undefined} />)}
        {report.rejectedFindings.length ? (
          <details className="glass p-3" data-testid="rejected-findings">
            <summary className="cursor-pointer text-sm text-ink-soft-dark">Rejected by the audit ({report.rejectedFindings.length})</summary>
            <div className="mt-2 space-y-2">
              {report.rejectedFindings.map((f) => <FindingCard key={f.id} f={f} claim={f.claimId ? claimsById.get(f.claimId) : undefined} arts={arts} active={active === f.id} portrait={portrait} onOpen={openImage} onSeek={source ? seek : undefined} />)}
            </div>
          </details>
        ) : null}
      </div>

      <details className="glass min-w-0 p-4" data-testid="technical">
        <summary className="cursor-pointer text-sm font-semibold">Technical details · scoring, integrity, history, method</summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-3" data-testid="report-header">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="panel-title">Automation policy</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge kind="live" />
                {report.method.lanesOnly ? <span className="chip chip--review">Automated checks only</span> : null}
                {autoDecided ? <span className="chip chip--honest">Auto-approved</span> : null}
                <span className={`chip ${auditPassed ? "chip--honest" : "chip--review"}`}>{auditPassed ? "Audit passed" : "Audit not passed"}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="chip chip--accent font-mono" data-testid="report-tier">{R.tier}</span>
                  <span className="text-lg font-bold">{TIER_LABEL[R.tier] ?? R.tier}</span>
                </div>
                <div className="mt-1 text-sm text-ink-soft-dark">
                  Policy amount now <b className="text-ink-dark">{money(R.refundNow)}</b> · on return <b className="text-ink-dark">{money(R.refundOnReturn)}</b>
                  {R.returnRequired ? " · return required" : ""}{R.replacementOffered ? " · replacement offered" : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold" data-testid="report-plegit">{Math.round(report.score.pLegit * 100)}%</div>
                <div className="text-xs text-ink-soft-dark">P(legit) · formula {report.formulaVersion}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Bar label="E evidence" value={report.score.eSupport} />
              <Bar label="C coverage" value={report.score.coverage} />
              <Bar label="I integrity" value={report.score.integrity} />
            </div>
            <ol className="space-y-1 text-sm">
              {R.reasons.map((r, i) => <li key={i} className="flex flex-wrap gap-2"><span className="chip chip--accent max-w-full font-mono">{r.cites}</span><span className="min-w-0">{r.text}</span></li>)}
            </ol>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="text-sm" data-testid="integrity">
              <div className="panel-title mb-2">Integrity {Math.round(report.integrity.score * 100)}%</div>
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
            <div className="text-sm" data-testid="history">
              <div className="panel-title mb-2">History</div>
              <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-y-0.5">
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

          <div className="text-sm" data-testid="score-components">
            <div className="panel-title mb-2">Score components · logit {report.score.logit.toFixed(2)} → P {Math.round(report.score.pLegit * 100)}%</div>
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

          <div className="text-sm" data-testid="creao-review">
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

          {audio ? <div className="space-y-1 text-sm"><div className="panel-title">Audio track</div><audio controls preload="none" src={audio} className="w-full max-w-full" data-testid="report-audio" /></div> : null}
          {source && reel ? <div className="space-y-1 text-sm"><div className="panel-title">Proof reel · edited excerpts (not source time)</div><video controls playsInline preload="none" src={reel} className="block max-h-80 w-full max-w-full rounded bg-black object-contain" data-testid="proof-reel" /></div> : null}
          {sheets.length ? (
            <div className="space-y-2 text-sm">
              <div className="panel-title">Contact sheets ({sheets.length})</div>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{sheets.map((a, i) => <li key={a.id}><Thumb a={a} portrait={portrait} onOpen={() => openImage(sheets, i)} /></li>)}</ul>
            </div>
          ) : null}

          <div className="space-y-3 text-sm" data-testid="method">
            <div className="panel-title">How this was investigated</div>
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

          <div className="text-sm" data-testid="limits">
            {report.limits.length ? (
              <>
                <div className="panel-title mb-1">Limits</div>
                <ul className="list-disc pl-5 text-xs">{report.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      </details>
      <p className="text-[0.7rem] text-ink-soft-dark">Findings describe the footage, never the person. Internally consistent footage is not proof of authenticity.</p>

      {viewer ? <Lightbox list={viewer.list} index={viewer.index} onIndex={(index) => setViewer({ ...viewer, index })} onClose={() => setViewer(null)} onSeek={source ? (t) => { setViewer(null); seek(t); } : undefined} /> : null}
    </div>
  );
}

const isPortrait = (resolution: string) => {
  const [w, h] = resolution.split(/[×x]/).map(Number);
  return !!w && !!h && h > w;
};

function verdictHeadline(A: NonNullable<Report["factoryAssessment"]>): { text: string; tone: string } {
  if (A.status !== "validated") return { text: "Needs a person", tone: "text-review" };
  if (A.action === "accept") return { text: A.amountCents < A.requestedCents ? `Accept a partial refund of ${money(A.amountCents)}` : `Accept the refund of ${money(A.amountCents)}`, tone: "text-honest" };
  if (A.action === "decline") return { text: "Reject the refund", tone: "text-fraud" };
  return A.nextStep === "extra_clip" ? { text: "Inconclusive: one extra clip would settle it", tone: "text-review" } : { text: "Inconclusive: a person decides", tone: "text-review" };
}

/** The queue's one-word version of the main recommendation. */
export function shortVerdict(A: NonNullable<Report["factoryAssessment"]>): { text: string; chip: string } {
  if (A.status !== "validated") return { text: "Needs a person", chip: "chip chip--review" };
  if (A.action === "accept") return { text: `Accept ${money(A.amountCents)}`, chip: "chip chip--honest" };
  if (A.action === "decline") return { text: "Reject", chip: "chip chip--fraud" };
  return { text: A.nextStep === "extra_clip" ? "More evidence" : "Needs a person", chip: "chip chip--review" };
}

function Verdict({ A, claimsById, focus, actions }: { A: NonNullable<Report["factoryAssessment"]>; claimsById: Map<string, SpokenClaim>; focus: (id: number) => void; actions?: ReactNode }) {
  const head = verdictHeadline(A);
  return (
    <section className="glass space-y-3 p-4" data-testid="factory-recommendation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">Recommendation</span>
        <span className={`chip ${A.status === "validated" ? "chip--accent" : "chip--review"}`}>{A.status === "validated" ? "Audited citations" : "Human review required"}</span>
      </div>
      <h2 className={`text-2xl font-bold ${head.tone}`} data-testid="verdict">{head.text}</h2>
      {actions ? <div className="rounded-lg border border-line-dark bg-black/20 p-3">{actions}</div> : null}
      <p className="text-sm text-ink-soft-dark">{money(A.amountCents)} of {money(A.requestedCents)} requested · confidence {pct(A.confidence)} · a recommendation, not a payment or final denial; rejection always needs a person.</p>
      <p className="text-sm">{A.rationale}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([{ title: "Evidence for the refund", items: A.forRefund }, { title: "Evidence against the refund", items: A.againstRefund }]).map(({ title, items }) => <div key={title} className="min-w-0">
          <h3 className="mb-1 text-sm font-semibold">{title}</h3>
          {items.length ? <ul className="space-y-2 text-sm">{items.map((e, n) => <li key={n}>{e.reason} <button className="text-accent underline" onClick={() => focus(Number(e.findingId))}>View finding</button></li>)}</ul> : <p className="text-xs text-ink-soft-dark">No audited evidence on this side.</p>}
        </div>)}
      </div>
      {A.statements.length ? <details data-testid="statement-analysis"><summary className="cursor-pointer text-sm font-semibold">Each statement, checked against the footage ({A.statements.length})</summary><ul className="mt-2 space-y-2 text-sm">{A.statements.map((st) => <li key={st.claimId} className="rounded border border-line-dark p-2">
        <p className="text-ink-soft-dark">“{claimsById.get(st.claimId)?.text ?? st.claimId}”</p><p>{st.analysis}</p>
        {st.findingIds.map((id) => <button key={id} className="mr-3 text-xs text-accent underline" onClick={() => focus(Number(id))}>Finding {id}</button>)}
      </li>)}</ul></details> : null}
      {A.missingEvidence.length ? <div data-testid="evidence-requested"><h3 className="text-sm font-semibold">What would settle it</h3><ul className="list-disc pl-5 text-sm">{A.missingEvidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null}
      {A.guardNotes.length ? <ul className="list-disc pl-5 text-xs text-review">{A.guardNotes.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
    </section>
  );
}

function Thumb({ a, portrait, onOpen }: { a: ReportArtifact; portrait: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} title={`${a.label || a.path} · click to enlarge`} data-testid="thumb"
      className={`group relative block w-full overflow-hidden rounded border border-line-dark bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${a.kind === "mosaic" || a.kind === "chart" ? "aspect-square" : portrait ? "aspect-[9/16]" : "aspect-video"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.url} alt={a.label || a.kind} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
    </button>
  );
}

const LB_BTN = "rounded-md border border-white/40 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15";

/** Full-size viewer for frames, crops, charts and contact sheets: arrows to step, Esc to close. */
function Lightbox({ list, index, onIndex, onClose, onSeek }: { list: ReportArtifact[]; index: number; onIndex: (i: number) => void; onClose: () => void; onSeek?: (t: number) => void }) {
  const a = list[index]!;
  const step = useCallback((d: number) => onIndex((index + d + list.length) % list.length), [index, list.length, onIndex]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose, step]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={a.label || "image"} className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-3 text-white sm:p-6" onClick={onClose} data-testid="lightbox">
      <div className="flex items-center justify-between gap-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate"><span className="font-mono">{hms(a.tStart)}</span> · {a.label || a.path} <span className="text-white/60">({index + 1} of {list.length})</span></span>
        <div className="flex shrink-0 items-center gap-2">
          {onSeek ? <button className={LB_BTN} onClick={() => onSeek(a.tStart)}>Play from here</button> : null}
          <a className={LB_BTN} href={a.url} target="_blank" rel="noreferrer">Open original</a>
          <button className={LB_BTN} onClick={onClose} aria-label="Close">Close ✕</button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center py-3">
        {list.length > 1 ? <button className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-2xl hover:bg-white/20" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous image">‹</button> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.label || a.kind} className="max-h-full max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
        {list.length > 1 ? <button className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-2xl hover:bg-white/20" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next image">›</button> : null}
      </div>
    </div>,
    document.body,
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

function FindingCard({ f, claim, arts, active, portrait, onOpen, onSeek }: { f: ReportFinding; claim?: SpokenClaim; arts: Map<number, ReportArtifact>; active: boolean; portrait: boolean; onOpen: OpenImage; onSeek?: (t: number) => void }) {
  const cited = f.artifactIds.map((id) => arts.get(id)).filter((a): a is ReportArtifact => !!a);
  const images = cited.filter((a) => IMAGE_KINDS.has(a.kind) && a.url);
  const other = cited.filter((a) => !images.includes(a));
  return (
    <div id={`finding-${f.id}`} className={`glass space-y-2 p-3 text-sm transition ${active ? "ring-2 ring-accent" : ""}`} data-testid={`finding-${f.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={KIND_CHIP[f.kind] ?? "chip"}>{f.kind}</span>
        {f.claimId ? <span className="chip font-mono">{f.claimId}</span> : null}
        {onSeek ? <button className="font-mono text-xs text-accent underline" onClick={() => onSeek(f.tStart)}>{hms(f.tStart)}–{hms(f.tEnd)}</button> : <span className="font-mono text-xs text-ink-soft-dark">{hms(f.tStart)}–{hms(f.tEnd)}</span>}
        <span className="text-xs text-ink-soft-dark">{Math.round(f.confidence * 100)}% · {f.method}</span>
        {f.auditStatus !== "passed" ? <span className="chip chip--review">audit {f.auditStatus}</span> : null}
      </div>
      {claim ? <p className="text-xs text-ink-soft-dark">Claim: “{claim.text}”</p> : null}
      <p>{f.observation}</p>
      {f.auditNote ? <p className="text-xs text-review">Audit: {f.auditNote}</p> : null}
      {images.length ? (
        <ul className={`grid gap-2 ${portrait ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-4"}`}>
          {images.map((a, i) => <li key={a.id} className="min-w-0"><Thumb a={a} portrait={portrait} onOpen={() => onOpen(images, i)} /></li>)}
        </ul>
      ) : null}
      {other.length ? <div className="grid min-w-0 gap-2 sm:grid-cols-2">{other.map((a) => <ArtifactView key={a.id} a={a} portrait={portrait} />)}</div> : null}
    </div>
  );
}

function ArtifactView({ a, portrait }: { a: ReportArtifact; portrait: boolean }) {
  const title = `${a.label || a.path} · ${hms(a.tStart)}${a.tEnd > a.tStart ? `–${hms(a.tEnd)}` : ""}`;
  if (!a.url) return <span className="chip" title={title}>{a.kind} · {a.label || a.path}</span>;
  if (a.kind === "clip") return (
    <div className="flex justify-center overflow-hidden rounded bg-black">
      <video controls playsInline preload="none" src={a.url} title={title} className={`block max-w-full object-contain ${portrait ? "max-h-72 w-auto" : "aspect-video w-full"}`} />
    </div>
  );
  if (a.kind === "audio") return <audio controls preload="none" src={a.url} title={title} className="w-full min-w-0 max-w-full" />;
  return <a href={a.url} target="_blank" rel="noreferrer" className="chip chip--accent max-w-full" title={title}>{a.kind} · {a.label || a.path}</a>;
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
