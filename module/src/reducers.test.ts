import { describe, expect, it } from 'vitest';
import { SenderError } from 'spacetimedb/server';
import { harness, who } from './testkit';
import { seedWorldImpl, tickImpl } from './economy';
import { takeSeat, setControlImpl } from './control';
import { buyFor, fastForwardFor, joinImpl, requestRefundFor } from './consumer';
import { decideImpl, postImpl, proposeImpl } from './desk';
import { confirmPatternImpl, flagPatternImpl } from './patterns';
import { openInvestigationImpl } from './claims';
import { LAB_CAP_PER_RUN, enqueueLabJob } from './lab';
import { applyScoreReviewImpl } from './review';
import type { Ctx } from './ctx';

const worker = who('worker');
const poster = who('poster');
const biz = who('business');
const boss = who('controller');
const shopper = who('shopper');

function world() {
  const k = harness();
  k.as(worker, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'desk-lead', businessId: 0 }));
  k.as(poster, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'poster', label: 'ledger-poster', businessId: 0 }));
  k.as(worker, (ctx) => {
    ctx.db.seatCode.insert({ role: 'business', code: 'b-code' });
    ctx.db.seatCode.insert({ role: 'controller', code: 'c-code' });
  });
  k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false));
  k.as(biz, (ctx) => takeSeat(ctx, 'b-code'));
  k.as(boss, (ctx) => takeSeat(ctx, 'c-code'));
  return k;
}

/** A live claim on a $249 (or pricier) item at Business B, ready for the desk. */
function liveClaim(k: ReturnType<typeof world>, sku = 1) {
  k.as(shopper, (ctx) => joinImpl(ctx, 'judge'));
  const agentId = k.as(shopper, (ctx) => ctx.db.shopperLink.who.find(ctx.sender)!.agentId);
  const p = k.as(shopper, (ctx) => buyFor(ctx, agentId, 2, sku, 'live'));
  k.as(shopper, (ctx) => fastForwardFor(ctx, agentId, p.id));
  const c = k.as(shopper, (ctx) => requestRefundFor(ctx, agentId, p.id, 'defective', 'cracked out of the box'));
  return { agentId, purchase: p, claim: c, refundId: c.refundId };
}

const proposal = (refundId: bigint, amount: number, action = 'accept') => ({
  refundId, action, amount, method: 'original_payment', confidence: 0.8, reasonsJson: JSON.stringify([{ text: 'crack visible', cites: 'frame:3' }]), runId: 'run-1', runUrl: '',
});

describe('seeding through the reducer', () => {
  it('T1.1 refuses to reseed without force, reseeds with force', () => {
    const k = world();
    expect(k.db.agent.count()).toBe(600n);
    expect(() => k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false))).toThrow(/already seeded/);
    k.as(worker, (ctx) => seedWorldImpl(ctx, 12n, 700, true));
    expect(k.db.agent.count()).toBe(700n);
  });

  it('only the worker or controller may seed', () => {
    const k = harness();
    expect(() => k.as(shopper, (ctx) => seedWorldImpl(ctx, 1n, 600, false))).toThrow(/requires role/);
  });

  it('the tick advances the day inside the module', () => {
    const k = world();
    const before = k.db.simRun.id.find(1)!.day;
    for (let i = 0; i < 2; i++) k.as(worker, (ctx) => tickImpl(ctx)); // 600 agents, 1000 per tick: one tick = one day
    expect(k.db.simRun.id.find(1)!.day).toBe(before + 2);
    expect(k.db.metrics.id.find(1)!.ticksObserved).toBe(2n);
  });
});

