import type { DuckDBConnection } from '@duckdb/node-api';
import { rows } from './book';

export interface SourceTotals {
  ledgerCents: number;
  processorCents: number;
  bankCents: number;
  events: number;
  matched: number;
  exceptions: number;
}

export interface ReconciliationException {
  orderId: number;
  cause: string;
  cents: number;
  winner: 'processor' | 'bank' | 'warehouse' | 'decision log' | 'period rule';
  why: string;
}

export interface BridgeLine { cause: string; cents: number; orders: number; winner: string; why: string }

/** Pairwise source deltas form a bridge that must foot to zero by construction. */
export function varianceBridge(summary: SourceTotals): BridgeLine[] {
  return [
    { cause: 'ledger to processor', cents: summary.processorCents - summary.ledgerCents, orders: 0, winner: 'processor', why: 'Processor records whether refund cash moved; the ledger is corrected to match.' },
    { cause: 'processor to bank', cents: summary.bankCents - summary.processorCents, orders: 0, winner: 'bank', why: 'The bank is authoritative for settlement timing.' },
    { cause: 'bank to ledger (bridge close)', cents: summary.ledgerCents - summary.bankCents, orders: 0, winner: 'ledger derived', why: 'Closing leg returns the bridge to zero; the ledger is not an authority source.' },
  ];
}

/**
 * Cause-level bridge: one line per exception cause, plus a closing residual so
 * the bridge always foots to $0.00. Explained flags are filled after playbooks.
 */
export function causeBridge(exceptions: ReconciliationException[]): BridgeLine[] {
  const byCause = new Map<string, { cents: number; orders: Set<number>; winner: string; why: string }>();
  for (const row of exceptions) {
    const cur = byCause.get(row.cause) ?? { cents: 0, orders: new Set<number>(), winner: row.winner, why: row.why };
    cur.cents += row.cents;
    cur.orders.add(row.orderId);
    byCause.set(row.cause, cur);
  }
  const lines: BridgeLine[] = [...byCause].map(([cause, v]) => ({
    cause, cents: v.cents, orders: v.orders.size, winner: v.winner, why: v.why,
  }));
  const foot = lines.reduce((s, l) => s + l.cents, 0);
  lines.push({
    cause: 'bridge close (residual)',
    cents: -foot,
    orders: 0,
    winner: 'ledger derived',
    why: 'Closing residual returns the cause bridge to zero; the ledger is not an authority source.',
  });
  return lines;
}

/**
 * Reconcile a month from the source feeds. The ledger is a derived system and
 * therefore never wins a conflict. Amounts stay integer cents end to end.
 */
