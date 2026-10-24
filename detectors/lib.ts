// Small helpers detectors share. Pure, no I/O.
import type { History, Purchase, Refund } from './types';

export function indexHistory(h: History) {
  const purchases = new Map<bigint, Purchase>();
  for (const p of h.purchases) purchases.set(p.id, p);
  const refundsByAgent = new Map<number, Refund[]>();
  for (const r of h.refunds) {
    const xs = refundsByAgent.get(r.agentId);
    if (xs) xs.push(r); else refundsByAgent.set(r.agentId, [r]);
  }
  const purchasesByAgent = new Map<number, Purchase[]>();
  for (const p of h.purchases) {
    const xs = purchasesByAgent.get(p.buyer);
    if (xs) xs.push(p); else purchasesByAgent.set(p.buyer, [p]);
  }
  return { purchases, refundsByAgent, purchasesByAgent };
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export { trigramSimilarity, trigrams } from '../module/src/text';
