import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { FLAG_AT, risk } from './detector';
import { allowedRungs, codeStep, supported, zeroSignals, type Signals } from './exposure';
import { SIM } from './sim-config';

const s = (o: Partial<Signals>): Signals => ({ ...zeroSignals(), ...o });
const ring = s({ refund_share_vs_baseline: 400_00, contradicted_rate: 60_00, ring_concentration: 80_00 });
const saleDay = s({ refund_share_vs_baseline: 180_00 });
const defects = s({ refund_share_vs_baseline: 300_00 });

describe('exposure ladder', () => {
  it('a ring with three signals over the hedge line climbs one rung per check, and Pause waits for the controller', () => {
    let rung = codeStep('normal', 0, 6, ring, undefined);
    expect(rung.next).toBe('watch');
    rung = codeStep('watch', 6, 12, ring, ring);
    expect(rung.next).toBe('hedge');
    rung = codeStep('hedge', 12, 18, ring, ring);
    expect(rung.next).toBe('hedge');
    expect(rung.pausePending).toBe(true);
  });

  it('decoys reach Watch at most: a sale day and a defective batch have one signal, no ring concentration', () => {
    expect(supported(saleDay, saleDay)).toBe('watch');
    expect(supported(defects, defects)).toBe('watch');
    expect(codeStep('watch', 0, 6, defects, defects).next).toBe('watch');
  });

  it('proposals may stay, go down one, or go up one only when the triggers allow', () => {
    expect(allowedRungs('normal', ring, undefined)).toEqual(['normal', 'watch']);
    expect(allowedRungs('watch', defects, defects)).toEqual(['normal', 'watch']);
    expect(allowedRungs('hedge', zeroSignals(), zeroSignals())).toEqual(['watch', 'hedge']);
  });

  it('comes down one rung after expiry when the signals have calmed', () => {
    expect(codeStep('hedge', 0, 71, zeroSignals(), zeroSignals()).next).toBe('hedge');
    expect(codeStep('hedge', 0, 72, zeroSignals(), zeroSignals()).next).toBe('watch');
    expect(codeStep('watch', 72, 96, zeroSignals(), zeroSignals()).next).toBe('normal');
  });
});

describe('detector calibration (design targets: about 75% recall, about 5% false flags)', () => {
  it('lands near the targets on simulated features, and is not perfect', () => {
    const rng = Rng.fromSeed(7);
    const bp = (x: number) => rng.next() * 10_000 < x;
    let fraud = 0, legit = 0, tp = 0, fp = 0;
    for (let i = 0; i < 20_000; i++) {
      const isFraud = bp(SIM.fraudShareBp);
      const arche = isFraud ? SIM.fraudArchetypes[rng.int(0, SIM.fraudArchetypes.length - 1)]! : 'legit';
      const score = isFraud ? rng.int(380, 700) : rng.int(470, 820);
      const f = {
        contradicted: bp(SIM.contradictedBp[arche] ?? 500),
        hashReuse: bp(isFraud ? SIM.hashReuseBp.fraud : SIM.hashReuseBp.legit),
        crossCompany: isFraud && bp(1_000),
        score,
        noise: rng.next(),
      };
      const flagged = risk(f) >= FLAG_AT;
      if (isFraud) { fraud++; if (flagged) tp++; } else { legit++; if (flagged) fp++; }
    }
    const recall = tp / fraud;
    const falseFlag = fp / legit;
    expect(recall).toBeGreaterThan(0.5);
    expect(recall).toBeLessThan(0.95);
    expect(falseFlag).toBeGreaterThan(0.01);
    expect(falseFlag).toBeLessThan(0.12);
  });
});
