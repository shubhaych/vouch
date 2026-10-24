import type { Candidate, Detector, History } from '../types';
import { indexHistory, median, round } from '../lib';

// Refund requests relative to the agent's own completed purchases, compared
// with what is typical where it lives (a baseline, never evidence by itself).
const MIN_PURCHASES = 8;
const MIN_RATIO = 0.4;
const VS_REGION = 3;

export const detector: Detector = {
  id: 'refund_frequency',
  version: 1,
  run(h: History): Candidate[] {
    const { refundsByAgent, purchasesByAgent } = indexHistory(h);
    const ratio = new Map<number, number>();
    for (const a of h.agents) {
      const bought = purchasesByAgent.get(a.id)?.length ?? 0;
      if (bought === 0) continue;
      ratio.set(a.id, (refundsByAgent.get(a.id)?.length ?? 0) / bought);
    }
    const byRegion = new Map<number, number[]>();
    for (const a of h.agents) {
      const r = ratio.get(a.id);
      if (r === undefined) continue;
      const xs = byRegion.get(a.region);
      if (xs) xs.push(r); else byRegion.set(a.region, [r]);
    }
    const regionMedian = new Map([...byRegion].map(([k, xs]) => [k, median(xs)]));
    const out: Candidate[] = [];
    for (const a of h.agents) {
      const bought = purchasesByAgent.get(a.id) ?? [];
      const r = ratio.get(a.id) ?? 0;
      if (bought.length < MIN_PURCHASES || r <= MIN_RATIO) continue;
      const base = Math.max(0.01, regionMedian.get(a.region) ?? 0.01);
      if (r <= VS_REGION * base) continue;
      const refunds = refundsByAgent.get(a.id) ?? [];
      out.push({
        kind: 'refund_frequency',
        agentIds: [a.id],
        businessIds: [...new Set(refunds.map((x) => x.businessId))].sort((x, y) => x - y),
        events: refunds.map((x) => ({ table: 'refund' as const, id: x.id, day: x.day, why: `refund ${refunds.indexOf(x) + 1} of ${refunds.length} on ${bought.length} purchases` })),
        features: { refund_ratio: round(r), purchases: bought.length, refunds: refunds.length, ratio_vs_region_median: round(r / base, 1) },
      });
    }
    return out;
  },
};
