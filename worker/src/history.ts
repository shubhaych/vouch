// Read helpers over the worker's subscription cache: the history summaries
// the CREAO agents receive, and one-off snapshots for rows the worker does
// not mirror (an agent's credit events).
import type { DbConnection } from '../module_bindings/index';
import type { CreditEvent } from '../module_bindings/types';
import { mirrorOf } from './mirror';

/** Subscribe, wait for the rows, read them, unsubscribe. */
export function snapshot<T>(conn: DbConnection, sql: string, read: () => T, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`snapshot timed out: ${sql}`)), timeoutMs);
    const handle = conn.subscriptionBuilder().onApplied(() => {
      clearTimeout(timer);
      const out = read();
      try { handle.unsubscribe(); } catch { /* already gone */ }
      resolve(out);
    }).onError(() => { clearTimeout(timer); reject(new Error(`snapshot failed: ${sql}`)); }).subscribe(sql);
  });
}

export const label = {
  agent: (id: number) => `A-${String(id).padStart(5, '0')}`,
  business: (id: number) => `B-${String(id).padStart(3, '0')}`,
  pattern: (id: number) => `FR-${String(id).padStart(3, '0')}`,
  claim: (id: bigint) => `C-${id}`,
  refund: (id: bigint) => `R-${id}`,
  credit: (id: bigint) => `CE-${id}`,
};

export interface HistorySummary {
  agent_id: string; score: number; band: string; account_age_days: number; purchases_completed: number; businesses: number;
  refunds_requested_90d: number; refunds_accepted_total: number; refunds_declined_total: number; refund_ratio_90d: number;
  recent_credit_events: { id: string; day: number; kind: string; delta: number }[];
}

/** What the Refund Investigator and Pattern Analyst see about an agent: counts and ratios, never region or identity. */
export async function historySummary(conn: DbConnection, agentId: number): Promise<HistorySummary> {
  const day = conn.db.simRun.id.find(1)?.day ?? 0;
  const m = mirrorOf(conn);
  const a = m.agents.get(agentId);
  const purchases = m.purchasesOf(agentId);
  const refunds = m.refundsOf(agentId);
  const since = day - 90;
  const bought90 = purchases.filter((p) => p.day >= since).length;
  const asked90 = refunds.filter((r) => r.day >= since).length;
  const first = purchases.reduce((m, p) => Math.min(m, p.day), day);
  const credits = await snapshot(conn, `SELECT * FROM credit_event WHERE agent_id = ${agentId}`, () =>
    [...conn.db.creditEvent.iter()].filter((c: CreditEvent) => c.agentId === agentId).sort((x, y) => Number(y.id - x.id)).slice(0, 20),
  ).catch(() => [] as CreditEvent[]);
  return {
    agent_id: label.agent(agentId),
    score: a?.score ?? 600,
    band: a?.band ?? 'neutral',
    account_age_days: Math.max(0, day - first),
    purchases_completed: purchases.filter((p) => p.status === 'kept' || p.status === 'refunded' || p.status === 'delivered').length,
    businesses: new Set(purchases.map((p) => p.business)).size,
    refunds_requested_90d: asked90,
    refunds_accepted_total: refunds.filter((r) => r.status === 'accepted').length,
    refunds_declined_total: refunds.filter((r) => r.status === 'declined').length,
    refund_ratio_90d: bought90 ? Math.round((asked90 / bought90) * 100) / 100 : 0,
    recent_credit_events: credits.map((c) => ({ id: label.credit(c.id), day: c.day, kind: c.kind, delta: c.delta })),
  };
}
