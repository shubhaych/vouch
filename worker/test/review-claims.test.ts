import { describe, expect, it } from 'vitest';
import { heuristicClaims, sentences } from '../src/review/claims';
import { claimNeedsReview, customerLine } from '../src/review/runner';
import { scoreClaim } from '../src/review/score-claim';
import type { FindingRec } from '../src/review/state';
import type { HistoryInput } from '@vouch/module/review-score';

describe('spoken claims without Droid', () => {
  it('splits the written reason into checkable claims with kinds and spread-out times', () => {
    const claims = heuristicClaims({ transcript: null, reasonText: 'The lamp does not turn on. The base arrived scratched; thanks!', reasonCode: 'defective', itemName: 'Desk lamp', durationS: 30 });
    expect(claims.map((c) => c.kind)).toEqual(['functional', 'defect']);
    expect(claims.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(claims[0]!.tSaid).toBeLessThan(claims[1]!.tSaid);
    expect(sentences('hi. ok. The strap broke')).toEqual(['The strap broke']);
  });
  it('uses transcript word times when there is speech', () => {
    const words = 'so the left earbud has no sound at all'.split(' ').map((w, i) => ({ w, start: 4 + i * 0.3, end: 4.3 + i * 0.3 }));
    const claims = heuristicClaims({ transcript: { segments: [{ start: 4, end: 7, text: 'so the left earbud has no sound at all.' }], words }, reasonText: 'no sound', reasonCode: 'defective', itemName: 'Wireless earbuds', durationS: 20 });
    expect(claims).toHaveLength(1);
    expect(claims[0]!.kind).toBe('functional');
    expect(claims[0]!.tSaid).toBeGreaterThanOrEqual(4);
    expect(claims[0]!.tSaid).toBeLessThan(6);
  });
});

const history: HistoryInput = { tenureDays: 400, orders: 12, refunds365: 1, categoryBaseline: 0.1, pastPricesCents: [4000, 6000, 5000], priceCents: 5000, refundsThisMonth: 1, filedAtFractionOfWindow: 0.2, verifiedIdentity: 'unknown' };
const f = (over: Partial<FindingRec>): FindingRec => ({ id: 1n, kind: 'supports', spokenClaimId: 'c1', observation: 'x', tStart: 1, tEnd: 2, confidence: 0.9, artifactIds: [1n], method: 'looked', auditStatus: 'passed', auditNote: '', ...over });
const claims = [{ id: 'c1', text: 'it does not turn on', kind: 'functional' as const, tSaid: 5 }];

describe('scoring a claim', () => {
  it('a supported claim with clean integrity reaches T1 inside the limit, and T2 above it', () => {
    const base = { claims, findings: [f({})], flags: [], history, autoApproveLimitCents: 10_000, band: 'neutral' as const, lanesOnly: false };
    expect(scoreClaim({ ...base, amountCents: 5000 }).tier.tier).toBe('T1');
    const over = scoreClaim({ ...base, amountCents: 30_000 });
    expect(over.tier.tier).toBe('T2');
    expect(over.tier.refundNowCents + over.tier.refundOnReturnCents).toBe(30_000);
  });
  it('lanes-only never pays out: T1 is capped at T3 and the cap is explained', () => {
    const s = scoreClaim({ claims, findings: [f({})], flags: [], history, amountCents: 5000, autoApproveLimitCents: 10_000, band: 'neutral', lanesOnly: true });
    expect(s.capped).toBe(true);
    expect(s.tier.tier).toBe('T3');
    expect(s.tier.autoDecidable).toBe(false);
    expect(s.tier.reasons.some((r) => r.cites === 'method:lanesOnly')).toBe(true);
  });
  it('rejected findings do not count, so an unsupported claim asks for more evidence (never a decline)', () => {
    const s = scoreClaim({ claims, findings: [f({ auditStatus: 'rejected' })], flags: [], history, amountCents: 5000, autoApproveLimitCents: 10_000, band: 'neutral', lanesOnly: false });
    expect(s.tier.tier).toBe('T4');
    expect(s.tier.evidenceRequested?.[0]).toMatch(/it does not turn on/);
    expect(s.tier.refundNowCents).toBe(0);
  });
  it('confirmed frame reuse is T5 (a person), and a strong contradiction with broken integrity too', () => {
    const reuse = scoreClaim({ claims, findings: [f({})], flags: [{ kind: 'frame_reuse', confidence: 0.9 }], history, amountCents: 5000, autoApproveLimitCents: 10_000, band: 'neutral', lanesOnly: false });
    expect(reuse.tier.tier).toBe('T5');
    const contra = scoreClaim({ claims, findings: [f({ kind: 'contradicts', confidence: 0.9 })], flags: [{ kind: 'recapture', confidence: 1 }, { kind: 'challenge_failed', confidence: 1 }], history, amountCents: 5000, autoApproveLimitCents: 10_000, band: 'neutral', lanesOnly: false });
    expect(contra.tier.tier).toBe('T5');
    expect(contra.creditPreview).toBeNull();
  });
});

describe('which claims the reviewer takes', () => {
  it('live claims with a video once frames are ready; crashed ones at start-up; never simulated ones', () => {
    expect(claimNeedsReview({ status: 'frames_ready', kind: 'live', videoUrl: 'u' }, false, false)).toBe(true);
    expect(claimNeedsReview({ status: 'frames_ready', kind: 'simulated', videoUrl: '' }, false, false)).toBe(false);
    expect(claimNeedsReview({ status: 'frames_ready', kind: 'live', videoUrl: '' }, false, false)).toBe(false);
    expect(claimNeedsReview({ status: 'investigating', kind: 'live', videoUrl: 'u' }, true, false)).toBe(true);
    expect(claimNeedsReview({ status: 'investigating', kind: 'live', videoUrl: 'u' }, true, true)).toBe(false);
    expect(claimNeedsReview({ status: 'investigating', kind: 'live', videoUrl: 'u' }, false, false)).toBe(false);
    expect(claimNeedsReview({ status: 'recommended', kind: 'live', videoUrl: 'u' }, true, false)).toBe(false);
  });
  it('customer lines never mention a decline', () => {
    for (const t of ['T1', 'T2', 'T3', 'T4', 'T5'] as const) expect(customerLine(t, 1000, 2000)).not.toMatch(/declin|denied|fraud/i);
  });
});
