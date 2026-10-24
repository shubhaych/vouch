// The illustrative shopping score (0 to 1000). Not a consumer report: it only
// exists inside the simulation. Every change goes through applyCredit in
// sim.ts, which writes a credit_event with its cause.

export const START_SCORE = 600;
export const LIVE_START_SCORE = 600;
export const SHOWCASE_SCORE_TARGET = 684;

export type Band = 'red' | 'amber' | 'neutral' | 'green';

export function bandOf(score: number): Band {
  if (score < 450) return 'red';
  if (score < 600) return 'amber';
  if (score < 750) return 'neutral';
  return 'green';
}

export const clampScore = (s: number): number => Math.max(0, Math.min(1000, Math.round(s)));

/** Score histogram bucket: 10 buckets of 100 points, 1000 lands in the top one. */
export const bucketOf = (score: number): number => Math.min(9, Math.floor(score / 100));

export const CREDIT = {
  kept: { kind: 'purchase_kept', delta: 3 },
  acceptedEvidence: { kind: 'refund_accepted', delta: 12 },
  acceptedFast: { kind: 'refund_accepted_fast', delta: 4 },
  declined: { kind: 'refund_declined', delta: -40 },
  fraudConfirmed: { kind: 'fraud_confirmed', delta: -120 },
  serialReturns: { kind: 'high_refund_ratio', delta: -15 },
  drift: { kind: 'inactivity_drift', delta: 1 }, // sign set toward 600
} as const;

/** Kept-purchase credit is capped: at most +15 per 30 simulated days. */
export const KEPT_CAP_PER_WINDOW = 15;
export const KEPT_WINDOW_DAYS = 30;
/** Refund requests above this share of completed purchases (rolling 90 days) cost 15 points once per window. */
export const SERIAL_RATIO = 0.4;
export const SERIAL_WINDOW_DAYS = 90;
export const INACTIVE_DAYS = 60;

export const BAND_COLORS: Record<Band, string> = {
  red: '#F87171',
  amber: '#FBBF24',
  neutral: '#94A3B8',
  green: '#34D399',
};