describe('T2.9 segregation of duties', () => {
  it('the proposer cannot decide, a business seat cannot accept above $500, the controller can', () => {
    const k = world();
    const { refundId } = liveClaim(k, 1); // $249
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 24_900)));
    expect(() => k.as(worker, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''))).toThrow(/requires role/);
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, 'ok'));
    expect(k.db.refund.id.find(refundId)!.status).toBe('accepted');
  });

  it('above $500 a business accept goes to the controller', () => {
    const k = world();
    const { refundId } = liveClaim(k, 21); // the $649 OLED monitor at Business B
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 64_900)));
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 64_900, ''));
    expect(k.db.refund.id.find(refundId)!.status).toBe('awaiting_controller');
    k.as(boss, (ctx) => decideImpl(ctx, refundId, 'accept', 64_900, 'approved above materiality'));
    expect(k.db.refund.id.find(refundId)!.status).toBe('accepted');
  });

  it('T2.8 accept leaves the score to the Score Reviewer, and only a balanced entry by the poster is posted', () => {
    const k = world();
    const { refundId, agentId } = liveClaim(k, 1);
    const before = k.db.agent.id.find(agentId)!.score;
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 24_900)));
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''));
    // A real claim's score is not changed by the decision itself: the CREAO Score Reviewer judges it afterwards.
    expect(k.db.agent.id.find(agentId)!.score).toBe(before);
    k.as(worker, (ctx) => applyScoreReviewImpl(ctx, { refundId, direction: 'gain', delta: 50, reason: 'Defect shown clearly on video', runId: 'r1', provenance: 'fixture' }));
    expect(k.db.agent.id.find(agentId)!.score).toBe(before + 15); // bounded: a gain is at most +15
    expect(k.db.scoreReview.refundId.find(refundId)?.reason).toBe('Defect shown clearly on video');
    expect(() => k.as(worker, (ctx) => applyScoreReviewImpl(ctx, { refundId, direction: 'gain', delta: 5, reason: 'again', runId: 'r2', provenance: 'fixture' }))).toThrow(/already/);
    const d = [...k.db.decision.refundId.filter(refundId)][0]!;
    const lines = [{ account: 'Refunds expense', cents: 24_900n }, { account: 'Cash', cents: -24_900n }];
    expect(() => k.as(worker, (ctx) => postImpl(ctx, d.id, 'refund', lines))).toThrow(/only the ledger poster/);
    expect(() => k.as(poster, (ctx) => postImpl(ctx, d.id, 'refund', [lines[0]!, { account: 'Cash', cents: -24_000n }]))).toThrow(/does not balance/);
    k.as(poster, (ctx) => postImpl(ctx, d.id, 'refund', lines));
    expect(k.db.decision.id.find(d.id)!.status).toBe('posted');
    expect(k.db.journalLine.count()).toBe(2n);
  });

  it('a CREAO decline verdict scores at once, but only a person can decline the refund', () => {
    const k = world();
    const { refundId, agentId } = liveClaim(k, 1);
    const before = k.db.agent.id.find(agentId)!.score;
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 0, 'decline')));
    k.as(worker, (ctx) => applyScoreReviewImpl(ctx, { refundId, direction: 'loss', delta: -40, reason: 'Video shows the item intact', runId: 'r', provenance: 'rule' }));
    expect(k.db.agent.id.find(agentId)!.score).toBe(before - 40);
    expect(k.db.refund.id.find(refundId)!.status).toBe('recommended');
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'decline', 0, 'item intact'));
    expect(k.db.refund.id.find(refundId)!.status).toBe('declined');
    expect(k.db.agent.id.find(agentId)!.score).toBe(before - 40);
  });

  it('a CREAO accept or decline verdict can move the score before a person decides; more evidence cannot', () => {
    const k = world();
    const { refundId, agentId } = liveClaim(k, 1);
    const before = k.db.agent.id.find(agentId)!.score;
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 0, 'more_evidence')));
    expect(() => k.as(worker, (ctx) => applyScoreReviewImpl(ctx, { refundId, direction: 'gain', delta: 10, reason: 'x', runId: 'r', provenance: 'rule' }))).toThrow(/CREAO verdict/);
    k.as(worker, (ctx) => proposeImpl(ctx, proposal(refundId, 24_900)));
    k.as(worker, (ctx) => applyScoreReviewImpl(ctx, { refundId, direction: 'gain', delta: 12, reason: 'Wrong colour shown clearly', runId: 'r', provenance: 'panel_live' }));
    expect(k.db.agent.id.find(agentId)!.score).toBe(before + 12);
    expect(k.db.scoreReview.refundId.find(refundId)?.decision).toBe('creao_accept');
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''));
    expect(k.db.agent.id.find(agentId)!.score).toBe(before + 12);
  });
});

