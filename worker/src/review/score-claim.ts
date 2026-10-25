// Scoring one claim: the history numbers from the worker's mirror, then the
// pure formula (module/src/review-score.ts) for E, C, I, P(legit), the tier
// and the credit preview. Nothing here looks at the footage; it only combines
// what the audit let through. A lanes-only job (Droid did not run) is capped
// at T3: automated checks never pay out on their own.
import type { DbConnection } from '../../module_bindings/index';
import type { Purchase, Refund } from '../../module_bindings/types';
import {
  baselineFor, clamp, creditDelta, evidenceSupport, history, integrityScore, pLegit, tierFor,
  type Band, type CreditBase, type HistoryInput, type HistoryResult, type IntegrityFlag, type LegitResult, type SpokenClaim, type SupportResult, type Tier, type TierResult, type VerifiedIdentity,
} from '@vouch/module/review-score';
import { mirrorOf } from '../mirror';
import type { FindingRec } from './state';

/** Counts and ratios about the account for the formula (never identity or location). */
export function historyFor(conn: DbConnection, purchase: Purchase, refund: Refund, policyWindowDays: number, verifiedIdentity: VerifiedIdentity): HistoryInput {
  const day = conn.db.simRun.id.find(1)?.day ?? refund.day;
  const m = mirrorOf(conn);
  const purchases = m.purchasesOf(refund.agentId);
  const refunds = m.refundsOf(refund.agentId);
  const first = purchases.reduce((lo, p) => Math.min(lo, p.day), day);
  const windowLen = purchase.windowEndDay > purchase.deliverDay ? purchase.windowEndDay - purchase.deliverDay : policyWindowDays;
  return {
    tenureDays: Math.max(0, day - first),
    orders: purchases.length,
    refunds365: refunds.filter((r) => r.day >= day - 365).length,
    categoryBaseline: baselineFor(purchase.category),
    pastPricesCents: purchases.filter((p) => p.id !== purchase.id).map((p) => p.amount),
    priceCents: purchase.amount,
    refundsThisMonth: Math.max(1, refunds.filter((r) => r.day >= day - 30).length),
    filedAtFractionOfWindow: windowLen > 0 ? clamp((refund.day - purchase.deliverDay) / windowLen, 0, 1) : null,
    verifiedIdentity,
  };
}

export interface ScoreInput {
  claims: SpokenClaim[];
  findings: FindingRec[];
  flags: IntegrityFlag[];
  history: HistoryInput;
  amountCents: number;
  autoApproveLimitCents: number;
  band: Band;
  lanesOnly: boolean;
}

export interface ScoreResult {
  support: SupportResult;
  integrity: number;
  flags: IntegrityFlag[];
  historyInput: HistoryInput;
  history: HistoryResult;
  legit: LegitResult;
  tier: TierResult;
  strongContradiction: boolean;
  reuseConfirmed: boolean;
  /** Spoken claims without a passed supporting finding (their text), for the evidence requests. */
  unsupported: string[];
  creditPreview: { base: CreditBase; delta: number } | null;
  /** True when the lanes-only cap pulled a T1/T2 down to T3. */
  capped: boolean;
}

const CREDIT_BY_TIER: Record<Tier, CreditBase | null> = {
  T1: 'full_refund_supported', T2: 'partial_or_return_matches', T3: 'return_first_confirmed', T4: 'more_evidence_then_valid', T5: null,
};

export function scoreClaim(i: ScoreInput): ScoreResult {
  const scored = i.findings.map((f) => ({ claimId: f.kind === 'integrity' ? undefined : f.spokenClaimId, kind: f.kind as 'supports' | 'contradicts' | 'neutral' | 'integrity', confidence: f.confidence, auditStatus: f.auditStatus as 'pending' | 'passed' | 'rejected' }));
  const support = evidenceSupport(i.claims, scored);
  const integrity = integrityScore(i.flags);
  const hist = history(i.history);
  const legit = pLegit({ eSupport: support.eSupport, coverage: support.coverage, integrity, excessRatio: hist.excessRatio, anomaly: hist.anomaly.score, verifiedIdentity: i.history.verifiedIdentity });
  const passed = i.findings.filter((f) => f.auditStatus === 'passed');
  const strongContradiction = passed.some((f) => f.kind === 'contradicts' && f.confidence >= 0.8);
  const reuseConfirmed = i.flags.some((f) => f.kind === 'frame_reuse' && f.confidence >= 0.8);
  const unsupported = i.claims.filter((c) => !passed.some((f) => f.kind === 'supports' && f.spokenClaimId === c.id)).map((c) => c.text);
  let tier = tierFor({ pLegit: legit.pLegit, integrity, coverage: support.coverage, amountCents: i.amountCents, autoApproveLimitCents: i.autoApproveLimitCents, band: i.band, strongContradiction, reuseConfirmed, unsupportedClaims: unsupported });
  let capped = false;
  if (i.lanesOnly && (tier.tier === 'T1' || tier.tier === 'T2')) {
    capped = true;
    tier = {
      tier: 'T3', refundNowCents: 0, refundOnReturnCents: i.amountCents, returnRequired: true, autoDecidable: false,
      reasons: [...tier.reasons, { text: 'Droid did not run, so no spoken claim was checked against the footage; automated checks alone never pay out, so the refund waits for the return.', cites: 'method:lanesOnly' }],
    };
  }
  const base = CREDIT_BY_TIER[tier.tier];
  const creditPreview = base ? { base, delta: creditDelta(base, legit.pLegit, hist.anomaly.score, hist.excessRatio) } : null;
  return { support, integrity, flags: i.flags, historyInput: i.history, history: hist, legit, tier, strongContradiction, reuseConfirmed, unsupported, creditPreview, capped };
}
