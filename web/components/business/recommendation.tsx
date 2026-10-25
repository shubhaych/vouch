"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim, Decision, Evidence, Refund } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useCall } from "@/lib/stdb/hooks";
import { money, titleCase } from "@/lib/format";
import { parse } from "./investigation";

const MATERIALITY = 50_000;
interface Reason { text: string; cites: string }
interface InvJson { what_would_change_my_mind?: string; history_considered?: string; message_to_customer?: string; needs_controller?: boolean }

const latestProposal = (decisions: readonly Decision[]) => [...decisions].filter((d) => d.status !== "superseded").sort((a, b) => Number(b.id - a.id))[0];

/** The CREAO Refund Investigator's recommendation, for claims the video reviewer does not handle. */
export function RecommendationCard({ claim, refund, decisions, evidence, seatRole, seatBusiness, onFrame }: {
  claim: Claim; refund: Refund; decisions: readonly Decision[]; evidence: readonly Evidence[]; seatRole: string | null; seatBusiness: number; onFrame: (i: number) => void;
}) {
  const proposal = latestProposal(decisions);
  const inv = evidence.find((e) => e.seat === "refund_investigator");
  const analyst = evidence.find((e) => e.seat === "evidence_analyst");
  const extra = parse<InvJson>(inv?.json, {});
  const reasons = parse<Reason[]>(proposal?.reasonsJson, []);
  const offline = claim.status === "offline";
  const citeClick = (c: string) => {
    const m = c.match(/^frame:(\d+)/);
    if (m) onFrame(Number(m[1]));
  };

  return (
    <motion.aside initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass space-y-3 p-4" data-testid="recommendation">
      <div className="flex items-center justify-between">
        <span className="panel-title">Refund Investigator recommends</span>
        {inv ? <Badge kind={inv.provenance === "fixture" ? "fixture" : inv.provenance === "replay" ? "replay" : "live"} /> : null}
      </div>
      {offline && !proposal ? (
        <div className="rounded-lg border border-review/50 bg-review/10 p-3 text-sm" data-testid="offline-note">
          <b>Investigator offline</b>: request more evidence or review by hand. With the CREAO agents off, nothing can be accepted or declined here.
        </div>
      ) : !proposal ? (
        <p className="text-sm text-ink-soft-dark">{claim.status === "awaiting_video" ? "Waiting for the shopper's video." : "The investigators are working: runs take a minute or more."}</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-2xl font-bold ${proposal.action === "accept" ? "text-honest" : proposal.action === "decline" ? "text-fraud" : "text-review"}`} data-testid="rec-action">{titleCase(proposal.action)}</span>
            <span className="text-right text-sm">{proposal.action === "accept" ? `${money(proposal.amount)} · ${titleCase(proposal.method)}` : ""}</span>
          </div>
          <div>
            <div className="flex justify-between text-xs text-ink-soft-dark"><span>Confidence</span><span>{Math.round(proposal.confidence * 100)}%</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(proposal.confidence * 100)}%` }} /></div>
          </div>
          <ol className="space-y-1.5 text-sm">
            {reasons.map((r, i) => (
              <li key={i} className="flex min-w-0 flex-col items-start gap-0.5">
                <button className="chip chip--accent block max-w-full truncate font-mono text-[0.65rem]" onClick={() => citeClick(r.cites)} title={r.cites}>{r.cites}</button>
                <span className="min-w-0 [overflow-wrap:anywhere]">{r.text}</span>
              </li>
            ))}
          </ol>
          {extra.what_would_change_my_mind ? <p className="text-xs text-ink-soft-dark"><b>What would change my mind:</b> {extra.what_would_change_my_mind}</p> : null}
          {extra.history_considered ? <p className="text-xs text-ink-soft-dark"><b>History:</b> {extra.history_considered}</p> : null}
          <div className="flex flex-wrap gap-3 text-xs">
            {analyst?.runUrl ? <a className="text-accent underline" href={analyst.runUrl} target="_blank" rel="noreferrer">Evidence Analyst run</a> : analyst?.runId ? <span className="font-mono text-ink-soft-dark">EA run {analyst.runId.slice(0, 14)}</span> : null}
            {proposal.runUrl ? <a className="text-accent underline" href={proposal.runUrl} target="_blank" rel="noreferrer">Investigator run</a> : <span className="font-mono text-ink-soft-dark">RI run {proposal.runId.slice(0, 14)}</span>}
          </div>
        </>
      )}
      <div className="border-t border-line-dark pt-3">
        <DecisionActions claim={claim} refund={refund} decisions={decisions} seatRole={seatRole} seatBusiness={seatBusiness} />
      </div>
    </motion.aside>
  );
}

/**
 * Accept, decline or ask for the extra clip, plus the decided state. The proposer can never decide
 * (the module enforces it); `acceptCents` lets the main recommendation set the amount offered.
 */