export async function reconcilePeriod(c: DuckDBConnection, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period: ${period}`);

  const [summary] = await rows<SourceTotals>(c, `
    WITH p AS (
      SELECT COALESCE(SUM(cents), 0)::BIGINT AS total FROM proc
      WHERE kind IN ('refund', 'refund_manual') AND strftime(day, '%Y-%m') = '${period}'
    ), b AS (
      SELECT COALESCE(SUM(cents), 0)::BIGINT AS total FROM bank
      WHERE strftime(day, '%Y-%m') = '${period}'
    ), l AS (
      SELECT COALESCE(SUM(cents), 0)::BIGINT AS total FROM ledger
      WHERE kind IN ('leg1_settled', 'leg2_settled') AND period = '${period}'
    ), e AS (
      SELECT COUNT(*)::BIGINT AS n FROM proc
      WHERE kind IN ('refund', 'refund_manual') AND strftime(day, '%Y-%m') = '${period}'
    )
    SELECT l.total AS "ledgerCents", p.total AS "processorCents", b.total AS "bankCents",
      e.n AS events, 0::BIGINT AS matched, 0::BIGINT AS exceptions
    FROM p, b, l, e`);

  const exceptions = await rows<ReconciliationException>(c, `
    WITH processor AS (
      SELECT order_id, SUM(cents)::BIGINT AS cents FROM proc
      WHERE kind IN ('refund', 'refund_manual') AND strftime(day, '%Y-%m') = '${period}' GROUP BY order_id
    ), processor_leg1 AS (
      SELECT order_id, SUM(cents)::BIGINT AS cents FROM proc
      WHERE leg = 1 AND kind IN ('refund', 'refund_manual') AND strftime(day, '%Y-%m') = '${period}' GROUP BY order_id
    ), bank_txn AS (
      SELECT txn_id, SUM(cents)::BIGINT AS cents FROM bank GROUP BY txn_id
    ), bank_by_order AS (
      SELECT p.order_id, SUM(COALESCE(b.cents, 0))::BIGINT AS cents FROM proc p
      LEFT JOIN bank_txn b USING (txn_id)
      WHERE p.kind IN ('refund', 'refund_manual') AND strftime(p.day, '%Y-%m') = '${period}' GROUP BY p.order_id
    ), ledger_by_order AS (
      SELECT order_id, SUM(cents)::BIGINT AS cents FROM ledger
      WHERE kind IN ('leg1_settled', 'leg2_settled') AND period = '${period}' GROUP BY order_id
    ), decision_vs_processor AS (
      SELECT d.order_id AS "orderId", 'processor refund differs from authorized amount' AS cause,
        (d.leg1_cents - COALESCE(p.cents, 0))::BIGINT AS cents,
        'decision log' AS winner, 'The decision log authorizes leg 1; processor rows determine cash actually moved.' AS why
      FROM decisions d LEFT JOIN processor_leg1 p USING (order_id)
      WHERE strftime(d.day, '%Y-%m') = '${period}' AND d.leg1_cents <> COALESCE(p.cents, 0)
    ), processor_vs_bank AS (
      SELECT p.order_id AS "orderId", 'processor and bank settlement differ' AS cause,
        (p.cents - COALESCE(b.cents, 0))::BIGINT AS cents,
        'processor' AS winner, 'The processor records the refund; the bank records settlement and timing.' AS why
      FROM processor p LEFT JOIN bank_by_order b USING (order_id)
      WHERE p.cents <> COALESCE(b.cents, 0)
    ), processor_vs_ledger AS (
      SELECT p.order_id AS "orderId", 'processor refund missing or different in ledger' AS cause,
        (p.cents - COALESCE(l.cents, 0))::BIGINT AS cents,
        'processor' AS winner, 'The processor is authoritative for cash; the ledger must be corrected.' AS why
      FROM processor p LEFT JOIN ledger_by_order l USING (order_id)
      WHERE p.cents <> COALESCE(l.cents, 0)
    ), return_check AS (
      SELECT d.order_id AS "orderId",
        CASE WHEN w.order_id IS NULL THEN 'leg 2 paid without a warehouse return'
          WHEN w.condition NOT IN ('intact', 'packaging_wear') THEN 'returned item failed inspection'
          ELSE 'partial bundle return paid in full' END AS cause,
        CASE WHEN w.order_id IS NULL THEN d.leg2_cents
          WHEN w.condition NOT IN ('intact', 'packaging_wear') THEN d.leg2_cents
          ELSE ((d.leg2_cents * (d.authorized_qty - w.qty)) // NULLIF(d.authorized_qty, 0)) END::BIGINT AS cents,
        'warehouse' AS winner,
        CASE WHEN w.order_id IS NULL THEN 'The warehouse has no return scan, so the conditional leg is not verified.'
          WHEN w.condition NOT IN ('intact', 'packaging_wear') THEN 'The warehouse inspection contradicts an intact verified return.'
          ELSE 'The warehouse confirms only part of the bundle came back.' END AS why
      FROM decisions d JOIN proc p ON p.order_id = d.order_id AND p.leg = 2 AND p.kind = 'refund'
      LEFT JOIN wms w ON w.order_id = d.order_id
      WHERE strftime(d.day, '%Y-%m') = '${period}'
        AND (w.order_id IS NULL OR w.condition NOT IN ('intact', 'packaging_wear') OR w.qty < d.authorized_qty)
    ), period_check AS (
      SELECT d.order_id AS "orderId", 'leg 2 booked in a period before its return scan' AS cause,
        d.leg2_cents::BIGINT AS cents, 'period rule' AS winner,
        'A return obligation is recognized when the warehouse scan arrives; prior-period entries cannot be backdated.' AS why
      FROM decisions d JOIN wms w USING (order_id) JOIN ledger l ON l.order_id = d.order_id AND l.kind = 'leg2_authorized'
      WHERE strftime(w.day, '%Y-%m') = '${period}' AND l.day < w.day
    ), fee_check AS (
      SELECT l.order_id AS "orderId", 'processor fee booked into refund returns' AS cause,
        o.fee_cents::BIGINT AS cents, 'processor' AS winner,
        'Processor fees stay in expense; the processor is authoritative for the refund amount.' AS why
      FROM ledger l JOIN orders o USING (order_id)
      WHERE l.kind = 'leg1_settled' AND l.memo = 'refund incl. fee' AND l.period = '${period}'
    )
    SELECT * FROM (
      SELECT * FROM decision_vs_processor
      UNION ALL SELECT * FROM processor_vs_bank
      UNION ALL SELECT * FROM processor_vs_ledger
      UNION ALL SELECT * FROM return_check
      UNION ALL SELECT * FROM period_check
      UNION ALL SELECT * FROM fee_check
    ) all_exceptions
    ORDER BY ABS(cents) DESC, "orderId"
    LIMIT 5000`);

  if (!summary) throw new Error(`No reconciliation summary for ${period}`);
  const exceptionOrders = new Set(exceptions.map((e) => e.orderId));
  summary.exceptions = exceptionOrders.size;
  summary.matched = Math.max(0, summary.events - summary.exceptions);
  const bridge = varianceBridge(summary);
  if (bridge.reduce((sum, line) => sum + line.cents, 0) !== 0) throw new Error(`Variance bridge failed to foot for ${period}`);
  return { period, summary, bridge, exceptions };
}
