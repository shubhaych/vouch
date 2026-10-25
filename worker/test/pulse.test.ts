import { describe, expect, it } from 'vitest';
import { computePulse, guardMonitor, type PulseEvent } from '../src/pulse';

const now = 1_000_000_000;
const ev = (secondsAgo: number, sku: number, band = 'neutral', business = 2): PulseEvent =>
  ({ at: now - secondsAgo * 1000, sku, name: `Item ${sku}`, business, businessName: `B-${business}`, band });

describe('returns pulse', () => {
  it('counts the window, rates per item and calls a burst with no baseline a spike', () => {
    const events = [...Array(6)].map((_, i) => ev(5 + i, 1)).concat([ev(10, 2), ev(20, 2)]);
    const p = computePulse(events, now, { windowSeconds: 60, baselineSeconds: 600, spikeFactor: 3, minSpikeCount: 5 });
    expect(p.returns).toBe(8);
    expect(p.perSecond).toBeCloseTo(8 / 60, 3);
    expect(p.items[0]).toMatchObject({ sku: 1, count: 6, spike: true });
    expect(p.items[1]).toMatchObject({ sku: 2, count: 2, spike: false });
    expect(p.spikes).toBe(1);
    expect(p.businesses).toEqual([{ id: 2, name: 'B-2', count: 8 }]);
    expect(p.cohorts).toEqual([{ band: 'neutral', count: 8 }]);
  });
  it('is not a spike when the item returns at its usual rate', () => {
    // 60 in the previous ten minutes (0.1/s) and 6 in the last minute (0.1/s)
    const events = [...Array(60)].map((_, i) => ev(70 + i * 9, 1)).concat([...Array(6)].map((_, i) => ev(2 + i * 9, 1)));
    const p = computePulse(events, now, { windowSeconds: 60, baselineSeconds: 600, spikeFactor: 3, minSpikeCount: 5 });
    expect(p.items[0]!.count).toBe(6);
    expect(p.items[0]!.baselinePerSecond).toBeCloseTo(0.1, 3);
    expect(p.items[0]!.spike).toBe(false);
  });
  it('ignores events outside the window and the baseline', () => {
    const p = computePulse([ev(0.5, 1), ev(61, 1), ev(2000, 1)], now, { windowSeconds: 60, baselineSeconds: 600 });
    expect(p.returns).toBe(1);
    expect(p.baselinePerSecond).toBeCloseTo(1 / 600, 3);
  });
});

describe('Returns Monitor guard', () => {
  it('keeps the note descriptive: unknown anomaly kinds are dropped and shopper ids are scrubbed', () => {
    const g = guardMonitor({
      narrative: 'A-00421 returned twice; SKU-7 spiked.',
      anomalies: [{ sku: 'SKU-7', kind: 'spike', why: 'x', cites: ['SKU-7'] }, { sku: 'SKU-8', kind: 'fraud_ring', why: 'y', cites: [] }],
      items_to_watch: ['SKU-7'],
    });
    expect(g.narrative).toBe('a shopper returned twice; SKU-7 spiked.');
    expect(g.anomalies).toHaveLength(1);
    expect(g.anomalies[0]!.kind).toBe('spike');
  });
});
