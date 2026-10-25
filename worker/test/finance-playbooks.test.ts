import { describe, expect, it } from 'vitest';
import { buildDriverBoard, defectBatchAction } from '../src/finance/drivers';
import { clusterExceptions, runPlaybook } from '../src/finance/playbooks';
import { causeBridge } from '../src/finance/reconcile';
import { deliberatelyWrongExplanation, verifyClusters, verifyExplanation } from '../src/finance/verifier';

describe('Finance Desk playbooks and verifier', () => {
  it('proposes a balanced fee reclass and the Verifier accepts it', () => {
    const rows = [
      { orderId: 10, cause: 'processor fee booked into refund returns', cents: 290, winner: 'processor' as const, why: 'fee' },
      { orderId: 11, cause: 'processor fee booked into refund returns', cents: 110, winner: 'processor' as const, why: 'fee' },
    ];
    const play = runPlaybook(rows[0]!.cause, rows, '2026-09');
    expect(play.playbook).toBe('reclassify_fee');
    expect(play.status).toBe('playbook');
    expect(play.proposal).toHaveLength(1);
    expect(play.proposal[0]!.lines.reduce((s, l) => s + l.debit, 0)).toBe(400);
    expect(play.proposal[0]!.lines.reduce((s, l) => s + l.credit, 0)).toBe(400);

    const clustered = clusterExceptions(rows, '2026-09');
    const verified = verifyClusters(clustered);
    expect(verified.rejected).toBe(0);
    expect(verified.closedByPlaybook).toBe(2);
    expect(verified.clusters[0]!.status).toBe('playbook');
  });

  it('rejects a deliberately wrong explanation that does not tie out', () => {
    const wrong = deliberatelyWrongExplanation(1_000);
    const result = verifyExplanation(wrong);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('does not equal') || r.includes('refused') || r.includes('does not exist'))).toBe(true);
  });

  it('sends failed inspections to the controller, not an auto post', () => {
    const rows = [{ orderId: 42, cause: 'returned item failed inspection', cents: 4500, winner: 'warehouse' as const, why: 'damaged' }];
    const play = runPlaybook(rows[0]!.cause, rows, '2026-09');
    expect(play.status).toBe('controller');
    expect(play.proposal).toHaveLength(0);
    const verified = verifyClusters(clusterExceptions(rows, '2026-09'));
    expect(verified.toController).toBe(1);
    expect(verified.closedByPlaybook).toBe(0);
  });

  it('builds a cause bridge that foots to zero', () => {
    const bridge = causeBridge([
      { orderId: 1, cause: 'processor refund missing or different in ledger', cents: 150, winner: 'processor', why: 'missing' },
      { orderId: 2, cause: 'processor fee booked into refund returns', cents: -40, winner: 'processor', why: 'fee' },
    ]);
    expect(bridge.reduce((s, l) => s + l.cents, 0)).toBe(0);
    expect(bridge.some((l) => l.cause === 'bridge close (residual)')).toBe(true);
  });

  it('assigns every exception dollar to exactly one driver cause', () => {
    const board = buildDriverBoard('2026-09', [
      { orderId: 1, cause: 'returned item failed inspection', cents: 1000, winner: 'warehouse', why: 'x' },
      { orderId: 2, cause: 'processor fee booked into refund returns', cents: 200, winner: 'processor', why: 'y' },
      { orderId: 3, cause: 'partial bundle return paid in full', cents: 300, winner: 'warehouse', why: 'z' },
    ]);
    expect(board.total_cents).toBe(1500);
    expect(board.by_cause.contradicted_claim).toBe(1000);
    expect(board.by_cause.policy_leak).toBe(200);
    expect(board.by_cause.fulfilment_error).toBe(300);
    expect(board.actions[0]!.driver).toBe('contradicted_claim');
  });

  it('routes a verified defect batch to procurement, never fraud_ops', () => {
    const action = defectBatchAction(['order:9', 'A-video-1'], 12_000);
    expect(action.owner).toBe('procurement');
    expect(action.driver).toBe('verified_defect');
    expect(action.owner).not.toBe('fraud_ops');
  });
});
