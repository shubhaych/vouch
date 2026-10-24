// Deterministic scoring for the video reviewer (formula v1). Pure: no
// spacetimedb import, shared by the worker (scores a claim), the web (shows the
// components) and the unit tests. Every coefficient here is hand-set and
// documented in the README; nothing is learned from data.
import { bandOf, type Band } from './score';

export const FORMULA_VERSION = 'v1';
/** Default when a business policy has no autoApproveLimitCents: the spec's $100. */
export const DEFAULT_AUTO_APPROVE_CENTS = 10_000;

export type SpokenClaimKind = 'defect' | 'condition' | 'functional' | 'context';
export interface SpokenClaim { id: string; text: string; kind: SpokenClaimKind; tSaid: number }

export type FindingKind = 'supports' | 'contradicts' | 'neutral' | 'integrity';
export type AuditStatus = 'pending' | 'passed' | 'rejected';
export interface ScoredFinding { claimId?: string; kind: FindingKind; confidence: number; auditStatus: AuditStatus }

/** What a claim is worth: a defect or a function that fails matters more than how the item looks or the story around it. */
export const CLAIM_WEIGHT: Record<SpokenClaimKind, number> = { defect: 1, functional: 1, condition: 0.7, context: 0.3 };

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

export interface SupportResult {
  eSupport: number;
  coverage: number;
  perClaim: { claimId: string; weight: number; s: number; shown: boolean }[];
}

/**
 * E = (1 + Σ w·s / Σ w) / 2 with s = +conf when the finding supports the claim, −conf when it
 * contradicts it, 0 when it is neutral or the moment was never shown. C = Σ w(shown) / Σ w.
 * Only findings that passed the audit count; the audit refuses findings without artifacts.
 */
export function evidenceSupport(claims: SpokenClaim[], findings: ScoredFinding[]): SupportResult {
  const perClaim = claims.map((c) => {
    const weight = CLAIM_WEIGHT[c.kind] ?? 0.3;
    const f = findings.filter((x) => x.auditStatus === 'passed' && x.claimId === c.id && (x.kind === 'supports' || x.kind === 'contradicts'))
      .sort((a, b) => b.confidence - a.confidence)[0];
    const conf = f ? clamp(f.confidence, 0, 1) : 0;
    const s = !f ? 0 : f.kind === 'supports' ? conf : -conf;
    return { claimId: c.id, weight, s, shown: !!f };
  });
  const total = perClaim.reduce((a, c) => a + c.weight, 0);
  if (total === 0) return { eSupport: 0.5, coverage: 0, perClaim };
  const weighted = perClaim.reduce((a, c) => a + c.weight * c.s, 0) / total;
  const shown = perClaim.filter((c) => c.shown).reduce((a, c) => a + c.weight, 0) / total;
  return { eSupport: round4((1 + weighted) / 2), coverage: round4(shown), perClaim };
}

export type IntegrityFlagKind = 'frame_reuse' | 'recapture' | 'splice' | 'challenge_failed' | 'metadata_inconsistent' | 'frozen' | 'black' | 'reencoded' | 'other';
export interface IntegrityFlag { kind: IntegrityFlagKind | string; confidence: number; tStart?: number; tEnd?: number; artifactIds?: number[]; note?: string }

/** Penalties per flag; I = clamp(1 − Σ, 0, 1). Flags the scorer does not know cost nothing: they are shown, not scored. */
export const INTEGRITY_PENALTY: Record<string, (conf: number) => number> = {
  frame_reuse: (c) => 0.6 * c,
  recapture: (c) => 0.5 * c,
  splice: (c) => 0.3 * c,
  challenge_failed: () => 0.3,
  metadata_inconsistent: () => 0.1,
};

export function integrityScore(flags: IntegrityFlag[]): number {
  const penalty = flags.reduce((a, f) => a + (INTEGRITY_PENALTY[f.kind]?.(clamp(f.confidence, 0, 1)) ?? 0), 0);
  return round4(clamp(1 - penalty, 0, 1));
}

// ---------------------------------------------------------------- history

export const ALPHA = 10;
/** Share of orders that come back, per category; electronics rarely, apparel often (sizes). */
export const CATEGORY_BASELINE: Record<string, number> = {
  apparel: 0.2, electronics: 0.08, home: 0.1, beauty: 0.06, 'sporting goods': 0.12, toys: 0.1, default: 0.12,
};
export const baselineFor = (category: string) => CATEGORY_BASELINE[category] ?? CATEGORY_BASELINE.default!;

export type VerifiedIdentity = 'verified' | 'unverified' | 'unknown';

export interface HistoryInput {
  tenureDays: number;
  orders: number;
  refunds365: number;
  categoryBaseline: number;
  /** Prices of past orders in cents, for the amount term. */
  pastPricesCents: number[];
  priceCents: number;
  /** Refunds filed in the last 30 days including this one. */
  refundsThisMonth: number;
  /** Where in the return window the claim was filed, 0 = delivery day, 1 = last day; null when unknown. */
  filedAtFractionOfWindow: number | null;
  verifiedIdentity: VerifiedIdentity;
}

