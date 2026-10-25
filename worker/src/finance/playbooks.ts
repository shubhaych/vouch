// Deterministic fixes for reconciliation exception clusters. Playbooks PROPOSE
// journal entries; they never post. The accountant books; the controller
// approves above the limit. Models are not involved here.
import { A } from '@vouch/module/finance/accounts';
import { checkEntry, post, type DraftEntry, type EventKind } from '@vouch/module/finance/ledger';
import { POLICY } from '@vouch/module/finance/policy';
import type { ReconciliationException } from './reconcile';

export interface ProposedLine { account: string; debit: number; credit: number }
export interface ProposedEntry {
  kind: EventKind | 'memo';
  period: string;
  memo: string;
  cents: number;
  lines: ProposedLine[];
  orderIds: number[];
}

export interface PlaybookResult {
  playbook: string;
  status: 'playbook' | 'controller' | 'unexplained';
  reason: string;
  proposal: ProposedEntry[];
  parts: { label: string; cents: number; orderId?: number }[];
  explanation: string;
}

export interface ExceptionCluster {
  cls: string;
  status: string;
  cents: number;
  orders: number;
  winner: string;
  reason: string;
  playbook: string;
  proposalJson: string;
  explanation: string;
  sampleRefs: string;
  orderIds: number[];
  rows: ReconciliationException[];
}

const draftLines = (e: DraftEntry): ProposedLine[] => e.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));

function propose(kind: EventKind, cents: number, period: string, memo: string, orderIds: number[]): ProposedEntry {
  const entry = post(kind, Math.abs(cents), period, memo);
  return { kind, period, memo: entry.memo, cents: Math.abs(cents), lines: draftLines(entry), orderIds };
}

