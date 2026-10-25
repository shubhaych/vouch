// The Exposure Guardian's ladder, in code. Signals are computed per company
// from its own rows; the hard triggers decide which rungs are allowed; the
// Guardian (a CREAO agent) may only propose inside them, one rung at a time,
// and may always propose coming down. Pause needs the company's controller.
import { POLICY, RUNGS, SIGNAL_KEYS, type Rung, type SignalKey } from './policy';

export type Signals = Record<SignalKey, number>;
export interface Check { hour: number; signals: Signals }

export const zeroSignals = (): Signals => Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 0])) as Signals;
const lines = POLICY.exposure.signals;

export function over(s: Signals) {
  return {
    watch: SIGNAL_KEYS.filter((k) => s[k] >= lines[k].watch),
    hedge: SIGNAL_KEYS.filter((k) => s[k] >= lines[k].hedge),
  };
}

const hedgeOk = (s: Signals) => over(s).hedge.length >= 2;
const pauseOk = (s: Signals) => { const h = over(s).hedge; return h.length >= 3 && h.includes('ring_concentration'); };

/** The highest rung today's signals and the previous check would justify. */
export function supported(now: Signals, prev: Signals | undefined): Rung {
  if (prev && pauseOk(now) && pauseOk(prev)) return 'pause';
  if (prev && hedgeOk(now) && hedgeOk(prev)) return 'hedge';
  return over(now).watch.length >= 1 ? 'watch' : 'normal';
}

/** Rungs a proposal may name: stay, one down, or one up when the triggers support it. Never two at once. */
export function allowedRungs(current: Rung, now: Signals, prev: Signals | undefined): Rung[] {
  const i = RUNGS.indexOf(current);
  const top = RUNGS.indexOf(supported(now, prev));
  const out = new Set<Rung>([current]);
  if (i > 0) out.add(RUNGS[i - 1]!);
  if (top > i) out.add(RUNGS[i + 1]!);
  return RUNGS.filter((r) => out.has(r));
}

/**
 * What code does on its own at a check: climb one rung when supported (a Pause
 * is only proposed: the controller confirms it), or come down one rung once the
 * current rung has expired and the signals no longer support it.
 */
export function codeStep(current: Rung, sinceHour: number, hour: number, now: Signals, prev: Signals | undefined): { next: Rung; pausePending: boolean; reason: string } {
  const top = supported(now, prev);
  const i = RUNGS.indexOf(current);
  const t = RUNGS.indexOf(top);
  const o = over(now);
  const why = o.hedge.length ? `over the hedge line: ${o.hedge.join(', ')}` : o.watch.length ? `over the watch line: ${o.watch.join(', ')}` : 'every signal under its watch line';
  if (t > i) {
    const next = RUNGS[i + 1]!;
    if (next === 'pause') return { next: current, pausePending: true, reason: `Pause proposed (${why}); the controller confirms` };
    return { next, pausePending: false, reason: `Climbed to ${next}: ${why}` };
  }
  const expiry = current === 'normal' ? 0 : POLICY.exposure.expiryHours[current as 'watch' | 'hedge' | 'pause'];
  if (i > 0 && t < i && hour - sinceHour >= expiry) return { next: RUNGS[i - 1]!, pausePending: false, reason: `Expired after ${expiry} h and ${why}; came down one rung` };
  return { next: current, pausePending: false, reason: '' };
}

/** The immediate leg's share under each rung (basis points), and whether payouts queue for a person. */
export const rungEffect = (r: Rung) => ({
  leg1ShareBp: r === 'hedge' ? POLICY.exposure.hedgeLeg1ShareBp : null,
  returnFirstForRisky: r === 'hedge',
  queueForReview: r === 'pause',
});