export interface Anomaly { amountZ: number; frequencySurprise: number; windowEdge: boolean; score: number; unusual: boolean; thin: boolean }

export interface HistoryResult {
  smoothedRefundRate: number;
  excessRatio: number;
  anomaly: Anomaly;
}

function poissonTail(m: number, lambda: number): number {
  // P(N >= m) = 1 − Σ_{i<m} e^{−λ} λ^i / i!
  if (m <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < m; i++) { term *= lambda / i; cdf += term; }
  return clamp(1 - cdf, 1e-9, 1);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** r̂ = (k + α·r_c) / (n + α) smooths a short history toward the category; X = r̂ / r_c is the excess ratio. */
export function history(h: HistoryInput): HistoryResult {
  const rc = Math.max(0.005, h.categoryBaseline);
  const smoothed = (h.refunds365 + ALPHA * rc) / (Math.max(0, h.orders) + ALPHA);
  const excessRatio = smoothed / rc;
  let amountZ = 0;
  let frequencySurprise = 0;
  let windowEdge = false;
  const thin = h.orders < 3;
  if (!thin) {
    const past = h.pastPricesCents.filter((p) => p > 0).map((p) => Math.log(p / 100));
    if (past.length >= 2) {
      const mu = mean(past);
      const sd = Math.sqrt(mean(past.map((x) => (x - mu) ** 2)));
      amountZ = (Math.log(Math.max(1, h.priceCents) / 100) - mu) / Math.max(sd, 0.5);
    }
    // How surprising the *other* refunds of the last 30 days are at this customer's monthly rate; the one being filed is not evidence against itself.
    const lambda = Math.max(0.05, h.refunds365 / 12);
    frequencySurprise = Math.min(20, -Math.log(poissonTail(h.refundsThisMonth - 1, lambda)));
    windowEdge = h.filedAtFractionOfWindow !== null && h.filedAtFractionOfWindow >= 0.85;
  }
  const score = thin ? 0 : 0.4 * Math.max(0, Math.abs(amountZ) - 1) + 0.5 * Math.max(0, frequencySurprise - 1) + (windowEdge ? 0.3 : 0);
  return {
    smoothedRefundRate: round4(smoothed),
    excessRatio: round4(excessRatio),
    anomaly: { amountZ: round4(amountZ), frequencySurprise: round4(frequencySurprise), windowEdge, score: round4(score), unusual: score > 1, thin },
  };
}

// ---------------------------------------------------------------- P(legit)

export interface LegitInput { eSupport: number; coverage: number; integrity: number; excessRatio: number; anomaly: number; verifiedIdentity: VerifiedIdentity }
export interface LegitResult { pLegit: number; logit: number; components: Record<string, number> }

/** logit = −0.2 + 4(E−0.5) + 1(C−0.5) − 3(1−I) + H + 0.3·verified, with H = max(−2, −0.8 ln X − 0.6 A). */
export function pLegit(i: LegitInput): LegitResult {
  const evidence = 4 * (i.eSupport - 0.5);
  const coverage = 1 * (i.coverage - 0.5);
  const integrity = -3 * (1 - i.integrity);
  const historyTerm = Math.max(-2, -0.8 * Math.log(Math.max(1e-6, i.excessRatio)) - 0.6 * i.anomaly);
  const verified = i.verifiedIdentity === 'verified' ? 0.3 : 0;
  const logit = -0.2 + evidence + coverage + integrity + historyTerm + verified;
  return {
    pLegit: round4(1 / (1 + Math.exp(-logit))),
    logit: round4(logit),
    components: { intercept: -0.2, evidence: round4(evidence), coverage: round4(coverage), integrity: round4(integrity), history: round4(historyTerm), verified },
  };
}

// ---------------------------------------------------------------- tiers

export type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
export const TIER_LABEL: Record<Tier, string> = {
  T1: 'Instant full refund', T2: 'Partial now, rest on return', T3: 'Return first', T4: 'More evidence', T5: 'Human review',
};
export const BAND_MULTIPLIER: Record<Band, number> = { green: 2, neutral: 1, amber: 0.5, red: 0 };

export interface TierInput {
  pLegit: number;
  integrity: number;
  coverage: number;
  amountCents: number;
  autoApproveLimitCents: number;
  band: Band;
  /** A finding contradicts a claim with confidence ≥ 0.8. */
  strongContradiction: boolean;
  /** Frames match another claim's frames (a deterministic check, not a model's opinion). */
  reuseConfirmed: boolean;
  /** Claims with no supporting finding, used to write the evidence requests. */
  unsupportedClaims: string[];
}

export interface TierResult {
  tier: Tier;
  refundNowCents: number;
  refundOnReturnCents: number;
  returnRequired: boolean;
  evidenceRequested?: string[];
  reasons: { text: string; cites: string }[];
  /** True when the tier allows an automatic decision (a reviewer must still agree, and refundNow must be within the limit). */
  autoDecidable: boolean;
}

export const toDollar = (cents: number) => Math.round(cents / 100) * 100;

export function tierFor(i: TierInput): TierResult {
  const cap = i.autoApproveLimitCents * BAND_MULTIPLIER[i.band];
  const V = i.amountCents;
  const pct = `${Math.round(i.pLegit * 100)}%`;
  if ((i.strongContradiction && i.integrity < 0.5) || i.reuseConfirmed) {
    return {
      tier: 'T5', refundNowCents: 0, refundOnReturnCents: 0, returnRequired: false, autoDecidable: false,
      reasons: [{ text: i.reuseConfirmed ? 'Frames in this video match frames from another claim; a person must look before anything is paid or declined.' : 'A claim is contradicted by what the video shows and the recording has integrity problems; a person must look.', cites: i.reuseConfirmed ? 'integrity:frame_reuse' : 'finding:contradicts' }],
    };
  }
  if (i.pLegit < 0.45 || i.integrity < 0.5 || i.coverage < 0.4) {
    const asks = i.unsupportedClaims.length ? i.unsupportedClaims.map((c) => `Record a 10-second clip that clearly shows: ${c}`) : ['Record the whole item, then the problem up close, in one continuous take.'];
    const why = i.integrity < 0.5 ? 'The recording has integrity problems that a new continuous take would settle.' : i.coverage < 0.4 ? 'Most of what was claimed was not shown on camera.' : `The evidence is not strong enough yet (P ${pct}).`;
    return { tier: 'T4', refundNowCents: 0, refundOnReturnCents: 0, returnRequired: false, evidenceRequested: asks, autoDecidable: false, reasons: [{ text: why, cites: 'score:pLegit' }] };
  }
  if (i.pLegit >= 0.85 && i.integrity >= 0.8 && V <= cap) {
    return {
      tier: 'T1', refundNowCents: V, refundOnReturnCents: 0, returnRequired: false, autoDecidable: true,
      reasons: [{ text: `The video supports the claim (P ${pct}, integrity ${Math.round(i.integrity * 100)}%) and the amount is within the ${i.band}-band limit.`, cites: 'score:pLegit' }],
    };
  }
  if (i.pLegit >= 0.65) {
    const f = clamp(0.3 + 2 * (i.pLegit - 0.65), 0.3, 0.7);
    const now = Math.min(V, toDollar(V * f));
    return {
      tier: 'T2', refundNowCents: now, refundOnReturnCents: V - now, returnRequired: true, autoDecidable: true,
      reasons: [{ text: V > cap && i.pLegit >= 0.85 ? `The video supports the claim (P ${pct}) but the amount is above the ${i.band}-band limit, so part is paid now and the rest when the return is scanned.` : `The video mostly supports the claim (P ${pct}); ${Math.round(f * 100)}% is paid now and the rest when the return is scanned.`, cites: 'score:pLegit' }],
    };
  }
  return {
    tier: 'T3', refundNowCents: 0, refundOnReturnCents: V, returnRequired: true, autoDecidable: false,
    reasons: [{ text: `The evidence is mixed (P ${pct}); the refund is paid when the return is scanned.`, cites: 'score:pLegit' }],
  };
}

// ---------------------------------------------------------------- credit

export type CreditBase =
  | 'full_refund_supported' | 'partial_or_return_matches' | 'return_first_confirmed' | 'more_evidence_then_valid'
  | 'evidence_never_provided' | 'decline_on_contradiction' | 'integrity_confirmed_by_person' | 'override_in_favour';

export const CREDIT_BASE: Record<CreditBase, number> = {
  full_refund_supported: 8, partial_or_return_matches: 6, return_first_confirmed: 5, more_evidence_then_valid: 3,
  evidence_never_provided: -5, decline_on_contradiction: -35, integrity_confirmed_by_person: -90, override_in_favour: 0,
};
export const CREDIT_CAP = 120;

/** Δ = base × certainty × m; certainty = max(P, 1−P); negative m = 1 + 0.5·min(A, 2); positive m = 1 / (1 + 0.3·max(0, ln X)). */
export function creditDelta(base: CreditBase, pLegit: number, anomaly: number, excessRatio: number): number {
  const b = CREDIT_BASE[base];
  const certainty = Math.max(pLegit, 1 - pLegit);
  const m = b < 0 ? 1 + 0.5 * Math.min(Math.max(0, anomaly), 2) : 1 / (1 + 0.3 * Math.max(0, Math.log(Math.max(1e-6, excessRatio))));
  return clamp(Math.round(b * certainty * m), -CREDIT_CAP, CREDIT_CAP);
}

export { bandOf };
export type { Band };
