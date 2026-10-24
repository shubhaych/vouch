"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim, Evidence, Purchase, Refund } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { agentLabel, businessLabel, money, titleCase } from "@/lib/format";
import { businessDef, catalogItem } from "@vouch/module/world";
import { CredentialStepper } from "./credential-stepper";

export interface EvidenceFrame { index: number; t?: number; observation?: string; boxes?: { label: string; x: number; y: number; w: number; h: number }[] }
export interface EvidenceJson {
  frames?: EvidenceFrame[]; summary?: string; unable_to_verify?: boolean; offline?: boolean; no_video?: boolean; reason?: string;
  item_matches_reference?: { value: string | boolean; confidence?: number; explanation?: string };
  claimed_defect_visible?: { value: string | boolean; confidence?: number; frames?: number[] };
  defect_consistent_with_claim?: { value: string | boolean; damage_type?: string; explanation?: string };
  challenge?: { expected?: number; seen?: number | null; passed?: boolean };
  capture_flags?: string[];
}
interface Checks {
  fresh?: boolean; uploaded_after_s?: number; duration_s?: number; width?: number; height?: number; duration_ok?: boolean; resolution_ok?: boolean;
  frame_reuse?: { frame: number; matches_claim: string; matches_frame: number; distance: number }[]; frame_times?: number[]; blank_frames?: number; frame_motion?: number | null; still_image?: boolean;
  within_window?: boolean; reason_allowed?: boolean; over_video_threshold?: boolean; policy_line?: string;
}

