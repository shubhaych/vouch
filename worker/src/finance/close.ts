import type { DbConnection } from '../../module_bindings';
import { openBook } from './book';
import { buildDriverBoard, type DriverBoard } from './drivers';
import { clusterExceptions } from './playbooks';
import { causeBridge, reconcilePeriod, type BridgeLine, type SourceTotals } from './reconcile';
import { verifyClusters } from './verifier';

export interface CloseResult {
  period: string;
  summary: SourceTotals;
  bridge: BridgeLine[];
  exceptionClusters: number;
  closedByPlaybook: number;
  toInvestigator: number;
  toController: number;
  verifierRejected: number;
  drivers: DriverBoard;
  status: 'recorded';
}

/** Runs reconcile → playbooks → verifier → driver board, then records the close snapshot. */
export async function closeBookPeriod(conn: DbConnection, path: string, period: string): Promise<CloseResult> {
  const db = await openBook(path, true);
  try {
    const result = await reconcilePeriod(db, period);
    const rawClusters = clusterExceptions(result.exceptions, period);
    const verified = verifyClusters(rawClusters);
    const bridge = causeBridge(result.exceptions);
    const drivers = buildDriverBoard(period, result.exceptions);

    const explainedCauses = new Set(
      verified.clusters.filter((c) => c.status === 'playbook').map((c) => c.cls),
    );
    // Residual always counts as explained (it is the arithmetic close). Playbook causes are explained.
    const bridgeJson = bridge.map((line, i) => ({
      ...line,
      explained: line.cause === 'bridge close (residual)' || explainedCauses.has(line.cause),
      cluster: i,
    }));

    const exceptionClusters = verified.clusters.map((c) => ({
      cls: c.cls,
      status: c.status,
      cents: c.cents,
      orders: c.orders,
      winner: c.winner,
      reason: c.reason,
      playbook: c.playbook,
      proposalJson: c.proposalJson,
      explanation: c.explanation,
      sampleRefs: c.sampleRefs,
    }));
    const driverClusters = drivers.actions.map((a) => ({
      cls: `driver:${a.driver}`,
      status: 'proposed',
      cents: a.effect_cents,
      orders: a.orders,
      winner: a.owner,
      reason: a.action,
      playbook: 'driver_board',
      proposalJson: JSON.stringify(a),
      explanation: `Driver board: ${a.driver} → ${a.owner}`,
      sampleRefs: a.evidence_ids.slice(0, 10).join(','),
    }));
    const clusters = [...exceptionClusters, ...driverClusters];

    const memo = `Reconciled ${period} from the Vouch decision log, payment processor, bank, warehouse and derived ledger. ` +
      `${verified.closedByPlaybook} exception orders closed by playbook (verifier-accepted); ` +
      `${verified.toInvestigator} sent to the investigator; ${verified.toController} waiting on the controller. ` +
      `${verified.rejected} playbook proposals rejected by the Verifier. ` +
      `Driver board assigns ${drivers.total_cents} cents across ${drivers.actions.length} causes.`;

    await conn.reducers.financeRecordClose({
      companyId: 1,
      period,
      ledgerCents: BigInt(result.summary.ledgerCents),
      processorCents: BigInt(result.summary.processorCents),
      bankCents: BigInt(result.summary.bankCents),
      events: result.summary.events,
      matched: result.summary.matched,
      exceptions: result.summary.exceptions,
      closedByPlaybook: verified.closedByPlaybook,
      toInvestigator: verified.toInvestigator,
      toController: verified.toController,
      bridgeJson: JSON.stringify(bridgeJson),
      clustersJson: JSON.stringify(clusters),
      memo,
    });
    return {
      period,
      summary: result.summary,
      bridge,
      exceptionClusters: exceptionClusters.length,
      closedByPlaybook: verified.closedByPlaybook,
      toInvestigator: verified.toInvestigator,
      toController: verified.toController,
      verifierRejected: verified.rejected,
      drivers,
      status: 'recorded',
    };
  } finally {
    db.closeSync();
  }
}
