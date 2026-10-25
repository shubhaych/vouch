"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { AnalysisStep, ScoreReview } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { Recorder } from "./recorder";
import { agentLabel, money, titleCase } from "@/lib/format";
import { hintFromProps, type HintProps } from "@/lib/claim-link";
import { businessDef, catalogItem } from "@vouch/module/world";
import { companyById } from "@vouch/module/finance/companies";
import { STEP_KEYS, STEP_LABEL } from "@vouch/module/review-types";


export function ClaimView({ idParam, hint: hintProps }: { idParam: string; hint: HintProps }) {
  const id = /^\d+$/.test(idParam) ? BigInt(idParam) : 0n;
  const hint = hintFromProps(hintProps);
  const [claims, ready] = useTable(tables.claim.where((r) => r.id.eq(id)));
  const claim = claims[0];
  // With the QR link's ids, the refund, purchase and agent rows are asked for at once instead of one after another.
  const refundId = claim?.refundId ?? hint?.refundId ?? 0n;
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(refundId)), { enabled: refundId !== 0n });
  const refund = refunds.find((r) => r.id === refundId); // rows from a superseded query can linger for a moment
  const purchaseId = refund?.purchaseId ?? hint?.purchaseId ?? 0n;
  const [purchases] = useTable(tables.purchase.where((r) => r.id.eq(purchaseId)), { enabled: purchaseId !== 0n });
  const purchase = purchases.find((r) => r.id === purchaseId);
  const agentId = claim?.agentId ?? hint?.agentId ?? 0;
  const [agents] = useTable(tables.agent.where((r) => r.id.eq(agentId)), { enabled: agentId !== 0 });
  const agent = agents.find((r) => r.id === agentId);
  const [runs] = useTable(tables.agentRun.where((r) => r.caseRef.eq(`C-${id}`)));
  const [decisions] = useTable(tables.decision.where((r) => r.refundId.eq(refundId)), { enabled: refundId !== 0n });
  const [credits] = useTable(tables.creditEvent.where((r) => r.causeTable.eq("refund")).where((r) => r.causeId.eq(refundId)), { enabled: refundId !== 0n });
  const [scoreReviews] = useTable(tables.scoreReview.where((r) => r.refundId.eq(refundId)), { enabled: refundId !== 0n });
  const scoreReview = scoreReviews.find((r) => r.refundId === refundId);
  const [jobs] = useTable(tables.analysisJob.where((r) => r.claimId.eq(id)));
  const job = [...jobs].sort((a, b) => Number(b.id - a.id))[0];
  const [analysisSteps] = useTable(tables.analysisStep.where((r) => r.jobId.eq(job?.id ?? 0n)), { enabled: !!job });
  // A partner company's product: its own listing names the item and the store, not the stand-in it was routed through.
  const [partnerRows] = useTable(tables.partnerOrder.where((r) => r.purchaseId.eq(purchaseId)), { enabled: purchaseId !== 0n });
  const partnerRow = partnerRows.find((r) => r.purchaseId === purchaseId);
  const partnerDef = hint?.partnerCompany ? companyById(hint.partnerCompany) : undefined;
  const partnerProduct = partnerDef?.products.find((p) => p.sku === hint?.partnerSku);
  const partner = partnerRow ? { name: partnerRow.name, store: partnerRow.companyName } : partnerProduct && partnerDef ? { name: partnerProduct.name, store: partnerDef.name } : null;
  const sku = purchase?.item ?? hint?.sku;
  const item = partner ? { name: partner.name } : sku !== undefined ? catalogItem(sku) : undefined;
  const ordered = partner ? partnerProduct?.description : sku !== undefined ? catalogItem(sku)?.description : undefined;
  const businessId = purchase?.business ?? hint?.business;

  // Until the live rows arrive, the link's values stand in; the recorder sits at the same place either way,
  // so a recording already under way is not lost when the connection catches up.
  const early = !claim && !ready && !!hint;
  if (!claim && !early) {
    if (!ready) return <Shell><div className="skeleton h-40 w-full" /></Shell>;
    return <Shell><p className="text-sm text-ink-soft">No claim C-{idParam}. Open the claim from the QR code on the shop page.</p></Shell>;
  }
  const nonce = claim?.nonce ?? hint!.nonce;
  const fingers = claim?.fingerCount ?? hint!.fingers;
  const status = claim?.status ?? "awaiting_video";
  const frameCount = claim?.frameUrls.length ?? 0;
  const amount = refund?.amount ?? hint?.cents;
  const reason = refund?.reasonCode ?? hint?.reason;

  // A claim holds the claim video plus at most one extra clip; the worker refuses a third.
  const clips = parseClips(claim?.checksJson ?? "{}");
  const asks = extraAsks(decisions);
  const ev = runs.find((r) => r.seat === "evidence_analyst");
  const inv = runs.find((r) => r.seat === "refund_investigator");
  const proposal = [...decisions].sort((a, b) => Number(b.id - a.id))[0];
  const decided = refund && ["accepted", "declined"].includes(refund.status);
  const stage = decided ? 6 : proposal ? 5 : inv ? 4 : ev ? 3 : frameCount ? 2 : status === "awaiting_video" ? 0 : 1;
  const steps = [
    { title: "Uploaded", on: stage >= 1 },
    { title: "Frames extracted", on: stage >= 2, sub: frameCount ? `${frameCount} frames` : undefined },
    { title: "Evidence Analyst reviewing", on: stage >= 3, active: ev?.status === "running", sub: ev ? `CREAO · ${ev.mode}` : undefined },
    { title: "Investigator recommending", on: stage >= 4, active: inv?.status === "running", sub: inv ? `CREAO · ${inv.mode}` : undefined },
    { title: "Business deciding", on: stage >= 5, active: stage === 5 },
    { title: "Decision", on: stage >= 6 },
  ];

  return (
    <Shell>
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Claim C-{id.toString()} {early ? <span className="normal-case tracking-normal" data-testid="claim-connecting">· connecting for live progress…</span> : <Badge kind="live" />}</div>
        <h1 className="text-xl font-bold">{item?.name ?? "Your item"}</h1>
        {ordered ? <p className="text-sm" data-testid="claim-ordered"><span className="text-ink-soft">You ordered:</span> {ordered}</p> : null}
        <p className="text-sm text-ink-soft">{[reason ? titleCase(reason) : "", amount !== undefined ? money(amount) : "", partner ? partner.store : businessId !== undefined ? businessDef(businessId)?.name : ""].filter(Boolean).join(" · ")}</p>
        {agentId ? <p className="text-xs text-ink-soft" data-testid="claim-agent">Your agent {agentLabel(agentId)}{agent ? <> · score <span className="font-mono">{agent.score}</span></> : null}</p> : null}
      </div>
      {status === "offline" ? <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">The investigators are offline right now. The business can only ask you for more evidence; nothing is declined automatically.</div> : null}

      {stage === 0 ? <Recorder key="claim-video" claimId={id} nonce={nonce} fingers={fingers} /> : null}
      {claim && status === "more_evidence" && claim.videoUrl ? (
        clips < 2 ? (
          <section className="space-y-2" data-testid="extra-evidence">
            <h2 className="text-base font-bold">Add more evidence</h2>
            <p className="text-sm text-ink-soft">The review needs one more short clip to settle your claim. Nothing has been declined, and your score has not changed. You can send one extra clip.</p>
            <Recorder key="extra-clip" claimId={id} nonce={nonce} fingers={fingers} extra asks={asks} />
          </section>
        ) : (
          <div className="rounded-lg border border-line p-3 text-sm" data-testid="extra-used">You have sent your one extra clip. A person at the store will review your claim.</div>
        )
      ) : null}

      {job ? (
        <ReviewerStepper rows={analysisSteps} decided={!!decided} scoreReview={scoreReview} />
      ) : (
        <ol className="space-y-2" data-testid="claim-stepper">
          {steps.map((s, i) => (
            <motion.li key={s.title} initial={false} animate={{ opacity: s.on || s.active ? 1 : 0.4 }} className="flex items-center gap-3">
              <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.on ? "bg-emerald-500 text-white" : s.active ? "animate-pulse bg-cyan-400 text-white" : "bg-slate-200 text-slate-500"}`}>{s.on ? "✓" : i + 1}</span>
              <span className="text-sm font-medium">{s.title}</span>
              {s.sub ? <span className="text-xs text-ink-soft">{s.sub}</span> : null}
            </motion.li>
          ))}
        </ol>
      )}

      <AnimatePresence>
        {decided && refund ? <DecisionCard status={refund.status} amount={refund.amount} method={proposal?.method ?? ""} credit={credits[0]} scoreReview={scoreReview} /> : null}
      </AnimatePresence>

      <p className="pt-2 text-[0.65rem] text-ink-soft">Challenge nonce {nonce}. Video checks are internally consistent, not proof of authenticity; doubtful claims go to a person.</p>
    </Shell>
  );
}

function parseClips(json: string): number {
  try { return (JSON.parse(json || "{}") as { clips?: number }).clips ?? 1; } catch { return 1; }
}

/** What the latest more-evidence proposal asked the customer to film. */
function extraAsks(decisions: readonly { id: bigint; action: string; reasonsJson: string }[]): string[] {
  const d = [...decisions].filter((x) => x.action === "more_evidence").sort((a, b) => Number(b.id - a.id))[0];
  if (!d) return [];
  try { return (JSON.parse(d.reasonsJson) as { text: string; cites: string }[]).filter((r) => r.cites === "evidence:requested").map((r) => r.text); } catch { return []; }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="light min-h-screen bg-bg px-4 py-6 text-ink" data-testid="claim">
      <div className="card-light mx-auto max-w-md space-y-5 p-5">{children}</div>
    </main>
  );
}

/** Who judged the score change, from the score_review row's provenance. */
const SCORE_JUDGE: Record<string, string> = { live: "CREAO Score Reviewer", fixture: "CREAO Score Reviewer (fixture)", panel_live: "CREAO panel: Refund Investigator + Risk Scorecard", panel_fixture: "CREAO panel (fixture)", rule: "by rule · no CREAO seat answered" };

// The phone shows progress only: step label, status and the customer-safe
// liveNote. Findings, scores and summaries stay on the business side.
// CREAO reviews a claim twice: the Refund Reviewer reads the report before the
// decision, the Score Reviewer judges the score change after it. The "Reviewed by
// CREAO" row follows that: once a decision exists it shows the Score Reviewer's
// actual state (judging, done, or the labelled rule), never a stale "skipped".
function ReviewerStepper({ rows, decided, scoreReview }: { rows: readonly AnalysisStep[]; decided: boolean; scoreReview?: ScoreReview }) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const decision = byKey.get("decision");
  const message = decision && (decision.status === "done" || decision.status === "skipped") && decision.liveNote ? decision.liveNote : null;
  return (
    <div className="space-y-3">
      <ol className="space-y-2" data-testid="claim-stepper">
        {STEP_KEYS.map((k, i) => {
          const s = byKey.get(k);
          let status = s?.status ?? "pending";
          let tag: string | null = null;
          let note: string | null = s?.liveNote || null;
          if (k === "review" && decided) {
            if (scoreReview) {
              status = "done";
              tag = SCORE_JUDGE[scoreReview.provenance] ?? scoreReview.provenance;
              note = `Score ${scoreReview.delta > 0 ? "+" : ""}${scoreReview.delta === 0 ? "unchanged" : scoreReview.delta} · ${scoreReview.reason}`;
            } else {
              status = "running";
              tag = null;
              note = "The CREAO Score Reviewer is judging what this decision does to your score.";
            }
          } else if (k === "review" && status === "skipped") {
            // Before the decision the Refund Reviewer seat may be absent; the Score Reviewer still runs after it.
            tag = "after the decision";
            note = null;
          }
          const done = status === "done";
          const active = status === "running";
          const failed = status === "failed";
          const skipped = status === "skipped";
          if (!tag) tag = k === "droid_case" && (failed || skipped) ? "Automated checks only" : failed ? "did not finish" : skipped ? "skipped" : null;
          return (
            <motion.li key={k} initial={false} animate={{ opacity: done || active || failed ? 1 : 0.4 }} className="flex items-start gap-3" data-status={status} data-step={k}>
              <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500 text-white" : active ? "animate-pulse bg-cyan-400 text-white" : failed ? "bg-red-400 text-white" : "bg-slate-200 text-slate-500"}`}>{done ? "✓" : failed ? "!" : skipped ? "–" : i + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{STEP_LABEL[k]}{tag ? <span className="ml-2 text-xs font-normal text-ink-soft">{tag}</span> : null}</div>
                {note && !(k === "decision" && message) ? <div className="text-xs text-ink-soft">{note}</div> : null}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {message ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl bg-cyan-50 p-4 text-sm text-cyan-950" data-testid="claim-message">{message}</motion.div>
      ) : null}
    </div>
  );
}

function DecisionCard({ status, amount, method, credit, scoreReview }: { status: string; amount: number; method: string; credit?: { before: number; after: number }; scoreReview?: ScoreReview }) {
  const ok = status === "accepted";
  const before = scoreReview?.before ?? credit?.before;
  const after = scoreReview?.after ?? credit?.after;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={`rounded-xl p-4 ${ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`} data-testid="claim-decision">
      <div className="text-lg font-bold">{ok ? `Refund approved: ${money(amount)}` : "Refund declined"}</div>
      {ok ? <div className="text-sm">{method === "store_credit" ? "As store credit." : "To your original payment method."}</div> : <div className="text-sm">A person at the store made this decision.</div>}
      {before !== undefined && after !== undefined ? (
        <div className="mt-3 text-sm" data-testid="claim-score-change">Your score: <span className="font-mono">{before}</span> → <span className="font-mono text-2xl font-bold"><Tween value={after} duration={1.4} /></span> <Badge kind="live" /></div>
      ) : (
        <div className="mt-3 text-sm" data-testid="claim-score-pending">Your score is being reviewed by the CREAO Score Reviewer…</div>
      )}
      {scoreReview ? <div className="mt-1 text-xs opacity-80" data-testid="claim-score-judge">{scoreReview.reason} <span className="whitespace-nowrap">· {SCORE_JUDGE[scoreReview.provenance] ?? scoreReview.provenance}</span></div> : null}
    </motion.div>
  );
}
