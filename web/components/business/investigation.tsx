"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim, Evidence, Purchase, Refund } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { agentLabel, businessLabel, money, titleCase } from "@/lib/format";
import { businessDef, catalogItem } from "@vouch/module/world";
import { CredentialStepper } from "./credential-stepper";
import { IdentityCard } from "./identity-card";
import { mediaUrl } from "@/lib/stdb/config";
import { AgentCards, AgentLanes, MetricGrid, SafeVideo, hms, seatFlow, type Moment } from "./agent-flow";

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
  const ev = parse<EvidenceJson>(analyst?.json, {});
  const checks = parse<Checks>(claim.checksJson, {});
  const item = purchase ? catalogItem(purchase.item) : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoOk, setVideoOk] = useState(false);
  const [claims] = useTable(tables.claim);
  const [decisions] = useTable(tables.decision.where((r) => r.refundId.eq(refund.id)));
  const [scores] = useTable(tables.scoreReview.where((r) => r.refundId.eq(refund.id)));
  const [shoppers] = useTable(tables.agent.where((r) => r.id.eq(refund.agentId)));
  const [runs] = useTable(tables.agentRun.where((r) => r.caseRef.eq(`C-${claim.id}`)));
  const proposal = [...decisions].filter((d) => d.status !== "superseded").sort((a, b) => Number(b.id - a.id))[0];
  const flow = useMemo(() => seatFlow({ claim, evidence, proposal, review: scores[0], shopper: shoppers[0], runs }), [claim, evidence, proposal, scores, shoppers, runs]);
  const frames = claim.frameUrls.map(mediaUrl);
  // Frames that fail to load are dropped, and the viewer goes away when none load, so nothing broken is shown.
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const markBad = (u: string) => setBad((b) => new Set(b).add(u));
  const ok = frames.map((u, i) => ({ u, i })).filter((f) => !bad.has(f.u));
  const shown = bad.has(frames[frame] ?? "") ? ok[0]?.i ?? frame : frame;
  const boxesFor = (i: number) => (flow.contributors.some((c) => c.key === "evidence_analyst") ? ev.frames?.find((f) => f.index === i)?.boxes ?? [] : []);
  const duration = checks.duration_s ?? checks.frame_times?.at(-1) ?? 0;
  // A moment from an agent shows the frame it cited; the video follows through the effect below.
  const onMoment = (m: Moment) => { if (m.frame !== undefined) onFrame(m.frame); };

  useEffect(() => {
    const t = checks.frame_times?.[frame];
    if (videoOk && videoRef.current && t !== undefined) videoRef.current.currentTime = t;
  }, [frame, checks.frame_times, videoOk]);

  return (
    <div className="space-y-4" data-testid="investigation">
      <MetricGrid metrics={flow.metrics} contributors={flow.contributors} onMoment={ok.length ? onMoment : undefined} />

      {ok.length ? (
        <div className="glass overflow-hidden">
          <div className="relative bg-black">
            <AnimatePresence mode="wait">
              <motion.div key={shown} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frames[shown]} alt={`Frame ${shown}`} onError={() => markBad(frames[shown]!)} className="aspect-video w-full object-contain" data-testid="frame-large" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  {boxesFor(shown).map((b, k) => (
                    <g key={k}>
                      <motion.rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} fill="none" stroke="var(--marigold)" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.6 }} />
                      <text x={b.x * 100} y={b.y * 100 - 1} fill="var(--marigold)" fontSize="3">{b.label} (approximate)</text>
                    </g>
                  ))}
                </svg>
              </motion.div>
            </AnimatePresence>
            {checks.frame_times?.[shown] !== undefined ? <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">{hms(checks.frame_times[shown]!)}</span> : null}
            <SafeVideo videoRef={videoRef} src={claim.videoUrl ? mediaUrl(claim.videoUrl) : undefined} onReady={setVideoOk} controls muted
              className="absolute bottom-2 right-2 w-40 rounded border border-white/20 opacity-90" data-testid="claim-video" />
          </div>
          <div className="scroll-thin flex gap-1.5 overflow-x-auto p-2" data-testid="frame-strip">
            {ok.map(({ u, i }) => (
              <button key={u} onClick={() => onFrame(i)} className={`relative shrink-0 overflow-hidden rounded border-2 ${i === shown ? "border-accent" : "border-transparent"}`} data-testid={`frame-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Frame ${i}`} onError={() => markBad(u)} className="h-14 w-24 object-cover" />
                <span className="absolute left-1 top-0.5 font-mono text-[0.6rem] text-white drop-shadow">{checks.frame_times?.[i] !== undefined ? hms(checks.frame_times[i]!) : i}{boxesFor(i).length ? " ◆" : ""}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-line-dark p-3">
            <AgentLanes contributors={flow.contributors} duration={duration} onMoment={onMoment} />
          </div>
        </div>
      ) : null}

      <AgentCards contributors={flow.contributors} metrics={flow.metrics} onMoment={ok.length ? onMoment : undefined} />

      <div className="flex flex-wrap gap-1.5" data-testid="check-chips">
        {checks.fresh !== undefined ? <Chip ok={checks.fresh} label="Freshness" detail={checks.uploaded_after_s !== undefined ? `uploaded ${checks.uploaded_after_s}s after the claim` : undefined} /> : null}
        {checks.duration_ok !== undefined ? <Chip ok={checks.duration_ok && checks.resolution_ok} label="Duration and resolution" detail={checks.duration_s ? `${checks.duration_s}s · ${checks.width}×${checks.height}` : undefined} /> : null}
        {checks.frame_reuse ? <Chip ok={checks.frame_reuse.length === 0} label="Frame reuse" detail={checks.frame_reuse.length ? `matches ${checks.frame_reuse.map((r) => r.matches_claim).join(", ")}` : "no match in other claims"} /> : null}
        {checks.within_window !== undefined ? <Chip ok={checks.within_window && checks.reason_allowed !== false} label="Policy fit" detail={checks.policy_line} /> : null}
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
                  <img src={frames[r.frame]} alt="this claim" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-12 w-20 rounded object-cover" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {other?.frameUrls[r.matches_frame] ? <img src={mediaUrl(other.frameUrls[r.matches_frame]!)} alt={r.matches_claim} onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-12 w-20 rounded object-cover" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

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

      <IdentityCard refundId={refund.id} />
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
              <LineChart data={series}><YAxis hide domain={["dataMin - 10", "dataMax + 10"]} /><Line dataKey="s" stroke="var(--marigold)" dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart>
            </ResponsiveContainer>
          ) : <span className="text-xs text-ink-soft-dark">no credit history yet</span>}
        </div>
      </div>
    </div>
  );
}
