import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, type DecideFlags, type Evidence } from './policy';
import { DEFAULT_POLICY, type Lane, type ReasonCode, type Tier, type Verdict } from './types';

interface Scenario {
  name: string;
  tier: Tier;
  verdict: Verdict;
  amountCents: number;
  flags?: DecideFlags;
  contradicts?: boolean;
  lane: Lane;
  reason?: ReasonCode;
}

// 12 scenarios: honest and abusive, each tier, each verdict. They double as demo data.
const SCENARIOS: Scenario[] = [
  { name: 'tier 3, $48 return, no dispute', tier: 3, verdict: 'not_contested', amountCents: 4_800, lane: 'A', reason: 'WITHIN_INSTANT_CAP' },
  { name: 'tier 2, exactly at the $200 cap', tier: 2, verdict: 'supported', amountCents: 20_000, lane: 'A' },
  { name: 'tier 2, $310 is over its cap', tier: 2, verdict: 'supported', amountCents: 31_000, lane: 'B', reason: 'OVER_INSTANT_CAP' },
  { name: 'tier 3, $620 is inside its $1,000 cap', tier: 3, verdict: 'supported', amountCents: 62_000, lane: 'A' },
  { name: 'tier 3, $1,200 is over its cap', tier: 3, verdict: 'supported', amountCents: 120_000, lane: 'C', reason: 'OVER_HOLD_THRESHOLD' },
  { name: 'tier 1, thin history gets part now', tier: 1, verdict: 'supported', amountCents: 4_800, lane: 'B', reason: 'THIN_HISTORY' },
  { name: 'tier 0, new customer is asked to verify', tier: 0, verdict: 'not_contested', amountCents: 4_800, lane: 'C', reason: 'TIER_0_VERIFY' },
  { name: 'tier 3, partly supported claim', tier: 3, verdict: 'partly_supported', amountCents: 4_800, lane: 'B', reason: 'PARTLY_SUPPORTED' },
  { name: 'tier 3, unable to verify holds', tier: 3, verdict: 'unable_to_verify', amountCents: 4_800, lane: 'C', reason: 'UNABLE_TO_VERIFY' },
  { name: 'tier 3, not supported holds, never denies', tier: 3, verdict: 'not_supported', amountCents: 4_800, lane: 'C', reason: 'NOT_SUPPORTED_HOLD' },
  { name: 'tier 3, duplicate photo across accounts', tier: 3, verdict: 'supported', amountCents: 31_000, flags: { duplicatePhoto: true }, lane: 'D', reason: 'DUPLICATE_PHOTO' },
  { name: 'tier 3, incident on record', tier: 3, verdict: 'supported', amountCents: 4_800, flags: { incident: true }, lane: 'D', reason: 'INCIDENT_ON_RECORD' },
];

for (const s of SCENARIOS) {
  test(s.name, () => {
    const evidence: Evidence = { verdict: s.verdict, contradicts: s.contradicts };
    const d = decide(s.tier, evidence, s.flags ?? {}, { amountCents: s.amountCents });
    assert.equal(d.lane, s.lane);
    if (s.reason) assert.ok(d.reasons.includes(s.reason), `expected ${s.reason}, got ${d.reasons.join(',')}`);
  });
}

test('kill switch: underwriter offline drops a tier 3 instant refund to lane C', () => {
  const d = decide(3, { verdict: 'not_contested' }, { underwriterOffline: true }, { amountCents: 4_800 });
  assert.equal(d.lane, 'C');
  assert.deepEqual(d.reasons, ['UNDERWRITER_OFFLINE']);
});

test('an expired Vouch Record cannot be spent', () => {
  const d = decide(3, { verdict: 'not_contested' }, { recordExpired: true }, { amountCents: 4_800 });
  assert.equal(d.lane, 'C');
});

test('a person outranks a hold: duplicate photo while the underwriter is offline is lane D', () => {
  const d = decide(3, { verdict: 'not_contested' }, { duplicatePhoto: true, underwriterOffline: true }, { amountCents: 4_800 });
  assert.equal(d.lane, 'D');
});

test('contradicting evidence goes to a person', () => {
  const d = decide(2, { verdict: 'supported', contradicts: true }, {}, { amountCents: 4_800 });
  assert.equal(d.lane, 'D');
});

test('the merchant can raise caps through the policy object', () => {
  const policy = { ...DEFAULT_POLICY, instantCapCents: { ...DEFAULT_POLICY.instantCapCents, 2: 50_000 } };
  assert.equal(decide(2, { verdict: 'supported' }, {}, { amountCents: 31_000 }, policy).lane, 'A');
});

test('no scenario ever returns a lane outside A to D, and nothing denies', () => {
  for (const tier of [0, 1, 2, 3] as Tier[]) {
    for (const verdict of ['supported', 'partly_supported', 'not_supported', 'unable_to_verify', 'not_contested'] as Verdict[]) {
      const d = decide(tier, { verdict }, {}, { amountCents: 10_000 });
      assert.match(d.lane, /^[ABCD]$/);
    }
  }
});
