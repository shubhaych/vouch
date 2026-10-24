// O(1) lookups over the big tables. The SDK's client cache answers
// `conn.db.purchase.id.find()` by scanning (about 65 ms at 200,000 rows), so
// the worker keeps its own Maps, updated by the same row callbacks.
import type { DbConnection } from '../module_bindings/index';
import type { Agent, Purchase, Refund } from '../module_bindings/types';

export class Mirror {
  readonly purchases = new Map<bigint, Purchase>();
  readonly refunds = new Map<bigint, Refund>();
  readonly agents = new Map<number, Agent>();
  readonly purchasesByBuyer = new Map<number, Set<bigint>>();
  readonly refundsByAgent = new Map<number, Set<bigint>>();

  constructor(conn: DbConnection) {
    const db = conn.db;
    const index = <K>(m: Map<K, Set<bigint>>, k: K, id: bigint, add: boolean) => {
      let s = m.get(k);
      if (!s) m.set(k, (s = new Set()));
      if (add) s.add(id); else s.delete(id);
    };
    const putP = (p: Purchase) => { this.purchases.set(p.id, p); index(this.purchasesByBuyer, p.buyer, p.id, true); };
    const putR = (r: Refund) => { this.refunds.set(r.id, r); index(this.refundsByAgent, r.agentId, r.id, true); };
    for (const p of db.purchase.iter()) putP(p);
    for (const r of db.refund.iter()) putR(r);
    for (const a of db.agent.iter()) this.agents.set(a.id, a);
    db.purchase.onInsert((_c, p) => putP(p));
    db.purchase.onUpdate((_c, _o, p) => putP(p));
    db.purchase.onDelete((_c, p) => { this.purchases.delete(p.id); index(this.purchasesByBuyer, p.buyer, p.id, false); });
    db.refund.onInsert((_c, r) => putR(r));
    db.refund.onUpdate((_c, _o, r) => putR(r));
    db.refund.onDelete((_c, r) => { this.refunds.delete(r.id); index(this.refundsByAgent, r.agentId, r.id, false); });
    db.agent.onInsert((_c, a) => this.agents.set(a.id, a));
    db.agent.onUpdate((_c, _o, a) => this.agents.set(a.id, a));
    db.agent.onDelete((_c, a) => this.agents.delete(a.id));
  }

  purchasesOf(agentId: number): Purchase[] {
    return [...(this.purchasesByBuyer.get(agentId) ?? [])].map((id) => this.purchases.get(id)!).filter(Boolean);
  }

  refundsOf(agentId: number): Refund[] {
    return [...(this.refundsByAgent.get(agentId) ?? [])].map((id) => this.refunds.get(id)!).filter(Boolean);
  }
}

let shared: Mirror | null = null;
/** One mirror per worker connection. */
export const mirrorOf = (conn: DbConnection): Mirror => (shared ??= new Mirror(conn));
