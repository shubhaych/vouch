import { describe, expect, it } from 'vitest';
import { fixtureResponse } from '../src/fixtures';
import { guardPolicyCheck, guardScorecard } from '../src/orchestrator';

describe('Policy Checker guard', () => {
  const ctx = { withinWindow: true, reasonAllowed: true, amountRequested: 249 };
  it('lets "not_eligible" stand only when the deterministic window or reason check failed', () => {
    expect(guardPolicyCheck({ outcome: 'not_eligible', rules: [] }, ctx).outcome).toBe('needs_person');
    expect(guardPolicyCheck({ outcome: 'not_eligible', rules: [] }, { ...ctx, withinWindow: false }).outcome).toBe('not_eligible');
    expect(guardPolicyCheck({ outcome: 'eligible', rules: [] }, { ...ctx, reasonAllowed: false }).outcome).toBe('needs_person');
  });
  it('caps the refund shape at the amount requested and drops unknown rules', () => {
    const g = guardPolicyCheck({ outcome: 'eligible', rules: [{ rule: 'window', result: 'pass', detail: '', cites: 'policy:window' }, { rule: 'vibes', result: 'pass', detail: '', cites: '' }], refund_shape: { max_amount: 900 } }, ctx);
    expect(g.refund_shape!.max_amount).toBe(249);
    expect(g.rules!.map((r) => r.rule)).toEqual(['window']);
  });
});

describe('Risk Scorecard guard', () => {
  it('lowers a "high" caution that did not disclaim region, and drops unknown indicators', () => {
    const g = guardScorecard({ caution: 'high', indicators: [{ name: 'refund_ratio_90d', value: 0.6, reading: 'caution', weight: 2, why: 'x', cites: 'history:refund_ratio_90d' }, { name: 'zip_code', value: '', reading: 'caution', weight: 1, why: '', cites: '' }] });
    expect(g.caution).toBe('medium');
    expect(g.indicators).toHaveLength(1);
    expect(g.indicators![0]!.weight).toBe(1);
    expect(guardScorecard({ caution: 'high', indicators: [], signals_not_used: 'Shared region or business was not used.' }).caution).toBe('high');
    expect(guardScorecard({ caution: 'severe', indicators: [] }).caution).toBe('unknown');
  });
});

const policyCase = {
  claim_id: 'C-1', claim: { reason_code: 'defective', amount_requested: 249 }, policy: { window_days: 30, restocking_fee_pct: 0, store_credit_allowed: true, needs_video_over: 100, notes: '' },
  checks: { within_window: true, days_since_delivery: 4, reason_allowed: true, over_video_threshold: true, has_video: true }, listing_match: { same_as_ordered: 'true' },
};

describe('Policy Checker fixture', () => {
  it('passes every rule for a clean in-window defective claim', () => {
    const r = fixtureResponse('policy_checker', policyCase) as { outcome: string; rules: { rule: string; result: string }[] };
    expect(r.outcome).toBe('eligible');
    expect(r.rules.find((x) => x.rule === 'window')!.result).toBe('pass');
  });
  it('is not eligible outside the window but says the store can make an exception', () => {
    const r = fixtureResponse('policy_checker', { ...policyCase, checks: { ...policyCase.checks, within_window: false } }) as { outcome: string; exception_note: string };
    expect(r.outcome).toBe('not_eligible');
    expect(r.exception_note).toMatch(/exception/);
  });
  it('sends a policy note to a person', () => {
    const r = fixtureResponse('policy_checker', { ...policyCase, policy: { ...policyCase.policy, notes: 'Physical damage from misuse is not covered' } }) as { outcome: string };
    expect(r.outcome).toBe('needs_person');
  });
});

describe('Risk Scorecard fixture', () => {
  const base = {
    claim_id: 'C-2', history: { account_age_days: 120, refund_ratio_90d: 0.08, refunds_requested_90d: 2, refunds_declined_total: 0, band: 'neutral' },
    credential: { presented: true, verified: true, issuer: 'B-019' }, patterns: [], identity: { status: 'not_run' },
    item_context: { pulse: null, business_context: { claims_last_30d: 1, units_sold_last_30d: 100 } }, video_checks: { frame_reuse_count: 0, still_image: false, challenge_passed: true, unable_to_verify: false },
  };
  it('reads a clean history as low caution with the credential as support', () => {
    const r = fixtureResponse('risk_scorecard', base) as { caution: string; indicators: { name: string; reading: string }[] };
    expect(r.caution).toBe('low');
    expect(r.indicators.find((i) => i.name === 'credential')!.reading).toBe('supports');
  });
  it('reads frame reuse and a confirmed pattern as high caution, and still calls it context', () => {
    const r = fixtureResponse('risk_scorecard', { ...base, patterns: [{ id: 'FR-028', status: 'confirmed' }], video_checks: { ...base.video_checks, frame_reuse_count: 1 } }) as { caution: string; summary: string };
    expect(r.caution).toBe('high');
    expect(r.summary).toMatch(/none of them decides/);
  });
  it('points at the item, not the shopper, when the item is spiking', () => {
    const r = fixtureResponse('risk_scorecard', { ...base, item_context: { pulse: { count: 12, spike: true }, business_context: { claims_last_30d: 20, units_sold_last_30d: 100 } } }) as { innocent_explanation_considered: string; indicators: { name: string; reading: string }[] };
    expect(r.innocent_explanation_considered).toMatch(/defective batch/);
    expect(r.indicators.find((i) => i.name === 'defective_batch_context')!.reading).toBe('supports');
  });
});
