/** Seeded Cal Hacks demo claims. Replace with live SpacetimeDB rows later. */

export type ClaimStatus =
  | "queued"
  | "ready_to_approve"
  | "needs_review"
  | "policy_block"
  | "approved"
  | "declined"
  | "more_evidence";

export type ScoreDisplay =
  | { kind: "none"; label: "No verified history" }
  | { kind: "score"; value: number; band: "strong" | "fair" | "thin" };

export interface ScoreEvent {
  id: string;
  at: string;
  summary: string;
  delta: number | null;
  /** Only confirmed merchant outcomes change the score. */
  confirmed: boolean;
}

export interface DemoClaim {
  id: string;
  customerName: string;
  customerNote: string;
  orderId: string;
  itemOrdered: string;
  itemObserved: string;
  amountCents: number;
  reason: string;
  transcript: string;
  videoLabel: string;
  policyResult: { ok: boolean; summary: string };
  history: ScoreEvent[];
  scoreBefore: ScoreDisplay;
  status: ClaimStatus;
  decisionNote: string;
  /** AI / Factory observation — never mutates the score by itself. */
  analysisFlag: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  /** Marks the live handoff / simulate path for the closing story. */
  isLiveHandoff?: boolean;
  storyTag?: string;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function scoreLabel(s: ScoreDisplay): string {
  return s.kind === "none" ? s.label : `${s.value}/100 · ${s.band}`;
}

export const SEED_CLAIMS: DemoClaim[] = [
  {
    id: "CLM-1042",
    customerName: "Maya R.",
    customerNote: "Reliable return history",
    orderId: "ORD-88421",
    itemOrdered: "Black T-shirt · Medium",
    itemObserved: "Blue T-shirt · Small",
    amountCents: 2800,
    reason: "Wrong item received",
    transcript:
      "Hi — I ordered a black medium shirt. What’s in the box is a blue small. Here’s the packing slip and the shirt tag.",
    videoLabel: "Video claim · 0:28 · finger challenge present",
    policyResult: {
      ok: true,
      summary: "Within 30-day window · unopened return not required for wrong-item · eligible for refund to original payment",
    },
    history: [
      { id: "h1", at: "2026-08-12", summary: "Wrong size — approved", delta: 4, confirmed: true },
      { id: "h2", at: "2026-05-03", summary: "Defective zipper — approved", delta: 3, confirmed: true },
      { id: "h3", at: "2026-01-19", summary: "Never received — declined after carrier proof", delta: -6, confirmed: true },
    ],
    scoreBefore: { kind: "score", value: 78, band: "strong" },
    status: "ready_to_approve",
    decisionNote:
      "Ordered and observed items disagree on color and size. Policy allows a wrong-item refund. Strong confirmed history supports fast approval — the flag alone does not change the score.",
    analysisFlag: "Mismatch between ordered SKU and spoken/visual description",
    submittedAt: "2026-10-24T14:02:00Z",
    resolvedAt: null,
  },
  {
    id: "CLM-1048",
    customerName: "Jordan K.",
    customerNote: "Thin history",
    orderId: "ORD-89102",
    itemOrdered: "Wool beanie · Charcoal",
    itemObserved: "Claimed damaged stitching (unclear on camera)",
    amountCents: 3400,
    reason: "Item damaged",
    transcript:
      "The seam looks wrong somehow… it’s hard to show on video. I think it’s coming apart near the fold.",
    videoLabel: "Video claim · 0:41 · lighting poor · damage not clearly visible",
    policyResult: {
      ok: true,
      summary: "Within return window · damage claims require visible defect or clearer evidence",
    },
    history: [
      { id: "h1", at: "2026-09-01", summary: "First confirmed refund — approved", delta: 2, confirmed: true },
    ],
    scoreBefore: { kind: "score", value: 54, band: "fair" },
    status: "needs_review",
    decisionNote:
      "Evidence is ambiguous. Route to a human with the assembled case. An AI flag must not lower the Vouch score until a confirmed decision is recorded.",
    analysisFlag: "Damage not clearly visible; transcript hedges",
    submittedAt: "2026-10-24T15:18:00Z",
    resolvedAt: null,
  },
  {
    id: "CLM-1051",
    customerName: "Sam P.",
    customerNote: "No verified history",
    orderId: "ORD-90211",
    itemOrdered: "Trail runner · Size 10",
    itemObserved: "Worn outdoors · mud on outsole",
    amountCents: 12800,
    reason: "Changed mind",
    transcript: "I just don’t need these anymore. I’ve worn them a few times on trails.",
    videoLabel: "Video claim · 0:19 · clear wear visible",
    policyResult: {
      ok: false,
      summary: "Outside policy: change-of-mind returns require unused condition with original tags · worn footwear is excluded",
    },
    history: [],
    scoreBefore: { kind: "none", label: "No verified history" },
    status: "policy_block",
    decisionNote:
      "Claim validity fails the merchant refund policy regardless of trust history. Explain the rule clearly to the customer. Starting buyers still get a fair standard path — not a punitive starter score.",
    analysisFlag: "Visible wear conflicts with unused-return policy",
    submittedAt: "2026-10-24T16:05:00Z",
    resolvedAt: null,
  },
];

/** Claim injected by “Simulate incoming claim” — closing story path. */
export function makeHandoffClaim(now = new Date()): DemoClaim {
  return {
    id: `CLM-${1100 + (now.getSeconds() % 80)}`,
    customerName: "Elena M.",
    customerNote: "Illustrative customer · demo handoff",
    orderId: "ORD-91004",
    itemOrdered: "Kids’ raincoat · Yellow · Size 6",
    itemObserved: "Kids’ raincoat · Navy · Size 4",
    amountCents: 4200,
    reason: "Wrong item received",
    transcript:
      "I ordered a yellow size 6 for my daughter. This is a navy size 4. I filmed the tag and the packing slip — I have to get back to work.",
    videoLabel: "Simulated customer submission · video + spoken claim",
    policyResult: {
      ok: true,
      summary: "Within window · wrong-item eligible · refund to original payment after approval",
    },
    history: [
      { id: "h1", at: "2026-07-22", summary: "Wrong color — approved", delta: 3, confirmed: true },
    ],
    scoreBefore: { kind: "score", value: 71, band: "strong" },
    status: "ready_to_approve",
    decisionNote:
      "Clear ordered vs observed mismatch. Fast approval is appropriate. Approval time is what we measure in the demo — funds settling in her bank still depends on the payment processor.",
    analysisFlag: "Color and size mismatch corroborated by tag and packing slip",
    submittedAt: now.toISOString(),
    resolvedAt: null,
    isLiveHandoff: true,
    storyTag: "single-parent illustrative case",
  };
}

export function applyDecision(
  claim: DemoClaim,
  action: "approve" | "decline" | "more_evidence",
  at = new Date(),
): DemoClaim {
  if (action === "more_evidence") {
    return {
      ...claim,
      status: "more_evidence",
      resolvedAt: null,
      decisionNote:
        "Merchant requested clearer evidence. Score unchanged — only a confirmed outcome updates Vouch.",
    };
  }

  const approved = action === "approve";
  const delta = approved ? 3 : -4;
  const nextScore: ScoreDisplay =
    claim.scoreBefore.kind === "none"
      ? approved
        ? { kind: "score", value: 52, band: "fair" }
        : { kind: "none", label: "No verified history" }
      : {
          kind: "score",
          value: Math.max(0, Math.min(100, claim.scoreBefore.value + delta)),
          band:
            claim.scoreBefore.value + delta >= 70
              ? "strong"
              : claim.scoreBefore.value + delta >= 45
                ? "fair"
                : "thin",
        };

  return {
    ...claim,
    status: approved ? "approved" : "declined",
    resolvedAt: at.toISOString(),
    scoreBefore: nextScore,
    history: [
      {
        id: `dec-${at.getTime()}`,
        at: at.toISOString().slice(0, 10),
        summary: approved ? "Refund approved — confirmed" : "Refund declined — confirmed",
        delta: claim.scoreBefore.kind === "none" && !approved ? null : delta,
        confirmed: true,
      },
      ...claim.history,
    ],
    decisionNote: approved
      ? "Confirmed approval recorded. Vouch score updated from the merchant decision — not from the analysis flag alone. Refund approved; bank settlement follows the payment rail."
      : "Confirmed decline recorded. Score updated only because the merchant decision is final.",
  };
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  queued: "Queued",
  ready_to_approve: "Ready to approve",
  needs_review: "Needs human review",
  policy_block: "Outside policy",
  approved: "Approved",
  declined: "Declined",
  more_evidence: "More evidence requested",
};
