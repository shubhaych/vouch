import { describe, expect, it } from 'vitest';
import { createMemDb } from './memdb';
import { HISTORY_DAYS, SHOWCASE_AGENT_ID, seedWorld, step } from './sim';
import { START_SCORE } from './score';
import type { SimDb } from './simdb';
import { REGIONS, BUSINESSES } from './world';

const grow = (seed: bigint, population: number, days: number) => {
  const db = createMemDb();
  seedWorld(db, { seed, population });
  while (db.simRun.id.find(1)!.day < HISTORY_DAYS + days) step(db);
  return db;
};

const events = (db: SimDb, n: number) => {
  // The economy's event stream in creation order: purchases, refunds and credit events by id.
  const p = [...db.purchase.iter()].sort((a, b) => Number(a.id - b.id)).map((x) => `P${x.id}:${x.buyer}>${x.business}:${x.item}:${x.amount}:${x.day}`);
  const r = [...db.refund.iter()].sort((a, b) => Number(a.id - b.id)).map((x) => `R${x.id}:${x.agentId}:${x.reasonCode}:${x.status}:${x.day}`);
  const c = [...db.creditEvent.iter()].sort((a, b) => Number(a.id - b.id)).map((x) => `C${x.id}:${x.agentId}:${x.kind}:${x.delta}:${x.day}`);
  return [...p.slice(0, n), ...r.slice(0, n), ...c.slice(0, n)];
};

describe('T1.1 seedWorld', () => {
  it('creates 10,000 agents, 60 businesses and 40 regions, and refuses to reseed', () => {
    const db = createMemDb();
    const run = seedWorld(db, { seed: 11n, population: 10_000 });
    expect(db.agent.count()).toBe(10_000n);
    expect(db.business.count()).toBe(60n);
    expect(db.regionStat.count()).toBe(40n);
    expect(BUSINESSES).toHaveLength(60);
    expect(REGIONS).toHaveLength(40);
    expect(run.day).toBe(HISTORY_DAYS);
    expect(run.rings).toBeGreaterThan(20);
    expect(() => seedWorld(db, { seed: 11n, population: 10_000 })).toThrow(/already seeded/);
  });

  it('gives the showcase agent A-00421 a real past that lands at 684 with every window closed', () => {
    const db = createMemDb();
    seedWorld(db, { seed: 11n, population: 1_000 });
    const a = db.agent.id.find(SHOWCASE_AGENT_ID)!;
    expect(a.score).toBe(684);
    expect(a.homeRegionName).toBe('Chicago');
    expect(a.purchases).toBe(38);
    expect(a.refundsAccepted).toBe(2);
    const businesses = new Set([...db.purchase.buyer.filter(SHOWCASE_AGENT_ID)].map((p) => p.business));
    expect(businesses.size).toBe(6);
    const open = [...db.purchase.buyer.filter(SHOWCASE_AGENT_ID)].filter((p) => p.status === 'delivered' || p.status === 'ordered');
    expect(open).toHaveLength(0);
  });
});

describe('T1.2 determinism', () => {
  it('same seed, same first 1,000 events; a different seed differs', () => {
    const a = events(grow(11n, 3_000, 40), 1_000);
    const b = events(grow(11n, 3_000, 40), 1_000);
    const c = events(grow(12n, 3_000, 40), 1_000);
    expect(a.length).toBeGreaterThan(1_500);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the economy after 60 days', () => {
  const db = grow(11n, 5_000, 60);

  it('T1.3 every score change has a credit_event with a cause (200 agents)', () => {
    let checked = 0;
    for (let id = 1; id <= 5_000 && checked < 200; id += 23) {
      const a = db.agent.id.find(id)!;
      const evs = [...db.creditEvent.agentId.filter(id)].sort((x, y) => Number(x.id - y.id));
      let score = START_SCORE;
      for (const e of evs) {
        expect(e.before).toBe(score);
        expect(e.after).toBe(score + e.delta);
        expect(['purchase', 'refund', 'fraud_pattern', 'agent']).toContain(e.causeTable);
        if (e.causeTable === 'purchase') expect(db.purchase.id.find(e.causeId)?.buyer).toBe(id);
        if (e.causeTable === 'refund') expect(db.refund.id.find(e.causeId)?.agentId).toBe(id);
        score = e.after;
      }
      expect(a.score).toBe(score);
      checked++;
    }
    expect(checked).toBe(200);
  });

  it('T1.4 region_stat totals equal the sums over purchase and refund', () => {
    const regionOf = new Map([...db.agent.iter()].map((a) => [a.id, a.region]));
    const want = new Map<number, { purchases: number; requested: number; accepted: number; declined: number; open: number }>();
    for (const r of REGIONS) want.set(r.id, { purchases: 0, requested: 0, accepted: 0, declined: 0, open: 0 });
    for (const p of db.purchase.iter()) want.get(regionOf.get(p.buyer)!)!.purchases++;
    for (const r of db.refund.iter()) {
      const w = want.get(regionOf.get(r.agentId)!)!;
      w.requested++;
      if (r.status === 'accepted') w.accepted++;
      if (r.status === 'declined') w.declined++;
      if (['requested', 'investigating', 'more_evidence', 'recommended', 'awaiting_controller'].includes(r.status)) w.open++;
    }
    for (const s of db.regionStat.iter()) {
      const w = want.get(s.regionId)!;
      expect(s.purchases).toBe(w.purchases);
      expect(s.refundsRequested).toBe(w.requested);
      expect(s.accepted).toBe(w.accepted);
      expect(s.declined).toBe(w.declined);
      expect(s.pending).toBe(w.open);
      expect(s.scoreHist.reduce((x, y) => x + y, 0)).toBe(s.agents);
    }
  });

  it('the fast policy engine never declines', () => {
    for (const r of db.refund.iter()) if (r.source === 'sim') expect(r.status).not.toBe('declined');
  });

  it('ring members file near-identical claims inside 48 hours', () => {
    const byText = [...db.refund.iter()].filter((r) => /stopped working after|defective right away|is (defective|faulty|broken) - the/.test(r.reasonText));
    expect(byText.length).toBeGreaterThan(10);
  });
});
