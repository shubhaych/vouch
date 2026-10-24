import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeCase } from './route';
import { underwriterOnline } from './breaker';

test('the Desk Lead routes each case to exactly one seat', () => {
  assert.equal(routeCase({ kind: 'new_customer', subjectId: 's' }).seat, 'credit_analyst');
  assert.equal(routeCase({ kind: 'incident', subjectId: 's' }).seat, 'credit_analyst');
  assert.equal(routeCase({ kind: 'agent_order', agentId: 'a', orderId: 'o' }).seat, 'agent_order');
  assert.equal(routeCase({ kind: 'contested_claim', claimId: 'c' }).seat, 'refund_desk');
  assert.equal(routeCase({ kind: 'post_payment_review', claimId: 'c' }).seat, 'refund_desk');
  assert.equal(routeCase({ kind: 'nightly' }).seat, 'reconciler');
});

test('circuit breaker fails closed', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const recent = new Date('2026-10-24T11:50:00Z');
  const windowMs = 30 * 60_000;
  assert.equal(underwriterOnline({ enabled: true, lastCompletedRunAt: recent, now, windowMs }), true);
  assert.equal(underwriterOnline({ enabled: false, lastCompletedRunAt: recent, now, windowMs }), false);
  assert.equal(underwriterOnline({ enabled: true, lastCompletedRunAt: null, now, windowMs }), false);
  assert.equal(underwriterOnline({ enabled: true, lastCompletedRunAt: new Date('2026-10-24T10:00:00Z'), now, windowMs }), false);
});
