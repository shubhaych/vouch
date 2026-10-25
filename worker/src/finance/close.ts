import type { DbConnection } from '../../module_bindings';
import { openBook } from './book';
import { reconcilePeriod } from './reconcile';

/** Runs the deterministic close analysis and records its snapshot as the reconciler identity. */
export async function closeBookPeriod(conn: DbConnection, path: string, period: string) {
  const db = await openBook(path, true);
  try {
    const result = await reconcilePeriod(db, period);
    const causes = new Map<string, typeof result.exceptions>();
    for (const row of result.exceptions) causes.set(row.cause, [...(causes.get(row.cause) ?? []), row]);

    const bridgeClusters = result.bridge.map((line) => ({
      cls: `source_delta:${line.cause}`, status: 'open', cents: line.cents, orders: line.orders,
      winner: line.winner, reason: line.why, playbook: 'none',
      explanation: '', sampleRefs: '',
    }));
    const exceptionClusters = [...causes].map(([cause, rows]) => {
      const orderIds = [...new Set(rows.map((r) => r.orderId))];
      return {
        cls: cause, status: 'open', cents: rows.reduce((sum, row) => sum + row.cents, 0), orders: orderIds.length,
        winner: rows[0]?.winner ?? 'unknown', reason: rows[0]?.why ?? 'No supported explanation.', playbook: 'none',
        explanation: '', sampleRefs: orderIds.slice(0, 10).map((id) => `order:${id}`).join(','),
      };
    });
    const clusters = [...bridgeClusters, ...exceptionClusters];
    const bridgeJson = result.bridge.map((line, i) => ({ ...line, explained: false, cluster: i }));
    const uniqueOrders = new Set(result.exceptions.map((row) => row.orderId));
    const memo = `Reconciled ${period} from the Vouch decision log, payment processor, bank, warehouse and derived ledger. ` +
      `${result.summary.exceptions} exception orders remain open; no playbook or agent has cleared them. ` +
      `The controller must review every unexplained bridge line above materiality before locking.`;

    await conn.reducers.financeRecordClose({
      companyId: 1,
      period,
      ledgerCents: BigInt(result.summary.ledgerCents),
      processorCents: BigInt(result.summary.processorCents),
      bankCents: BigInt(result.summary.bankCents),
      events: result.summary.events,
      matched: result.summary.matched,
      exceptions: result.summary.exceptions,
      closedByPlaybook: 0,
      toInvestigator: 0,
      toController: uniqueOrders.size,
      bridgeJson: JSON.stringify(bridgeJson),
      clustersJson: JSON.stringify(clusters),
      memo,
    });
    return { period, summary: result.summary, bridge: result.bridge, exceptionClusters: exceptionClusters.length, status: 'recorded' as const };
  } finally {
    db.closeSync();
  }
}
