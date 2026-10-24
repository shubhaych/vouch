import type { Lane, Tier } from './types';

export type { Lane, Tier };
export interface Item { priceCents: number; highTicket?: boolean }
export interface Flags { incident?: boolean; duplicatePhoto?: boolean; unableToVerify?: boolean }
export interface Terms { escrow: boolean; refundLane: Lane; payoutDays: number; confirm: 'none' | 'step_up' | 'person'; reasons: string[] }

// The build fixes the merchant at seller tier 2 (only the last column is used);
// the full matrix is here so Brand Vouch and High-Ticket Vouch can return later.
export const MERCHANT_SELLER_TIER: Tier = 2;

const CAP_CENTS: Record<Tier, number> = { 0: 0, 1: 0, 2: 20_000, 3: 100_000 }; // Lane A cap by buyer tier
const INSPECTION_DAYS = 3; // high-ticket inspection window
// rows: buyer tier 0, 1, 2-3; columns: seller tier 0, 1, 2-3; null = escrow to delivery
const PAYOUT: (number | null)[][] = [[null, null, 3], [null, 5, 2], [null, 5, 0]];
const col = (t: Tier) => (t >= 2 ? 2 : t);

export function handshake(buyer: Tier, seller: Tier, item: Item, flags: Flags = {}): Terms {
  const reasons: string[] = [];
  const cell = PAYOUT[col(buyer)]![col(seller)]!;
  let escrow = cell === null;
  let payoutDays = cell ?? 0;
  if (cell === null) reasons.push(seller === 0 ? 'seller is new: money waits for delivery' : 'buyer is new and seller is not yet established: money waits for delivery');

  let refundLane = (buyer >= 2 ? 'A' : buyer === 1 ? 'B' : 'C') as Lane;
  if (refundLane === 'A' && item.priceCents > CAP_CENTS[buyer]) { refundLane = 'B'; reasons.push('claim is over the buyer tier cap: part now, rest on proof'); }
  if (flags.unableToVerify && refundLane !== 'D') { refundLane = 'C'; reasons.push('evidence could not be verified: hold and verify, never deny'); }

  if (item.highTicket) { escrow = true; payoutDays += INSPECTION_DAYS; reasons.push(`high-ticket item: escrow through a ${INSPECTION_DAYS}-day inspection window`); }

  let confirm: Terms['confirm'] = refundLane === 'C' ? 'step_up' : 'none';
  if (flags.incident || flags.duplicatePhoto) {
    refundLane = 'D'; escrow = true; confirm = 'person';
    reasons.push(flags.incident ? 'an incident is on record' : 'the same photo appears under another account');
  }
  return { escrow, refundLane, payoutDays, confirm, reasons };
}
