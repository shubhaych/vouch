import { describe, expect, it } from 'vitest';
import { harness, who } from './testkit';
import { seedWorldImpl } from './economy';
import { takeSeat } from './control';
import { buyFor, fastForwardFor, joinImpl, requestRefundFor } from './consumer';
import { proposeImpl } from './desk';
import { addFindingImpl, autoDecideImpl, setStepImpl, startAnalysisImpl, writeRecommendationImpl } from './review';
import { STEP_KEYS } from './review-types';

const worker = who('worker');
const biz = who('business');
const shopper = who('shopper');

function world() {
  const k = harness();
  k.as(worker, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'desk-lead', businessId: 0 }));
  k.as(worker, (ctx) => ctx.db.seatCode.insert({ role: 'business', code: 'b-code' }));
  k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false));
  k.as(biz, (ctx) => takeSeat(ctx, 'b-code'));
  k.as(shopper, (ctx) => joinImpl(ctx, 'judge'));
  const agentId = k.as(shopper, (ctx) => ctx.db.shopperLink.who.find(ctx.sender)!.agentId);
  const p = k.as(shopper, (ctx) => buyFor(ctx, agentId, 2, 1, 'live')); // $249 at Business B
  k.as(shopper, (ctx) => fastForwardFor(ctx, agentId, p.id));
  const c = k.as(shopper, (ctx) => requestRefundFor(ctx, agentId, p.id, 'defective', 'the left earbud does not charge'));
  const jobId = c.id * 100n + 1n;
  k.as(worker, (ctx) => startAnalysisImpl(ctx, c.id, jobId, 'live'));
  return { k, agentId, claim: c, refundId: c.refundId, jobId };
}

const art = (jobId: bigint, n: number) => ({ jobId, id: jobId * 1000n + BigInt(n), kind: 'chart', path: `work/chart_${n}.png`, url: '', tStart: 1, tEnd: 3, label: 'luminance', sha256: 'abc' });

describe('the reviewer tables', () => {
  it('startAnalysis opens a job with one row per step and puts the claim under investigation', () => {
    const { k, claim, jobId } = world();
    const steps = [...k.db.analysisStep.jobId.filter(jobId)];
    expect(steps.map((s) => s.key)).toEqual([...STEP_KEYS]);
    expect(steps.find((s) => s.key === 'ingest')!.status).toBe('running');
    expect(k.db.claim.id.find(claim.id)!.status).toBe('investigating');
    expect(() => k.as(worker, (ctx) => startAnalysisImpl(ctx, claim.id, jobId, 'live'))).toThrow(/already used/);
    expect(() => k.as(shopper, (ctx) => startAnalysisImpl(ctx, claim.id, jobId + 1n, 'live'))).toThrow(/requires role/);
  });

  it('a second job supersedes the running one', () => {
    const { k, claim, jobId } = world();
    k.as(worker, (ctx) => startAnalysisImpl(ctx, claim.id, jobId + 1n, 'live'));
    expect(k.db.analysisJob.id.find(jobId)!.status).toBe('failed');
    expect(k.db.analysisJob.id.find(jobId + 1n)!.status).toBe('running');
  });

  it('setStep keeps the status when given an empty one, so live notes do not change state', () => {
    const { k, jobId } = world();
    k.as(worker, (ctx) => setStepImpl(ctx, jobId, 'droid_case', 'running', '', 'Reading claims.json'));
    k.as(worker, (ctx) => setStepImpl(ctx, jobId, 'droid_case', '', '', 'Running probe:luminance on 00:11-00:14'));
    const s = [...k.db.analysisStep.jobId.filter(jobId)].find((x) => x.key === 'droid_case')!;
    expect(s.status).toBe('running');
    expect(s.liveNote).toContain('probe:luminance');
    expect(s.startedAt).toBeDefined();
    k.as(worker, (ctx) => setStepImpl(ctx, jobId, 'droid_case', 'done', '2 findings', ''));
    const d = [...k.db.analysisStep.jobId.filter(jobId)].find((x) => x.key === 'droid_case')!;
    expect(d.status).toBe('done');
    expect(d.summary).toBe('2 findings');
    expect(d.liveNote).toBe('');
    expect(() => k.as(worker, (ctx) => setStepImpl(ctx, jobId, 'nope', 'done', '', ''))).toThrow(/unknown step/);
  });

  it('a finding must cite an existing artifact of its own job', () => {
    const { k, jobId } = world();
    const f = { jobId, id: jobId * 1000n + 1n, kind: 'supports', spokenClaimId: 'c1', observation: 'the LED stays dark', tStart: 2, tEnd: 4, confidence: 0.8, method: 'probe:luminance' };
    expect(() => k.as(worker, (ctx) => addFindingImpl(ctx, { ...f, artifactIds: [] }))).toThrow(/at least one artifact/);
    expect(() => k.as(worker, (ctx) => addFindingImpl(ctx, { ...f, artifactIds: [jobId * 1000n + 7n] }))).toThrow(/does not belong/);
    k.as(worker, (ctx) => { ctx.db.artifact.insert(art(jobId, 7)); });
    k.as(worker, (ctx) => addFindingImpl(ctx, { ...f, artifactIds: [jobId * 1000n + 7n] }));
    expect(k.db.finding.id.find(f.id)!.auditStatus).toBe('pending');
    expect(() => k.as(worker, (ctx) => addFindingImpl(ctx, { ...f, kind: 'guess', artifactIds: [jobId * 1000n + 7n] }))).toThrow(/finding kind/);
    expect(() => k.as(worker, (ctx) => addFindingImpl(ctx, { ...f, id: f.id + 1n, confidence: 1.5, artifactIds: [jobId * 1000n + 7n] }))).toThrow(/confidence/);
  });

  it('a recommendation can never exceed the amount requested', () => {
    const { k, claim, jobId } = world();
    const rec = { claimId: claim.id, jobId, tier: 'T2', refundNow: 20_000, refundOnReturn: 10_000, returnRequired: true, reasonsJson: '[]', creaoReview: '', creaoRunId: '' };
    expect(() => k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec))).toThrow(/never exceed/);
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, { ...rec, refundOnReturn: 4_900 }));
    expect(k.db.recommendation.claimId.find(claim.id)!.tier).toBe('T2');
  });
});

