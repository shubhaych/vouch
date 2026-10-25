import { describe, expect, it } from 'vitest';
import { evaluateScoreVerdict, scoreRule, type ScoreInput } from '../src/review/score-rule';

// The CREAO Score Reviewer judges inside its brief; the worker checks the answer before the module applies it.
const base: ScoreInput = { decision: 'accepted', amountCents: 2900, requestedCents: 2900, factory: { action: 'accept', status: 'validated' }, challenge: 'passed', contradicted: false, shopper: { score: 612, band: 'neutral' } };
const declined: ScoreInput = { ...base, decision: 'declined', factory: { action: 'decline', status: 'validated' }, contradicted: true };
const inconclusive: ScoreInput = { ...base, decision: 'declined', factory: { action: 'more_evidence', status: 'needs_review' }, contradicted: false };

describe('score verdict evaluation', () => {
  it('accepts a supported gain and a contradicted loss as given', () => {
    expect(evaluateScoreVerdict(base, { direction: 'gain', delta: 12, reason: 'Refund accepted with the problem shown clearly on video.' })).toMatchObject({ ok: true, out: { direction: 'gain', delta: 12 }, notes: [] });
    expect(evaluateScoreVerdict(declined, { direction: 'loss', delta: -40, reason: 'Declined: the video contradicted the claim.' })).toMatchObject({ ok: true, out: { direction: 'loss', delta: -40 } });
  });

  it('clamps to the bounds and notes it', () => {
    const r = evaluateScoreVerdict(base, { direction: 'gain', delta: 40, reason: 'Clearly shown on video, full amount.' });
    expect(r).toMatchObject({ ok: true, out: { delta: 15 } });
    expect(r.ok && r.notes[0]).toMatch(/clamped to 15/);
    expect(evaluateScoreVerdict(declined, { direction: 'loss', delta: -200, reason: 'Verified fraud on this claim.' })).toMatchObject({ ok: true, out: { delta: -60 } });
  });

  it('rejects a direction the decision rules out', () => {
    expect(evaluateScoreVerdict(declined, { direction: 'gain', delta: 5, reason: 'The shopper was polite throughout.' })).toMatchObject({ ok: false, why: expect.stringMatching(/declined claim cannot gain/) });
    expect(evaluateScoreVerdict(base, { direction: 'loss', delta: -10, reason: 'The video was shaky and short.' })).toMatchObject({ ok: false, why: expect.stringMatching(/accepted claim cannot lose/) });
  });

  it('rejects a delta whose sign contradicts the direction, or no reason', () => {
    expect(evaluateScoreVerdict(base, { direction: 'gain', delta: -3, reason: 'Accepted with the defect on video.' })).toMatchObject({ ok: false });
    expect(evaluateScoreVerdict(base, { direction: 'same', delta: 4, reason: 'Accepted without video support.' })).toMatchObject({ ok: false });
    expect(evaluateScoreVerdict(base, { direction: 'gain', delta: 'lots', reason: 'Accepted with the defect on video.' })).toMatchObject({ ok: false });
    expect(evaluateScoreVerdict(base, { direction: 'gain', delta: 8, reason: '' })).toMatchObject({ ok: false, why: 'no readable reason' });
    expect(evaluateScoreVerdict(base, 'yes')).toMatchObject({ ok: false });
  });

  it('keeps an inconclusive decline a small loss', () => {
    const r = evaluateScoreVerdict(inconclusive, { direction: 'loss', delta: -45, reason: 'Declined by the store.' });
    expect(r).toMatchObject({ ok: true, out: { delta: -15 } });
    expect(evaluateScoreVerdict(inconclusive, { direction: 'loss', delta: -8, reason: 'Declined on inconclusive evidence.' })).toMatchObject({ ok: true, out: { delta: -8 } });
  });

  it('an accept the footage did not support cannot gain; a missed challenge is never a loss', () => {
    const unsupported: ScoreInput = { ...base, factory: { action: 'more_evidence', status: 'validated', nextStep: 'human_review' }, challenge: 'failed' };
    expect(evaluateScoreVerdict(unsupported, { direction: 'gain', delta: 6, reason: 'Accepted by the store manager.' })).toMatchObject({ ok: false, why: expect.stringMatching(/video support/) });
    expect(evaluateScoreVerdict(unsupported, { direction: 'same', delta: 0, reason: 'Accepted without video support; a missed challenge is not a reason to lower the score.' })).toMatchObject({ ok: true, out: { delta: 0 } });
    expect(scoreRule(unsupported)).toMatchObject({ direction: 'same', delta: 0 });
  });

  it('the rule itself passes the evaluation for every decision shape', () => {
    for (const i of [base, declined, inconclusive, { ...declined, verifiedFraud: true }, { ...base, amountCents: 1000 }, { ...base, extraClipUsed: true }]) {
      expect(evaluateScoreVerdict(i, scoreRule(i))).toMatchObject({ ok: true, notes: [] });
    }
  });
});
