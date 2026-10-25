// The return reserve. At month end every open second leg is accrued at the
// expected completion rate for its tier and category; day one of the next
// period reverses it; when the return resolves, the difference between the
// accrual and what really happened is the true-up the rates learn from.
// Rates are basis points (integers); money is integer cents.
import { accrualCents } from './ledger';
import { POLICY } from './policy';

export interface RateCell { tier: string; category: string; completed: number; resolved: number }

/**
 * Expected completion rate for one segment, smoothed toward the overall rate
 * with a Beta prior of the policy's strength, so a thin segment does not swing
 * the reserve. The shopper's Vouch band may define a segment; it never treats
 * one person differently.
 */
export function completionRateBp(cell: { completed: number; resolved: number } | undefined, overallBp: number = POLICY.reserve.defaultRateBp): number {
  const k = POLICY.reserve.priorStrength;
  const completed = cell?.completed ?? 0;
  const resolved = cell?.resolved ?? 0;
  return Math.floor(((completed * 10_000) + k * overallBp + Math.floor((resolved + k) / 2)) / (resolved + k));
}

export interface OpenLeg { obligationId: string; tier: string; category: string; leg2Cents: number }
export interface AccrualLine { obligationId: string; rateBp: number; cents: number }

/** The month-end accrual, one line per open obligation, rate from its segment. */
export function accrue(open: readonly OpenLeg[], rates: (tier: string, category: string) => number): { lines: AccrualLine[]; totalCents: number } {
  const lines = open.map((o) => {
    const rateBp = rates(o.tier, o.category);
    return { obligationId: o.obligationId, rateBp, cents: accrualCents(o.leg2Cents, rateBp) };
  });
  return { lines, totalCents: lines.reduce((s, l) => s + l.cents, 0) };
}

/** Positive = the reserve was short (more was paid than accrued); this is what the next month learns from. */
export const trueUpCents = (accruedCents: number, actualCents: number) => actualCents - accruedCents;
