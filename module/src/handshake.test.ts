import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handshake, type Tier } from './handshake';

const item = (priceCents: number, highTicket = false) => ({ priceCents, highTicket });

// payout days by [buyer][seller]; null = escrow to delivery
const PAYOUT: Record<number, Record<number, number | null>> = {
  0: { 0: null, 1: null, 2: 3 },
  1: { 0: null, 1: 5, 2: 2 },
  2: { 0: null, 1: 5, 2: 0 },
};

test('payout matrix covers every cell', () => {
  for (const buyer of [0, 1, 2, 3] as Tier[]) {
    for (const seller of [0, 1, 2, 3] as Tier[]) {
      const row = PAYOUT[buyer >= 2 ? 2 : buyer]!;
      const want = row[seller >= 2 ? 2 : seller]!;
      const t = handshake(buyer, seller, item(4_800));
      assert.equal(t.escrow, want === null, `escrow buyer ${buyer} seller ${seller}`);
      assert.equal(t.payoutDays, want ?? 0, `payout buyer ${buyer} seller ${seller}`);
    }
  }
});

test('refund lane follows buyer tier; the merchant is seller tier 2', () => {
  assert.equal(handshake(0, 2, item(4_800)).refundLane, 'C');
  assert.equal(handshake(1, 2, item(4_800)).refundLane, 'B');
  assert.equal(handshake(2, 2, item(4_800)).refundLane, 'A');
  assert.equal(handshake(3, 2, item(4_800)).refundLane, 'A');
});

test('over the tier cap falls to lane B', () => {
  assert.equal(handshake(2, 2, item(20_000)).refundLane, 'A');
  assert.equal(handshake(2, 2, item(20_001)).refundLane, 'B');
  assert.equal(handshake(3, 2, item(100_000)).refundLane, 'A');
  assert.equal(handshake(3, 2, item(100_001)).refundLane, 'B');
});

test('unable to verify holds and never denies', () => {
  const t = handshake(3, 2, item(4_800), { unableToVerify: true });
  assert.equal(t.refundLane, 'C');
  assert.equal(t.confirm, 'step_up');
});

test('duplicate photo or incident stops at lane D with a person', () => {
  for (const flags of [{ duplicatePhoto: true }, { incident: true }]) {
    const t = handshake(3, 2, item(4_800), flags);
    assert.equal(t.refundLane, 'D');
    assert.equal(t.confirm, 'person');
    assert.equal(t.escrow, true);
  }
});

test('high-ticket tightens: escrow plus the inspection window', () => {
  const t = handshake(3, 2, item(90_000, true));
  assert.equal(t.escrow, true);
  assert.equal(t.payoutDays, 3);
});
