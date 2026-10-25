"use client";

import { useDemo } from "@/lib/demo/demo-store";
import {
  formatMoney,
  scoreLabel,
  STATUS_LABEL,
  type ClaimStatus,
  type DemoClaim,
} from "@/lib/demo/claims";
import { DEMO_MERCHANT } from "@/lib/demo/config";

const STATUS_CHIP: Record<ClaimStatus, string> = {
  queued: "chip",
  ready_to_approve: "chip chip--honest",
  needs_review: "chip chip--review",
  policy_block: "chip chip--fraud",
  approved: "chip chip--honest",
  declined: "chip chip--fraud",
  more_evidence: "chip chip--review",
};

export function MerchantDemo() {
  const { claims, selected, select, decide, simulateIncoming, resetDemo, handoffClaimId } = useDemo();

  return (
    <section className="section journey-section journey-demo" id="demo" data-testid="merchant-demo">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section__eyebrow">Interactive merchant demo</p>
          <h2 className="section__title">Operate the control room.</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Seeded fixture claims for {DEMO_MERCHANT.name}. Select a case, inspect evidence, then decide.
            Scores change only on confirmed outcomes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn--glow"
            data-testid="simulate-incoming"
            onClick={() => simulateIncoming()}
          >
            Simulate incoming claim
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => resetDemo()} data-testid="reset-demo">
            Reset demo
          </button>
        </div>
      </div>

      <div className="merchant-board" data-testid="merchant-board">
        <aside className="merchant-inbox" aria-label="Request inbox">
          <div className="merchant-inbox__head">
            <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
              Inbox
            </span>
            <span className="badge badge--fixture">Fixture</span>
          </div>
          <ul className="merchant-inbox__list">
            {claims.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`inbox-row ${selected.id === c.id ? "inbox-row--active" : ""} ${c.id === handoffClaimId ? "inbox-row--live" : ""}`}
                  onClick={() => select(c.id)}
                  data-testid={`inbox-${c.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.id}</span>
                    <span className={STATUS_CHIP[c.status]}>{STATUS_LABEL[c.status]}</span>
                  </div>
                  <div className="text-sm text-ink-soft">{c.customerName} · {formatMoney(c.amountCents)}</div>
                  <div className="text-xs text-ink-soft">{c.reason}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <ClaimDetail claim={selected} onDecide={decide} />
      </div>
    </section>
  );
}

function ClaimDetail({
  claim,
  onDecide,
}: {
  claim: DemoClaim;
  onDecide: (a: "approve" | "decline" | "more_evidence") => void;
}) {
  const resolved = claim.status === "approved" || claim.status === "declined";

  return (
    <div className="claim-detail" data-testid="claim-detail">
      <header className="claim-detail__head">
        <div>
          <p className="panel-title" style={{ color: "var(--ink-soft)" }}>
            {claim.orderId} · {claim.customerName}
          </p>
          <h3 className="text-xl font-bold tracking-tight">{claim.reason}</h3>
          <p className="text-sm text-ink-soft">{claim.customerNote}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{formatMoney(claim.amountCents)}</div>
          <span className={STATUS_CHIP[claim.status]}>{STATUS_LABEL[claim.status]}</span>
        </div>
      </header>

      <div className="claim-grid">
        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Video</span>
          <div className="video-placeholder" data-testid="video-placeholder">
            <span>{claim.videoLabel}</span>
            <span className="text-xs text-ink-soft">Placeholder — customer app supplies the real file</span>
          </div>
          <span className="panel-title mt-4 block" style={{ color: "var(--ink-soft)" }}>Transcript</span>
          <p className="claim-transcript">&ldquo;{claim.transcript}&rdquo;</p>
        </div>

        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Ordered vs observed</span>
          <div className="compare-pair">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Ordered</div>
              <div className="mt-1 font-semibold" data-testid="item-ordered">{claim.itemOrdered}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Observed &amp; described</div>
              <div className="mt-1 font-semibold text-amber-800" data-testid="item-observed">{claim.itemObserved}</div>
            </div>
          </div>
          {claim.analysisFlag ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>Analysis flag:</strong> {claim.analysisFlag}
              <span className="mt-1 block text-xs">Does not change the Vouch score by itself.</span>
            </p>
          ) : null}
        </div>

        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Policy check</span>
          <p className={`text-sm font-semibold ${claim.policyResult.ok ? "text-emerald-700" : "text-red-700"}`}>
            {claim.policyResult.ok ? "In policy" : "Outside policy"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{claim.policyResult.summary}</p>
        </div>

        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Vouch history</span>
          <p className="text-lg font-bold" data-testid="vouch-score">{scoreLabel(claim.scoreBefore)}</p>
          <ul className="mt-2 space-y-1.5">
            {claim.history.length === 0 ? (
              <li className="text-sm text-ink-soft">No confirmed outcomes yet — fair standard review path.</li>
            ) : (
              claim.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-2 text-sm">
                  <span>
                    <span className="text-ink-soft">{h.at}</span> · {h.summary}
                  </span>
                  <span className="font-mono text-xs">
                    {h.delta == null ? "—" : h.delta > 0 ? `+${h.delta}` : h.delta}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="claim-panel claim-panel--wide">
        <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Decision explanation</span>
        <p className="mt-1 text-sm leading-relaxed">{claim.decisionNote}</p>
      </div>

      <div className="claim-actions">
        <button
          type="button"
          className="btn btn--honest"
          disabled={resolved || !claim.policyResult.ok}
          onClick={() => onDecide("approve")}
          data-testid="decide-approve"
          title={!claim.policyResult.ok ? "Outside policy — use decline with explanation" : undefined}
        >
          Approve refund
        </button>
        <button
          type="button"
          className="btn btn--review"
          disabled={resolved}
          onClick={() => onDecide("more_evidence")}
          data-testid="decide-more"
        >
          Request more evidence
        </button>
        <button
          type="button"
          className="btn btn--fraud"
          disabled={resolved}
          onClick={() => onDecide("decline")}
          data-testid="decide-decline"
        >
          Decline with explanation
        </button>
      </div>
    </div>
  );
}
