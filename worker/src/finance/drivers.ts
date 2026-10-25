// Driver board: every refund exception dollar is assigned to exactly one cause
// with an owner. Code builds this; the Forecast Advisor only ranks and explains.
import type { ReconciliationException } from './reconcile';

export type DriverCause =
  | 'verified_defect'
  | 'contradicted_claim'
  | 'listing_mismatch'
  | 'fit_or_preference'
  | 'policy_leak'
  | 'fulfilment_error';

export type DriverOwner = 'finance' | 'procurement' | 'pricing' | 'fraud_ops' | 'support';

export interface DriverAction {
  action: string;
  owner: DriverOwner;
  driver: DriverCause;
  evidence_ids: string[];
  effect_cents: number;
  orders: number;
}

export interface DriverBoard {
  period: string;
  total_cents: number;
  by_cause: Record<DriverCause, number>;
  actions: DriverAction[];
}

const CAUSE_MAP: Record<string, { driver: DriverCause; owner: DriverOwner; action: string }> = {
  'processor refund differs from authorized amount': {
    driver: 'policy_leak', owner: 'support',
    action: 'Stop support-side manual refunds that duplicate a Vouch decision; claw back duplicates.',
  },
  'processor refund missing or different in ledger': {
    driver: 'policy_leak', owner: 'finance',
    action: 'Book processor settlements missing from the ledger before close.',
  },
  'processor and bank settlement differ': {
    driver: 'policy_leak', owner: 'finance',
    action: 'Clear bank/processor settlement timing gaps; escalate above materiality.',
  },
  'leg 2 paid without a warehouse return': {
    driver: 'fulfilment_error', owner: 'finance',
    action: 'Block second-leg release until a warehouse scan exists; claw back unverified payouts.',
  },
  'returned item failed inspection': {
    driver: 'contradicted_claim', owner: 'fraud_ops',
    action: 'Route failed inspections to human review with the video as the support document.',
  },
  'partial bundle return paid in full': {
    driver: 'fulfilment_error', owner: 'finance',
    action: 'Pay only the returned share of a bundle; claw back the overpaid remainder.',
  },
  'leg 2 booked in a period before its return scan': {
    driver: 'policy_leak', owner: 'finance',
    action: 'Post late returns to the next open period with a prior-period memo; true up the reserve.',
  },
  'processor fee booked into refund returns': {
    driver: 'policy_leak', owner: 'finance',
    action: 'Reclassify processor fees out of sales returns and into fee expense.',
  },
};

const EMPTY: Record<DriverCause, number> = {
  verified_defect: 0,
  contradicted_claim: 0,
  listing_mismatch: 0,
  fit_or_preference: 0,
  policy_leak: 0,
  fulfilment_error: 0,
};

/** Assign every exception dollar to one driver cause. Unknown causes stay policy_leak. */
export function buildDriverBoard(period: string, exceptions: ReconciliationException[]): DriverBoard {
  const by_cause = { ...EMPTY };
  const buckets = new Map<DriverCause, { cents: number; orders: Set<number>; evidence: string[]; meta: { owner: DriverOwner; action: string } }>();

  for (const row of exceptions) {
    const mapped = CAUSE_MAP[row.cause] ?? {
      driver: 'policy_leak' as const, owner: 'finance' as const,
      action: `Review unexplained cause: ${row.cause}`,
    };
    // Defect batches are not exception rows from reconcile; they arrive as sim events.
    // Failed inspection with video support is contradicted_claim, never auto-sent to fraud as denial.
    by_cause[mapped.driver] += Math.abs(row.cents);
    const bucket = buckets.get(mapped.driver) ?? {
      cents: 0, orders: new Set<number>(), evidence: [], meta: { owner: mapped.owner, action: mapped.action },
    };
    bucket.cents += Math.abs(row.cents);
    bucket.orders.add(row.orderId);
    bucket.evidence.push(`order:${row.orderId}`);
    bucket.meta = { owner: mapped.owner, action: mapped.action };
    buckets.set(mapped.driver, bucket);
  }

  const actions: DriverAction[] = [...buckets.entries()]
    .map(([driver, b]) => ({
      action: b.meta.action,
      owner: b.meta.owner,
      driver,
      evidence_ids: b.evidence.slice(0, 20),
      effect_cents: b.cents,
      orders: b.orders.size,
    }))
    .sort((a, b) => b.effect_cents - a.effect_cents);

  return {
    period,
    total_cents: actions.reduce((s, a) => s + a.effect_cents, 0),
    by_cause,
    actions,
  };
}

/** Defect-batch decoy: code routes verified defects to procurement, never fraud_ops. */
export function defectBatchAction(evidenceIds: string[], effectCents: number): DriverAction {
  return {
    action: 'Open a supplier claim for the verified-defect batch; attach the video timestamps as proof.',
    owner: 'procurement',
    driver: 'verified_defect',
    evidence_ids: evidenceIds,
    effect_cents: effectCents,
    orders: evidenceIds.length,
  };
}