/** Map a known cause to a deterministic proposal. Unknown causes stay unexplained for the investigator. */
export function runPlaybook(cause: string, rows: ReconciliationException[], period: string): PlaybookResult {
  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const cents = rows.reduce((s, r) => s + r.cents, 0);
  const abs = Math.abs(cents);
  const sample = orderIds.slice(0, 5).map((id) => `order:${id}`).join(', ');

  switch (cause) {
    case 'processor refund differs from authorized amount': {
      // Support also refunded in the processor: claw back the unauthorized cash.
      const proposal = [propose('clawback', abs, period, `Claw-back duplicate processor refund (${sample})`, orderIds)];
      return {
        playbook: 'clawback_duplicate',
        status: 'playbook',
        reason: 'The decision log authorizes the refund; an extra processor refund is a duplicate to claw back.',
        proposal,
        parts: rows.map((r) => ({ label: `duplicate on order ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Request claw-backs totaling ${abs} cents across ${orderIds.length} orders. Winner: decision log for authorization, processor for cash movement.`,
      };
    }
    case 'processor refund missing or different in ledger': {
      const proposal = [propose('leg1_settled', abs, period, `Book missing processor settlement (${sample})`, orderIds)];
      return {
        playbook: 'book_missing_settlement',
        status: 'playbook',
        reason: 'The processor is authoritative for cash; the ledger must be corrected to match.',
        proposal,
        parts: rows.map((r) => ({ label: `missing ledger settlement ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Propose booking ${abs} cents of processor refunds missing from the ledger.`,
      };
    }
    case 'processor and bank settlement differ': {
      // Under materiality: propose a rounding write-off for controller review. Above: unexplained.
      if (abs <= POLICY.materialityCents) {
        const entry = post('payout', abs, period, `Rounding / settlement timing adjustment (${sample})`);
        // Flip to a fee-style expense if bank is short; keep balanced proposal either way.
        const proposal: ProposedEntry[] = [{
          kind: 'memo', period, memo: entry.memo, cents: abs,
          lines: [
            { account: A.fees, debit: abs, credit: 0 },
            { account: A.cash, debit: 0, credit: abs },
          ],
          orderIds,
        }];
        return {
          playbook: 'requeue_or_round',
          status: 'controller',
          reason: 'Bank and processor disagree by a small amount; the controller must approve any write-off.',
          proposal,
          parts: rows.map((r) => ({ label: `settlement gap ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
          explanation: `Settlement gap of ${abs} cents is at or under materiality; propose a write-off for controller sign-off.`,
        };
      }
      return {
        playbook: 'requeue_settlement',
        status: 'unexplained',
        reason: 'Settlement gap above materiality; re-queue the bank match and send to the investigator.',
        proposal: [],
        parts: rows.map((r) => ({ label: `settlement gap ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Bank/processor gap of ${abs} cents exceeds materiality (${POLICY.materialityCents}); no auto write-off.`,
      };
    }
    case 'leg 2 paid without a warehouse return': {
      const proposal = [propose('clawback', abs, period, `Claw-back leg 2 with no warehouse scan (${sample})`, orderIds)];
      return {
        playbook: 'clawback_unverified_leg2',
        status: 'playbook',
        reason: 'Warehouse authority: no return scan means the conditional leg should not have been released.',
        proposal,
        parts: rows.map((r) => ({ label: `unverified leg 2 ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Propose clawing back ${abs} cents of second-leg refunds with no warehouse scan.`,
      };
    }
    case 'returned item failed inspection': {
      return {
        playbook: 'hold_failed_inspection',
        status: 'controller',
        reason: 'Warehouse inspection contradicts an intact return; a person must review the video evidence.',
        proposal: [],
        parts: rows.map((r) => ({ label: `failed inspection ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Hold ${orderIds.length} failed-inspection returns for the controller; video is the support document.`,
      };
    }
    case 'partial bundle return paid in full': {
      const proposal = [propose('clawback', abs, period, `Claw-back overpaid partial bundle return (${sample})`, orderIds)];
      return {
        playbook: 'partial_bundle_clawback',
        status: 'playbook',
        reason: 'Warehouse confirms only part of the bundle came back; claw back the overpaid share.',
        proposal,
        parts: rows.map((r) => ({ label: `partial bundle ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Propose clawing back ${abs} cents for partial bundle overpayments.`,
      };
    }
    case 'leg 2 booked in a period before its return scan': {
      const proposal = [propose('leg2_authorized', abs, period, `Prior-period memo: rebook leg 2 into open period (${sample})`, orderIds)];
      return {
        playbook: 'prior_period_memo',
        status: 'playbook',
        reason: 'Period rule: a return obligation is recognized when the warehouse scan arrives; post to the open period with a prior-period memo.',
        proposal,
        parts: rows.map((r) => ({ label: `prior-period leg 2 ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Propose rebooking ${abs} cents into ${period} with a prior-period memo; the locked period refuses the write.`,
      };
    }
    case 'processor fee booked into refund returns': {
      const proposal = [propose('fee_reclass', abs, period, `Reclassify processor fee out of returns (${sample})`, orderIds)];
      return {
        playbook: 'reclassify_fee',
        status: 'playbook',
        reason: 'Processor fees stay in expense; the processor is authoritative for the refund amount.',
        proposal,
        parts: rows.map((r) => ({ label: `fee reclass ${r.orderId}`, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Propose reclassifying ${abs} cents of processor fees out of sales returns.`,
      };
    }
    default:
      return {
        playbook: 'none',
        status: 'unexplained',
        reason: 'No deterministic playbook for this cause.',
        proposal: [],
        parts: rows.map((r) => ({ label: cause, cents: Math.abs(r.cents), orderId: r.orderId })),
        explanation: `Unexplained cluster (${cause}); send to the investigator.`,
      };
  }
}

export function clusterExceptions(exceptions: ReconciliationException[], period: string): ExceptionCluster[] {
  const byCause = new Map<string, ReconciliationException[]>();
  for (const row of exceptions) byCause.set(row.cause, [...(byCause.get(row.cause) ?? []), row]);

  return [...byCause].map(([cause, rows]) => {
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const play = runPlaybook(cause, rows, period);
    // Reject unbalanced proposals before they leave the playbook.
    const balanced = play.proposal.every((e) => !checkEntry(e));
    const status = !balanced && play.proposal.length ? 'unexplained' : play.status;
    return {
      cls: cause,
      status,
      cents: rows.reduce((s, r) => s + r.cents, 0),
      orders: orderIds.length,
      winner: rows[0]?.winner ?? 'unknown',
      reason: play.reason || rows[0]?.why || 'No supported explanation.',
      playbook: play.playbook,
      proposalJson: JSON.stringify(play.proposal),
      explanation: play.explanation,
      sampleRefs: orderIds.slice(0, 10).map((id) => `order:${id}`).join(','),
      orderIds,
      rows,
    };
  });
}
