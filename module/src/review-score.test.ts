import { describe, expect, it } from 'vitest';
import {
  CLAIM_WEIGHT, creditDelta, evidenceSupport, history, integrityScore, pLegit, tierFor, type SpokenClaim,
} from './review-score';

// Spec section 10: the formula is hand-set, so the sanity checks and the worked example are pinned here.
const claims: SpokenClaim[] = [
  { id: 'c1', text: 'the left earbud does not charge', kind: 'defect', tSaid: 2 },
  { id: 'c2', text: 'the case is scratched', kind: 'condition', tSaid: 6 },
];

describe('evidence support and coverage', () => {
  it('weights defect claims over condition claims and ignores rejected findings', () => {
    expect(CLAIM_WEIGHT.defect).toBe(1);
    expect(CLAIM_WEIGHT.condition).toBe(0.7);
    const r = evidenceSupport(claims, [
      { claimId: 'c1', kind: 'supports', confidence: 0.9, auditStatus: 'passed' },
      { claimId: 'c2', kind: 'supports', confidence: 0.8, auditStatus: 'rejected' },
    ]);
    // Σw = 1.7; Σw·s = 0.9 → E = (1 + 0.9/1.7)/2
    expect(r.eSupport).toBeCloseTo((1 + 0.9 / 1.7) / 2, 3);
    expect(r.coverage).toBeCloseTo(1 / 1.7, 3);
  });
  it('a contradiction pulls E below 0.5; nothing shown gives E 0.5 and C 0', () => {
    expect(evidenceSupport(claims, [{ claimId: 'c1', kind: 'contradicts', confidence: 1, auditStatus: 'passed' }]).eSupport).toBeLessThan(0.5);
    const none = evidenceSupport(claims, []);
    expect(none.eSupport).toBe(0.5);
    expect(none.coverage).toBe(0);
  });
});

describe('integrity', () => {
  it('applies the listed penalties and clamps', () => {
    expect(integrityScore([])).toBe(1);
    expect(integrityScore([{ kind: 'frame_reuse', confidence: 1 }])).toBeCloseTo(0.4, 3);
    expect(integrityScore([{ kind: 'recapture', confidence: 0.5 }, { kind: 'metadata_inconsistent', confidence: 1 }])).toBeCloseTo(0.65, 3);
    expect(integrityScore([{ kind: 'frame_reuse', confidence: 1 }, { kind: 'recapture', confidence: 1 }])).toBe(0);
    expect(integrityScore([{ kind: 'unknown_flag', confidence: 1 }])).toBe(1);
  });
});

describe('P(legit) sanity checks from the spec', () => {
  it('strong evidence, clean history, verified → about 0.88', () => {
    const r = pLegit({ eSupport: 0.85, coverage: 1, integrity: 1, excessRatio: 1, anomaly: 0, verifiedIdentity: 'verified' });
    expect(r.pLegit).toBeCloseTo(0.88, 2);
  });
  it('weak evidence, bad history → about 0.06', () => {
    const r = pLegit({ eSupport: 0.2, coverage: 0.8, integrity: 0.9, excessRatio: 2, anomaly: 1.2, verifiedIdentity: 'unverified' });
    expect(r.pLegit).toBeCloseTo(0.06, 2);
  });
  it('perfect evidence stays above 0.5 for any history (the history term is floored at −2)', () => {
    const r = pLegit({ eSupport: 1, coverage: 1, integrity: 1, excessRatio: 1000, anomaly: 50, verifiedIdentity: 'unknown' });
    expect(r.logit).toBeCloseTo(0.3, 3);
    expect(r.pLegit).toBeGreaterThan(0.5);
  });
});

describe('history', () => {
  it('smooths toward the category baseline and flags thin histories', () => {
    const thin = history({ tenureDays: 3, orders: 1, refunds365: 1, categoryBaseline: 0.08, pastPricesCents: [5000], priceCents: 20000, refundsThisMonth: 1, filedAtFractionOfWindow: 0.9, verifiedIdentity: 'unknown' });
    expect(thin.anomaly.thin).toBe(true);
    expect(thin.anomaly.score).toBe(0);
    const h = history({ tenureDays: 400, orders: 22, refunds365: 2, categoryBaseline: 0.08, pastPricesCents: Array(22).fill(14900), priceCents: 14900, refundsThisMonth: 1, filedAtFractionOfWindow: 0.3, verifiedIdentity: 'verified' });
    expect(h.smoothedRefundRate).toBeCloseTo(2.8 / 32, 3);
    expect(h.excessRatio).toBeCloseTo(1.094, 2);
    expect(h.anomaly.unusual).toBe(false);
  });
  it('an unusually large order, a burst of refunds and a last-minute filing add up to unusual', () => {
    const h = history({ tenureDays: 400, orders: 30, refunds365: 1, categoryBaseline: 0.08, pastPricesCents: Array(30).fill(2000), priceCents: 90000, refundsThisMonth: 3, filedAtFractionOfWindow: 0.95, verifiedIdentity: 'unknown' });
    expect(h.anomaly.amountZ).toBeGreaterThan(1);
    expect(h.anomaly.frequencySurprise).toBeGreaterThan(1);
    expect(h.anomaly.windowEdge).toBe(true);
    expect(h.anomaly.unusual).toBe(true);
  });
});