export function DecisionActions({ claim, refund, decisions, seatRole, seatBusiness, acceptCents }: {
  claim: Claim; refund: Refund; decisions: readonly Decision[]; seatRole: string | null; seatBusiness: number; acceptCents?: number;
}) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const proposal = latestProposal(decisions);
  const [entries] = useTable(tables.journalEntry.where((r) => r.decisionId.eq(proposal?.id ?? 0n)), { enabled: !!proposal });
  const [credits] = useTable(tables.creditEvent.where((r) => r.causeTable.eq("refund")).where((r) => r.causeId.eq(refund.id)));
  const toasted = useRef(new Set<string>());
  const open = ["investigating", "recommended", "awaiting_controller", "more_evidence"].includes(refund.status);
  const isController = seatRole === "controller";
  const wrongBusiness = seatRole === "business" && seatBusiness !== refund.businessId;
  const amount = acceptCents || proposal?.amount || refund.amount;
  const needsController = amount > MATERIALITY;
  // The customer gets one extra clip; after that, more evidence can only come from a person reviewing what is there.
  const clips = parse<{ clips?: number }>(claim.checksJson, {}).clips ?? 1;
  const extraUsed = !!claim.videoUrl && clips >= 2;
  const extraPending = claim.status === "more_evidence" && !!claim.videoUrl && !extraUsed;

  // After a decision: the journal entry and the credit change, as the spec's toast.
  useEffect(() => {
    const e = entries[0];
    const c = credits[0];
    if (e && c && !toasted.current.has(`${e.id}`)) {
      toasted.current.add(`${e.id}`);
      toast(`Journal entry #${e.id} posted (${money(proposal?.finalAmount ?? 0)}) · credit ${c.before} → ${c.after}`, "honest");
    }
  }, [entries, credits, proposal]);

  const decide = async (action: "accept" | "decline" | "more_evidence") => {
    setBusy(true);
    await call("decide", (r) => r.decide({ refundId: refund.id, action, amount: action === "accept" ? amount : 0, note: "" }),
      action === "accept" ? (needsController && !isController ? "Sent to the controller (above $500)" : `Accepted ${money(amount)}`) : action === "decline" ? "Declined" : "Asked the shopper for an extra clip");
    setBusy(false);
  };

  if (!open) return (
    <div className="space-y-2 text-sm" data-testid="decided">
      <div>
        Decided: <b>{titleCase(refund.status)}</b>{refund.status === "accepted" ? ` ${money(refund.amount)}` : ""}
        {entries[0] ? <span className="text-xs text-ink-soft-dark"> · journal entry #{entries[0].id.toString()} posted</span> : null}
      </div>
      <ScoreChange refundId={refund.id} />
    </div>
  );
  return (
    <div className="space-y-2" data-testid="decision-actions">
      {!seatRole ? <p className="text-xs text-review">Take the business seat (top of the page) to decide.</p> : wrongBusiness ? <p className="text-xs text-review">This refund belongs to another store: switch business to decide.</p> : null}
      {refund.status === "awaiting_controller" && !isController ? <p className="text-xs text-review">Waiting for the controller: accepting more than $500 needs their approval.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn--honest btn--sm" disabled={busy || !seatRole || wrongBusiness || !proposal || (refund.status === "awaiting_controller" && !isController)} onClick={() => void decide("accept")} data-testid="decide-accept">
          {needsController && !isController ? "Send to controller" : isController && refund.status === "awaiting_controller" ? `Approve ${money(amount)}` : `Accept ${money(amount)}`}
        </button>
        <button className="btn btn--fraud btn--sm" disabled={busy || !seatRole || wrongBusiness || !proposal} onClick={() => void decide("decline")} data-testid="decide-decline">Decline</button>
        <button className="btn btn--review btn--sm" disabled={busy || !seatRole || wrongBusiness || extraUsed || extraPending} title={extraUsed ? "The customer has already sent their one extra clip" : extraPending ? "An extra clip is already requested" : undefined} onClick={() => void decide("more_evidence")} data-testid="decide-more">{extraUsed ? "Extra clip already used" : "Request an extra clip"}</button>
      </div>
    </div>
  );
}

const DIRECTION = {
  gain: { label: "Gained credibility", cls: "text-honest", sign: "+" },
  loss: { label: "Lost credibility", cls: "text-fraud", sign: "" },
  same: { label: "No change", cls: "text-ink-soft-dark", sign: "±" },
} as const;
const JUDGE: Record<string, string> = { live: "CREAO Score Reviewer", fixture: "CREAO Score Reviewer (fixture)", rule: "Rule (Score Reviewer agent not connected)" };

/** The shopper's Vouch score after this claim, as the CREAO Score Reviewer judged it, with its one-line reason. */
function ScoreChange({ refundId }: { refundId: bigint }) {
  const [rows] = useTable(tables.scoreReview.where((r) => r.refundId.eq(refundId)));
  const r = rows[0];
  if (!r) return <p className="text-xs text-ink-soft-dark" data-testid="score-pending">Vouch score: waiting for the CREAO Score Reviewer…</p>;
  const d = DIRECTION[r.direction as keyof typeof DIRECTION] ?? DIRECTION.same;
  return (
    <div className="rounded-lg border border-line-dark p-2.5" data-testid="score-change">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs text-ink-soft-dark">Shopper Vouch score</span>
        <span className="font-mono">{r.before} → <b>{r.after}</b></span>
        <span className={`font-semibold ${d.cls}`}>{d.label} ({d.sign}{r.delta})</span>
      </div>
      <p className="mt-1 text-sm">{r.reason}</p>
      <p className="mt-0.5 text-[0.7rem] text-ink-soft-dark">Judged by {JUDGE[r.provenance] ?? r.provenance}{r.runId ? ` · run ${r.runId.slice(0, 14)}` : ""}</p>
    </div>
  );
}
