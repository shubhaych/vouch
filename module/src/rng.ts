// xorshift64*: the one PRNG of the simulation. Its state lives in
// sim_run.rngState so the same seed replays the same economy, which is what
// makes Fraud Replay and the detector evaluator honest. Never Math.random.
const MASK = (1n << 64n) - 1n;
const MULT = 0x2545f4914f6cdd1dn;

export class Rng {
  state: bigint;

  constructor(state: bigint) {
    // A zero state would stay zero forever.
    this.state = state & MASK || 0x9e3779b97f4a7c15n;
  }

  static fromSeed(seed: bigint | number): Rng {
    // splitmix64 scramble so nearby seeds give unrelated streams
    let z = (BigInt(seed) + 0x9e3779b97f4a7c15n) & MASK;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return new Rng(z ^ (z >> 31n));
  }

  private next64(): bigint {
    let x = this.state;
    x ^= x >> 12n;
    x ^= (x << 25n) & MASK;
    x ^= x >> 27n;
    this.state = x;
    return (x * MULT) & MASK;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return Number(this.next64() >> 11n) / 9007199254740992;
  }

  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }

  /** Index by weight. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

/** Stable small hash for per-agent traits that must not consume the shared stream. */
export function hash32(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x2f;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const unitHash = (...parts: (number | string)[]): number => hash32(...parts) / 4294967296;
