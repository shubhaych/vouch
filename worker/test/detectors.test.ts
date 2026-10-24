import { describe, expect, it } from 'vitest';
import { createMemDb } from '@vouch/module/memdb';
import { HISTORY_DAYS, seedWorld, step } from '@vouch/module/sim';
import { historyFrom } from '../../detectors/history';
import { detector as coordinated } from '../../detectors/live/coordinated';
import { evaluate } from '../../detectors/eval';
import type { History } from '../../detectors/types';

const db = createMemDb();
seedWorld(db, { seed: 99n, population: 2500 });
while (db.simRun.id.find(1)!.day < HISTORY_DAYS + 80) step(db);
const h: History = historyFrom(db, db.simRun.id.find(1)!.day - 1);
const canon = (x: ReturnType<typeof coordinated.run>) => JSON.stringify(x.map((c) => c.agentIds));

describe('detectors', () => {
  it('T3.4 shuffling every agent\'s region does not change the coordinated detector\'s output', () => {
    const base = coordinated.run(h);
    expect(base.length).toBeGreaterThan(0);
    const regions = h.agents.map((a) => a.region).reverse();
    const shuffled: History = { ...h, agents: h.agents.map((a, i) => ({ ...a, region: regions[(i * 7919) % regions.length]! })) };
    expect(canon(coordinated.run(shuffled))).toEqual(canon(base));
  });

  it('T3.5 the evaluator scores detectors on a fresh seed and reports honest agents flagged', async () => {
    const [s] = await evaluate([coordinated], 4242n, 1500, 60);
    expect(s!.detector).toBe('coordinated');
    expect(s!.precision).toBeGreaterThanOrEqual(0);
    expect(s!.recall.ring).toBeGreaterThan(0.5);
    expect(s!.honestTotal).toBeGreaterThan(1000);
    expect(typeof s!.honestFlagged).toBe('number');
  });
});