export const parse = <T,>(s: string | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function Investigation({ claim, refund, purchase, evidence, frame, onFrame }: {
  claim: Claim; refund: Refund; purchase?: Purchase; evidence: Evidence[]; frame: number; onFrame: (i: number) => void;
}) {
  const analyst = evidence.find((e) => e.seat === "evidence_analyst");
  const system = evidence.find((e) => e.seat === "system");
  const ev = parse<EvidenceJson>(analyst?.json ?? system?.json, {});
  const checks = parse<Checks>(claim.checksJson, {});
  const item = purchase ? catalogItem(purchase.item) : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [claims] = useTable(tables.claim);
  const boxesFor = (i: number) => ev.frames?.find((f) => f.index === i)?.boxes ?? [];

  useEffect(() => {
    const t = checks.frame_times?.[frame];
    if (videoRef.current && t !== undefined) videoRef.current.currentTime = t;
  }, [frame, checks.frame_times]);

  return (
    <div className="space-y-4" data-testid="investigation">
      <div className="glass overflow-hidden">
        {claim.frameUrls.length ? (
          <div className="relative bg-black">
            <AnimatePresence mode="wait">
              <motion.div key={frame} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={claim.frameUrls[frame]} alt={`Frame ${frame}`} className="aspect-video w-full object-contain" data-testid="frame-large" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  {boxesFor(frame).map((b, k) => (
                    <g key={k}>
                      <motion.rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} fill="none" stroke="#fbbf24" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.6 }} />
                      <text x={b.x * 100} y={b.y * 100 - 1} fill="#fbbf24" fontSize="3">{b.label} (approximate)</text>
                    </g>
                  ))}
                </svg>
              </motion.div>
            </AnimatePresence>
            {claim.videoUrl ? <video ref={videoRef} src={claim.videoUrl} controls muted playsInline className="absolute bottom-2 right-2 w-40 rounded border border-white/20 opacity-90" data-testid="claim-video" /> : null}
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-black/40 p-6 text-center text-sm text-ink-soft-dark">
            {claim.kind === "simulated" ? "Simulated refund: claim text and timing only, no video." : claim.status === "awaiting_video" ? "Waiting for the shopper's video…" : "No frames."}
          </div>
        )}
        {claim.frameUrls.length ? (
          <div className="scroll-thin flex gap-1.5 overflow-x-auto p-2" data-testid="frame-strip">
            {claim.frameUrls.map((u, i) => (
              <button key={u} onClick={() => onFrame(i)} className={`relative shrink-0 overflow-hidden rounded border-2 ${i === frame ? "border-accent" : "border-transparent"}`} data-testid={`frame-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Frame ${i}`} className="h-14 w-24 object-cover" />
                <span className="absolute left-1 top-0.5 font-mono text-[0.6rem] text-white drop-shadow">{i}{boxesFor(i).length ? " ◆" : ""}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="check-chips">
        <Chip ok={checks.fresh} label="Freshness" detail={checks.uploaded_after_s !== undefined ? `uploaded ${checks.uploaded_after_s}s after the claim` : undefined} />
        <Chip ok={checks.duration_ok && checks.resolution_ok} label="Duration and resolution" detail={checks.duration_s ? `${checks.duration_s}s · ${checks.width}×${checks.height}` : undefined} />
        <Chip ok={checks.frame_reuse ? checks.frame_reuse.length === 0 : undefined} label="Frame reuse" detail={checks.frame_reuse?.length ? `matches ${checks.frame_reuse.map((r) => r.matches_claim).join(", ")}` : "no match in other claims"} />
        <Chip ok={checks.within_window !== undefined ? checks.within_window && checks.reason_allowed !== false : undefined} label="Policy fit" detail={checks.policy_line} />
        {checks.blank_frames ? <Chip ok={false} label="Blank frames" detail={`${checks.blank_frames} of ${claim.frameUrls.length}`} /> : null}
        {checks.still_image ? <Chip ok={false} label="Little motion" detail={`frames barely change (median difference ${checks.frame_motion} of 64 bits)`} /> : null}
      </div>

      {checks.frame_reuse?.length ? (
        <div className="glass border-fraud/40 p-3 text-sm" data-testid="reuse-panel">
          {checks.frame_reuse.map((r) => {
            const other = claims.find((c) => `C-${c.id}` === r.matches_claim);
            return (
              <div key={r.matches_claim} className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-fraud">Matches frames from claim {r.matches_claim}</span>
                <span className="text-xs text-ink-soft-dark">frame {r.frame} ≈ frame {r.matches_frame} (dHash distance {r.distance})</span>
                <div className="flex gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={claim.frameUrls[r.frame]} alt="this claim" className="h-12 w-20 rounded object-cover" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {other?.frameUrls[r.matches_frame] ? <img src={other.frameUrls[r.matches_frame]} alt={r.matches_claim} className="h-12 w-20 rounded object-cover" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="glass p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="panel-title">Evidence Analyst findings</span>
          {analyst ? <Badge kind={analyst.provenance === "fixture" ? "fixture" : analyst.provenance === "replay" ? "replay" : "live"} /> : null}
        </div>
        {ev.offline ? <p className="text-sm text-review">Investigator offline: request more evidence or review by hand.</p> : null}
        {ev.summary ? <p className="text-sm">{ev.summary}</p> : !ev.offline ? <p className="text-sm text-ink-soft-dark">{claim.status === "investigating" ? "The Evidence Analyst is reviewing the frames…" : "No findings yet."}</p> : null}
        {ev.summary ? <p className="mt-1 text-[0.7rem] text-ink-soft-dark">Internally consistent, not proof of authenticity.</p> : null}
        <ul className="mt-2 space-y-1 text-sm">
          {ev.item_matches_reference ? <li>Item matches reference: <b>{String(ev.item_matches_reference.value)}</b> ({ev.item_matches_reference.confidence ?? "?"})</li> : null}
          {ev.claimed_defect_visible ? (
            <li>Claimed defect visible: <b>{String(ev.claimed_defect_visible.value)}</b>{ev.claimed_defect_visible.frames?.length ? <> in frames {ev.claimed_defect_visible.frames.map((f) => <button key={f} className="mx-0.5 text-accent underline" onClick={() => onFrame(f)}>{f}</button>)}</> : null}</li>
          ) : null}
          {ev.challenge ? <li>Finger challenge: expected {claim.fingerCount}, seen {ev.challenge.seen ?? "none"} → <b className={ev.challenge.passed ? "text-honest" : "text-fraud"}>{ev.challenge.passed ? "passed" : "failed"}</b></li> : null}
          {ev.capture_flags?.length ? <li>Capture flags: {ev.capture_flags.map((f) => <span key={f} className="chip chip--review mr-1">{f.replaceAll("_", " ")}</span>)}</li> : null}
          {ev.frames?.map((f) => (
            <li key={f.index}><button className="text-left hover:text-accent" onClick={() => onFrame(f.index)}><span className="font-mono text-xs text-ink-soft-dark">frame {f.index}</span> {f.observation}</button></li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass p-3 text-sm" data-testid="transaction">
          <div className="panel-title mb-2">Transaction <Badge kind={refund.source === "sim" ? "simulated" : "live"} /></div>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-ink-soft-dark">Item</dt><dd>{item?.name ?? "?"} ({money(purchase?.amount ?? refund.amount)})</dd>
            <dt className="text-ink-soft-dark">Business</dt><dd>{businessDef(refund.businessId)?.name} ({businessLabel(refund.businessId)})</dd>
            <dt className="text-ink-soft-dark">Days</dt><dd>bought {purchase?.day ?? "?"}, delivered {purchase?.deliverDay || "?"}, claimed {refund.day}</dd>
            <dt className="text-ink-soft-dark">Reason</dt><dd>{titleCase(refund.reasonCode)}</dd>
            <dt className="text-ink-soft-dark">Claim text</dt><dd className="italic">“{refund.reasonText}”</dd>
          </dl>
        </div>
        <AgentMini agentId={refund.agentId} />
      </div>

      <CredentialStepper refundId={refund.id} />
    </div>
  );
}

function Chip({ ok, label, detail }: { ok: boolean | undefined; label: string; detail?: string }) {
  const cls = ok === undefined ? "chip" : ok ? "chip chip--honest" : "chip chip--fraud";
  return <span className={cls} title={detail}>{ok === undefined ? "○" : ok ? "✓" : "✕"} {label}{detail ? <span className="font-normal opacity-80"> · {detail}</span> : null}</span>;
}

function AgentMini({ agentId }: { agentId: number }) {
  const [rows] = useTable(tables.agent.where((r) => r.id.eq(agentId)));
  const [credits] = useTable(tables.creditEvent.where((r) => r.agentId.eq(agentId)));
  const a = rows[0];
  const series = useMemo(() => [...credits].sort((x, y) => Number(x.id - y.id)).map((c) => ({ s: c.after })), [credits]);
  return (
    <div className="glass p-3 text-sm" data-testid="agent-mini">
      <div className="panel-title mb-2">Customer {agentLabel(agentId)} <Badge kind={agentId > 900000 ? "live" : "simulated"} /></div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">{a?.score ?? "…"}</div>
          <div className="text-xs text-ink-soft-dark">{a?.band} band · {a?.purchases ?? 0} purchases · {a?.refunds ?? 0} refunds{a && a.purchases ? ` (${Math.round((a.refunds / a.purchases) * 100)}% ratio)` : ""}</div>
        </div>
        <div className="h-12 w-40">
          {series.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}><YAxis hide domain={["dataMin - 10", "dataMax + 10"]} /><Line dataKey="s" stroke="#22d3ee" dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart>
            </ResponsiveContainer>
          ) : <span className="text-xs text-ink-soft-dark">no credit history yet</span>}
        </div>
      </div>
    </div>
  );
}
