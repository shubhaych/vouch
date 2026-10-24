// Turns a SimDb (the in-memory world, or rows the worker mirrors) into the
// History detectors read. Truth is separate and only the evaluator reads it.
import type { SimDb } from '../module/src/simdb';
import type { History } from './types';

export function historyFrom(db: SimDb, day: number): History {
  const purchases = [...db.purchase.iter()].map((p) => ({
    id: p.id, buyer: p.buyer, business: p.business, item: p.item, category: p.category, amount: p.amount, day: p.day,
    deliverDay: p.deliverDay, windowEndDay: p.windowEndDay, status: p.status,
  }));
  const refunds = [...db.refund.iter()].map((r) => ({
    id: r.id, purchaseId: r.purchaseId, agentId: r.agentId, businessId: r.businessId, amount: r.amount, day: r.day,
    reasonCode: r.reasonCode, reasonText: r.reasonText, status: r.status,
  }));
  const agents = [...db.agent.iter()].map((a) => ({ id: a.id, region: a.region, score: a.score, purchases: a.purchases, refunds: a.refunds }));
  return { day, purchases, refunds, agents };
}
