import type { Candidate, Detector, History } from '../types';
import { indexHistory, median } from '../lib';

// Repeated "defective" claims by one agent on items claimed right at the edge
// of the return window: a sign of items used and returned just in time.
const WINDOW_DAYS = 90;
const MIN_CLAIMS = 3;
const MAX_MEDIAN_GAP = 2; // days before the window closes

export const detector: Detector = {
  id: 'false_defect',
  version: 1,
  run(h: History): Candidate[] {
    const { purchases, refundsByAgent } = indexHistory(h);
    const out: Candidate[] = [];
    for (const [agentId, refunds] of refundsByAgent) {
      const defect = refunds.filter((r) => r.reasonCode === 'defective' && r.day >= h.day - WINDOW_DAYS);
      const gaps: { r: (typeof defect)[number]; gap: number }[] = [];
      for (const r of defect) {
        const p = purchases.get(r.purchaseId);
        if (p && p.windowEndDay > 0) gaps.push({ r, gap: p.windowEndDay - r.day });
      }
      if (gaps.length < MIN_CLAIMS) continue;
      const med = median(gaps.map((g) => g.gap));
      if (med > MAX_MEDIAN_GAP) continue;
      out.push({
        kind: 'false_defect',
        agentIds: [agentId],
        businessIds: [...new Set(gaps.map((g) => g.r.businessId))].sort((a, b) => a - b),
        events: gaps.map((g) => ({ table: 'refund' as const, id: g.r.id, day: g.r.day, why: `"defective" claim ${g.gap} day(s) before the return window closed` })),
        features: { defect_claims: gaps.length, window_days: WINDOW_DAYS, median_days_before_window_end: med },
      });
    }
    return out;
  },
};