describe('autoDecide', () => {
  const propose = (refundId: bigint, amount: number) => ({ refundId, action: 'accept', amount, method: 'original_payment', confidence: 0.9, reasonsJson: '[]', runId: 'job', runUrl: '' });
  const rec = (claimId: bigint, jobId: bigint, extra: Partial<{ tier: string; refundNow: number; creaoReview: string }> = {}) => ({
    claimId, jobId, tier: 'T1', refundNow: 8_000, refundOnReturn: 0, returnRequired: false, reasonsJson: '[]', creaoReview: JSON.stringify({ agrees: true }), creaoRunId: 'fixture', ...extra,
  });

  it('pays a T1 within the limit after the reviewer agreed, once, and leaves a decision a person can read', () => {
    const { k, claim, refundId, jobId, agentId } = world();
    k.as(worker, (ctx) => proposeImpl(ctx, propose(refundId, 8_000)));
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec(claim.id, jobId)));
    const before = k.db.agent.id.find(agentId)!.score;
    k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 8_000, 'tier T1 within the limit'));
    expect(k.db.refund.id.find(refundId)!.status).toBe('accepted');
    expect(k.db.claim.id.find(claim.id)!.status).toBe('decided');
    expect(k.db.recommendation.claimId.find(claim.id)!.autoDecided).toBe(true);
    expect(k.db.agent.id.find(agentId)!.score).toBe(before); // the Score Reviewer changes it afterwards, not the payout
    const d = [...k.db.decision.refundId.filter(refundId)][0]!;
    expect(d.status).toBe('decided');
    expect(d.finalAmount).toBe(8_000);
    expect(() => k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 8_000, ''))).toThrow(/not open/);
  });

  it('refuses without reviewer agreement, above the limit, for T3+, and for anyone but the worker', () => {
    const { k, claim, refundId, jobId } = world();
    k.as(worker, (ctx) => proposeImpl(ctx, propose(refundId, 24_900)));
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec(claim.id, jobId, { creaoReview: '' })));
    expect(() => k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 8_000, ''))).toThrow(/Reviewer has not agreed/);
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec(claim.id, jobId, { creaoReview: JSON.stringify({ agrees: false }) })));
    expect(() => k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 8_000, ''))).toThrow(/Reviewer has not agreed/);
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec(claim.id, jobId, { refundNow: 24_900 })));
    expect(() => k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 24_900, ''))).toThrow(/above the auto-approve limit/);
    k.as(worker, (ctx) => writeRecommendationImpl(ctx, rec(claim.id, jobId, { tier: 'T3', refundNow: 0 })));
    expect(() => k.as(worker, (ctx) => autoDecideImpl(ctx, refundId, 1_000, ''))).toThrow(/never decided automatically/);
    expect(() => k.as(biz, (ctx) => autoDecideImpl(ctx, refundId, 1_000, ''))).toThrow(/requires role/);
    expect(k.db.refund.id.find(refundId)!.status).toBe('recommended');
  });
});