describe('tiers', () => {
  const base = { integrity: 1, coverage: 1, autoApproveLimitCents: 10_000, band: 'neutral' as const, strongContradiction: false, reuseConfirmed: false, unsupportedClaims: [] as string[] };
  it('T1 instant full refund within the band cap', () => {
    const t = tierFor({ ...base, pLegit: 0.9, amountCents: 8000 });
    expect(t.tier).toBe('T1');
    expect(t.refundNowCents).toBe(8000);
    expect(t.autoDecidable).toBe(true);
  });
  it('T2 partial when P is high but the amount is above the cap (the worked example: $149, limit $100, neutral)', () => {
    const t = tierFor({ ...base, pLegit: 0.9027, amountCents: 14900 });
    expect(t.tier).toBe('T2');
    expect(t.refundNowCents).toBe(10400); // f clamps at 0.7 → $104.30 → $104
    expect(t.refundOnReturnCents).toBe(4500);
    expect(t.returnRequired).toBe(true);
  });
  it('T2 scales the partial with P between 0.65 and 0.85', () => {
    const t = tierFor({ ...base, pLegit: 0.7, amountCents: 10000 });
    expect(t.tier).toBe('T2');
    expect(t.refundNowCents).toBe(4000); // f = 0.3 + 2·0.05 = 0.4
  });
  it('T3 return first for mixed evidence', () => {
    const t = tierFor({ ...base, pLegit: 0.5, amountCents: 10000 });
    expect(t.tier).toBe('T3');
    expect(t.refundNowCents).toBe(0);
    expect(t.refundOnReturnCents).toBe(10000);
  });
  it('T4 more evidence when P, integrity or coverage is low, with asks from the unsupported claims', () => {
    expect(tierFor({ ...base, pLegit: 0.3, amountCents: 10000 }).tier).toBe('T4');
    expect(tierFor({ ...base, pLegit: 0.9, integrity: 0.4, amountCents: 1000 }).tier).toBe('T4');
    const t = tierFor({ ...base, pLegit: 0.9, coverage: 0.3, amountCents: 1000, unsupportedClaims: ['the zip is broken'] });
    expect(t.tier).toBe('T4');
    expect(t.evidenceRequested?.[0]).toContain('the zip is broken');
  });
  it('T5 human review on a strong contradiction with low integrity, or confirmed frame reuse; never a decision', () => {
    expect(tierFor({ ...base, pLegit: 0.2, integrity: 0.4, strongContradiction: true, amountCents: 1000 }).tier).toBe('T5');
    const t = tierFor({ ...base, pLegit: 0.95, reuseConfirmed: true, amountCents: 1000 });
    expect(t.tier).toBe('T5');
    expect(t.autoDecidable).toBe(false);
    expect(t.refundNowCents).toBe(0);
  });
  it('the red band has no cap, so even a strong claim is a partial', () => {
    expect(tierFor({ ...base, pLegit: 0.95, band: 'red', amountCents: 500 }).tier).toBe('T2');
    expect(tierFor({ ...base, pLegit: 0.95, band: 'green', amountCents: 19_000 }).tier).toBe('T1');
  });
});

describe('credit', () => {
  it('the worked example: +6 at the return scan with P 0.9027 and X 1.094 rounds to +5', () => {
    expect(creditDelta('partial_or_return_matches', 0.9027, 0, 1.094)).toBe(5);
  });
  it('negative bases grow with anomaly and are capped at 120 in magnitude', () => {
    expect(creditDelta('decline_on_contradiction', 0.1, 2, 1)).toBe(-63); // −35 × 0.9 × 2
    expect(creditDelta('integrity_confirmed_by_person', 0.05, 5, 1)).toBe(-120);
    expect(creditDelta('override_in_favour', 0.5, 0, 1)).toBe(0);
  });
});