describe('T2.7 kill switch', () => {
  it('with no recommendation a person can only request more evidence', () => {
    const k = world();
    k.as(biz, (ctx) => setControlImpl(ctx, 'creao_enabled', 'false'));
    expect(k.db.control.key.find('creao_enabled')!.value).toBe('false');
    const { refundId } = liveClaim(k, 1);
    expect(() => k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''))).toThrow(/Investigator offline/);
    k.as(biz, (ctx) => decideImpl(ctx, refundId, 'more_evidence', 0, ''));
    expect(k.db.refund.id.find(refundId)!.status).toBe('more_evidence');
  });

  it('a shopper cannot flip controls; demo_mode is the controller only', () => {
    const k = world();
    expect(() => k.as(shopper, (ctx) => setControlImpl(ctx, 'creao_enabled', 'false'))).toThrow(/requires role/);
    expect(() => k.as(biz, (ctx) => setControlImpl(ctx, 'demo_mode', 'true'))).toThrow(/requires role/);
    k.as(boss, (ctx) => setControlImpl(ctx, 'demo_mode', 'true'));
  });
});

describe('patterns and the Droid Lab triggers (T3.7, T4.1)', () => {
  const flag = (ctx: Ctx, agents: number[], version = 1) =>
    flagPatternImpl(ctx, {
      kind: 'coordinated', detectorId: 'coordinated', detectorVersion: version, firstDay: 120, lastDay: 125, agentIds: agents, businessIds: [2, 7],
      featuresJson: JSON.stringify({ agents: agents.length }), events: [{ table: 'refund', id: 1n, kind: 'refund', agentId: agents[0]!, businessId: 2, amount: 8_900, day: 124, text: 'cracked', why: 'similar text' }],
    });

  it('confirm applies -120 to core agents only; the same pattern is never flagged twice', () => {
    const k = world();
    const p = k.as(worker, (ctx) => flag(ctx, [10, 11, 12, 13]))!;
    expect(k.as(worker, (ctx) => flag(ctx, [13, 12, 11, 10]))).toBeNull();
    const before = [10, 11, 12, 13].map((id) => k.db.agent.id.find(id)!.score);
    const roles = [{ id: 'A-00010', role: 'core' }, { id: 'A-00011', role: 'core' }, { id: 'A-00012', role: 'peripheral' }, { id: 'A-00013', role: 'not_involved' }];
    k.as(worker, (ctx) => confirmPatternImpl(ctx, { patternId: p.id, verdict: 'confirm', runId: 'r', runUrl: '', narrative: 'n', rolesJson: JSON.stringify(roles) }));
    const after = [10, 11, 12, 13].map((id) => k.db.agent.id.find(id)!.score);
    expect(after[0]).toBe(before[0]! - 120);
    expect(after[1]).toBe(before[1]! - 120);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
    expect(k.db.fraudPattern.id.find(p.id)!.status).toBe('confirmed');
  });

  it('marks a detector hit as simulated ground-truth confirmation for a single planted ring, without changing credit', () => {
    const k = world();
    for (const id of [50, 51, 52, 53]) k.db.agentTruth.agentId.update({ agentId: id, kind: 'ring', ringId: 9 });
    const before = [50, 51, 52, 53].map((id) => k.db.agent.id.find(id)!.score);
    const p = k.as(worker, (ctx) => flag(ctx, [50, 51, 52, 53]))!;
    expect(p.status).toBe('simulated_confirmed');
    expect(p.narrative).toContain('private ring label');
    expect([50, 51, 52, 53].map((id) => k.db.agent.id.find(id)!.score)).toEqual(before);
  });

  it('a dismissal enqueues an event job; two needs_review enqueue an agent job; the tick enqueues a schedule job', () => {
    const k = world();
    const a = k.as(worker, (ctx) => flag(ctx, [20, 21, 22, 23]))!;
    k.as(worker, (ctx) => confirmPatternImpl(ctx, { patternId: a.id, verdict: 'dismiss', runId: 'r', runUrl: '', narrative: 'defective batch', rolesJson: '[]' }));
    const b = k.as(worker, (ctx) => flag(ctx, [30, 31, 32, 33], 2))!;
    const c = k.as(worker, (ctx) => flag(ctx, [40, 41, 42, 43], 2))!;
    k.as(worker, (ctx) => confirmPatternImpl(ctx, { patternId: b.id, verdict: 'needs_review', runId: 'r', runUrl: '', narrative: '', rolesJson: '[]' }));
    k.as(worker, (ctx) => confirmPatternImpl(ctx, { patternId: c.id, verdict: 'needs_review', runId: 'r', runUrl: '', narrative: '', rolesJson: '[]' }));
    for (let i = 0; i < 31; i++) k.as(worker, (ctx) => tickImpl(ctx));
    const triggers = [...k.db.labJob.iter()].map((j) => j.trigger).sort();
    expect(triggers).toEqual(['agent', 'event', 'schedule']);
  });

  it('QA-005 one schedule job per simulation run; every job counts toward the cap; a reseed starts a new run', () => {
    const k = world();
    const schedule = () => [...k.db.labJob.iter()].filter((j) => j.trigger === 'schedule').length;
    for (let i = 0; i < 200; i++) k.as(worker, (ctx) => tickImpl(ctx));
    expect(schedule()).toBe(1);
    // A job that ran without Droid (replay mode, failed) still uses the run's budget.
    const finish = () => k.as(worker, (ctx) => { for (const j of [...ctx.db.labJob.iter()]) if (j.status === 'queued') ctx.db.labJob.id.update({ ...j, status: 'failed', mode: 'replay' }); });
    finish();
    const ids: (number | null)[] = [];
    for (let i = 0; i < LAB_CAP_PER_RUN; i++) { ids.push(k.as(worker, (ctx) => enqueueLabJob(ctx, 'user', `goal ${i}`, 'coordinated'))); finish(); }
    expect(ids.filter((x) => x !== null)).toHaveLength(LAB_CAP_PER_RUN - 1);
    expect(ids.at(-1)).toBeNull();
    // demo-reset reseeds with the same seed: that is a new run with a fresh budget.
    k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, true));
    expect(k.as(worker, (ctx) => enqueueLabJob(ctx, 'user', 'after reset', 'coordinated'))).not.toBeNull();
    for (let i = 0; i < 31; i++) k.as(worker, (ctx) => tickImpl(ctx));
    expect(schedule()).toBe(2);
  });

  it('a judge can open a simulated refund for investigation, which takes it off the fast path', () => {
    const k = world();
    for (let i = 0; i < 12; i++) k.as(worker, (ctx) => tickImpl(ctx));
    const open = [...k.db.refund.iter()].find((r) => r.status === 'requested');
    expect(open).toBeDefined();
    const c = k.as(biz, (ctx) => openInvestigationImpl(ctx, open!.id));
    expect(c.status).toBe('frames_ready');
    expect(k.db.refund.id.find(open!.id)!.path).toBe('investigation');
  });
});

// QA-001: SpacetimeDB shows the caller only a SenderError's message; any other throw is a
// panic and the browser sees "The instance encountered a fatal error."
describe('refusals reach the caller as SenderError', () => {
  it('QA-001 role checks, desk rules, seat codes and engine refusals all throw SenderError', () => {
    const k = world();
    const { refundId, agentId } = liveClaim(k, 1);
    const refusals: [string, () => unknown][] = [
      ['requires role', () => k.as(shopper, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''))],
      ['wrong seat code', () => k.as(shopper, (ctx) => takeSeat(ctx, 'not-the-code'))],
      ['already seeded', () => k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false))],
      ['does not sell', () => k.as(shopper, (ctx) => buyFor(ctx, agentId, 2, 101, 'live'))],
    ];
    k.as(biz, (ctx) => setControlImpl(ctx, 'creao_enabled', 'false'));
    refusals.push(['Investigator offline', () => k.as(biz, (ctx) => decideImpl(ctx, refundId, 'accept', 24_900, ''))]);
    for (const [msg, f] of refusals) {
      let err: unknown;
      try { f(); } catch (e) { err = e; }
      expect(err, msg).toBeInstanceOf(SenderError);
      expect((err as Error).message, msg).toContain(msg);
    }
  });
});
