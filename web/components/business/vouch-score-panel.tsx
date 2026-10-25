"use client";

import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim, Refund } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";

const OPEN = ["requested", "investigating", "recommended", "awaiting_controller", "more_evidence"];

/** The shopper's live Vouch score and the CREAO score review for this claim's refund. */
export function VouchScorePanel({ claim, refund, hasJob }: { claim: Claim; refund: Refund; hasJob: boolean }) {
  const [agents] = useTable(tables.agent.where((r) => r.id.eq(claim.agentId)));
  const [reviews] = useTable(tables.scoreReview.where((r) => r.refundId.eq(claim.refundId)));
  const agent = agents[0];
  const review = reviews[0];
  const open = OPEN.includes(refund.status);
  const reviewPending = open && (hasJob || ["investigating", "recommended", "frames_ready"].includes(claim.status));
  const waitingVideo = claim.status === "awaiting_video";
  return (
    <div data-testid="vouch-score-panel">
      <span className="panel-title">Confirmed Vouch history</span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold" data-testid="claim-score">
          {agent?.score ?? "—"}
        </span>
        <span className="text-sm text-ink-soft-dark">/ 1000 · {agent?.band ?? "…"}</span>
        <Badge kind="live" />
      </div>
      {(reviewPending || waitingVideo) && !review ? (
        <p className="mt-2 text-sm text-review">
          Review pending. The score moves once CREAO reaches a verdict, and not while the claim is on hold.
        </p>
      ) : review ? (
        <div className="mt-2 text-sm" data-testid="claim-score-review">
          <p className={review.direction === "gain" ? "text-honest" : review.direction === "loss" ? "text-fraud" : "text-ink-soft-dark"}>
            {review.direction === "gain" ? "Gained credibility" : review.direction === "loss" ? "Lost credibility" : "No change"}: {review.before} → {review.after} ({review.delta >= 0 ? "+" : ""}{review.delta})
          </p>
          <p className="mt-0.5">{review.reason}</p>
          <p className="mt-0.5 text-xs text-ink-soft-dark">{review.provenance === "rule" ? "Rule (no CREAO seat answered)" : review.provenance.startsWith("panel") ? `CREAO panel: Refund Investigator + Risk Scorecard${review.provenance === "panel_fixture" ? " (fixture)" : ""}` : `CREAO Score Reviewer${review.provenance === "fixture" ? " (fixture)" : ""}`}</p>
        </div>
      ) : !open ? (
        <p className="mt-2 text-sm text-ink-soft-dark">Decision recorded. The CREAO Score Reviewer is judging the score change…</p>
      ) : (
        <p className="mt-2 text-sm text-ink-soft-dark">No score change yet for this claim.</p>
      )}
    </div>
  );
}
