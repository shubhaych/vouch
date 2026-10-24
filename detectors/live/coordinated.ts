import type { Candidate, Detector, History, Refund } from '../types';
import { round, trigrams } from '../lib';

// Several agents, near-identical claim text, inside 48 hours, across several
// businesses. Region and business are NOT features: businesses only count
// toward "at least 2", the way a coordinated group spreads its claims.
const MIN_AGENTS = 4;
const MAX_GAP_DAYS = 1; // consecutive simulated days: within 48 hours
const MIN_SIMILARITY = 0.8;
const LOOKBACK_DAYS = 30;

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export const detector: Detector = {
  id: 'coordinated',
  version: 1,
  run(h: History): Candidate[] {
    const recent = h.refunds.filter((r) => r.day >= h.day - LOOKBACK_DAYS).sort((a, b) => a.day - b.day || Number(a.id - b.id));
    const grams = recent.map((r) => trigrams(r.reasonText));
    const parent = recent.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const sims = new Map<string, number>();
    for (let i = 0; i < recent.length; i++) {
      for (let j = i + 1; j < recent.length && recent[j]!.day - recent[i]!.day <= MAX_GAP_DAYS; j++) {
        if (recent[i]!.agentId === recent[j]!.agentId) continue;
        const s = jaccard(grams[i]!, grams[j]!);
        if (s > MIN_SIMILARITY) {
          parent[find(i)] = find(j);
          sims.set(`${i}:${j}`, s);
        }
      }
    }
    const groups = new Map<number, number[]>();
    recent.forEach((_, i) => {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(i); else groups.set(root, [i]);
    });
    const out: Candidate[] = [];
    for (const idxs of groups.values()) {
      const rs: Refund[] = idxs.map((i) => recent[i]!);
      const agents = [...new Set(rs.map((r) => r.agentId))];
      const businesses = [...new Set(rs.map((r) => r.businessId))];
      if (agents.length < MIN_AGENTS || businesses.length < 2) continue;
      const days = rs.map((r) => r.day);
      let simSum = 0;
      let simN = 0;
      for (const [k, s] of sims) {
        const [a, b] = k.split(':').map(Number);
        if (idxs.includes(a!) && idxs.includes(b!)) { simSum += s; simN++; }
      }
      out.push({
        kind: 'coordinated',
        agentIds: agents.sort((a, b) => a - b),
        businessIds: businesses.sort((a, b) => a - b),
        events: rs.map((r) => ({ table: 'refund' as const, id: r.id, day: r.day, why: `claim text matches ${idxs.length - 1} other claims within 48 hours` })),
        features: {
          agents: agents.length,
          businesses: businesses.length,
          claims: rs.length,
          claim_window_hours: (Math.max(...days) - Math.min(...days) + 1) * 24,
          text_similarity: round(simN ? simSum / simN : 1, 2),
        },
      });
    }
    return out;
  },
};
