import { afterEach, describe, expect, it } from 'vitest';
import type { DuckDBConnection } from '@duckdb/node-api';
import { openBook } from '../src/finance/book';
import { causeBridge, reconcilePeriod, varianceBridge } from '../src/finance/reconcile';

let connection: DuckDBConnection | undefined;

async function fixture() {
  connection = await openBook(':memory:');
  const sql = [
    `CREATE TABLE proc (txn_id VARCHAR, order_id BIGINT, kind VARCHAR, leg INT, cents INT, day DATE, memo VARCHAR)`,
    `CREATE TABLE bank (bank_id VARCHAR, txn_id VARCHAR, cents INT, day DATE)`,
    `CREATE TABLE ledger (entry_id BIGINT, order_id BIGINT, decision_id VARCHAR, kind VARCHAR, leg INT, cents INT, day DATE, period VARCHAR, memo VARCHAR)`,
    `CREATE TABLE decisions (order_id BIGINT, day DATE, leg1_cents INT, leg2_cents INT, authorized_qty INT)`,
    `CREATE TABLE wms (scan_id BIGINT, order_id BIGINT, day DATE, condition VARCHAR, qty INT)`,
    `CREATE TABLE orders (order_id BIGINT, fee_cents INT)`,
    `INSERT INTO decisions VALUES (1, DATE '2026-09-01', 100, 0, 1), (2, DATE '2026-09-02', 200, 0, 1)`,
    `INSERT INTO proc VALUES ('r1', 1, 'refund', 1, 100, DATE '2026-09-02', ''), ('r2', 2, 'refund', 1, 150, DATE '2026-09-03', '')`,
    `INSERT INTO bank VALUES ('b1', 'r1', 100, DATE '2026-09-03'), ('b2', 'r2', 150, DATE '2026-09-04')`,
    `INSERT INTO ledger VALUES (1, 1, 'D-1', 'leg1_settled', 1, 100, DATE '2026-09-02', '2026-09', ''), (2, 2, 'D-2', 'leg1_settled', 1, 0, DATE '2026-09-03', '2026-09', '')`,
  ];
  for (const statement of sql) await connection.run(statement);
  return connection;
}

afterEach(() => { connection?.closeSync(); connection = undefined; });

describe('Finance Desk source reconciliation', () => {
  it('compares decision, processor, bank and ledger in integer cents with source authority', async () => {
    const c = await fixture();
    const result = await reconcilePeriod(c, '2026-09');
    expect(result.summary.processorCents).toBe(250);
    expect(result.summary.bankCents).toBe(250);
    expect(result.summary.ledgerCents).toBe(100);
    expect(result.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: 2, winner: 'decision log', cents: 50 }),
      expect.objectContaining({ orderId: 2, winner: 'processor', cents: 150 }),
    ]));
    expect(result.summary.exceptions).toBe(1);
    expect(result.bridge.reduce((s, line) => s + line.cents, 0)).toBe(0);
  });

  it('rejects malformed periods before constructing SQL', async () => {
    const c = await fixture();
    await expect(reconcilePeriod(c, "2026-09' OR TRUE --")).rejects.toThrow('Invalid period');
  });

  it('balances any three source totals back to zero using integer cents', () => {
    const bridge = varianceBridge({ ledgerCents: 74088565, processorCents: 74113130, bankCents: 73488827, events: 0, matched: 0, exceptions: 0 });
    expect(bridge.map((line) => line.cents)).toEqual([24565, -624303, 599738]);
    expect(bridge.reduce((s, line) => s + line.cents, 0)).toBe(0);
  });

  it('builds a cause-level bridge that foots to zero', () => {
    const bridge = causeBridge([
      { orderId: 2, cause: 'processor refund missing or different in ledger', cents: 150, winner: 'processor', why: 'missing' },
      { orderId: 2, cause: 'processor refund differs from authorized amount', cents: 50, winner: 'decision log', why: 'auth' },
    ]);
    expect(bridge.reduce((s, line) => s + line.cents, 0)).toBe(0);
    expect(bridge.filter((l) => l.cause !== 'bridge close (residual)')).toHaveLength(2);
  });
});
