// Pure shared types. No spacetimedb imports here: web and worker import this file.

export type Tier = 0 | 1 | 2 | 3;
export type Lane = 'A' | 'B' | 'C' | 'D';

/** Every record and number in the UI carries one of these. */
export type Provenance = 'live' | 'seeded' | 'simulated';

export type Verdict =
  | 'supported'
  | 'partly_supported'
  | 'not_supported'
  | 'unable_to_verify'
  | 'not_contested'; // instant path: no claim dispute, the stored record decides

export type Seat = 'refund_desk' | 'credit_analyst' | 'agent_order' | 'reconciler';

export type DecisionKind = 'refund_lane' | 'ledger_adjust' | 'tier_change';
export type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'posted';
export type Role = 'proposer' | 'approver' | 'poster' | 'controller';

/** Reason codes are stable strings: they land in the ledger and the UI. */
export type ReasonCode =
  | 'DUPLICATE_PHOTO'
  | 'INCIDENT_ON_RECORD'
  | 'IDENTITY_MISMATCH'
  | 'EVIDENCE_CONTRADICTS'
  | 'UNDERWRITER_OFFLINE'
  | 'RECORD_EXPIRED'
  | 'UNABLE_TO_VERIFY'
  | 'NOT_SUPPORTED_HOLD'
  | 'TIER_0_VERIFY'
  | 'OVER_HOLD_THRESHOLD'
  | 'OVER_INSTANT_CAP'
  | 'THIN_HISTORY'
  | 'PARTLY_SUPPORTED'
  | 'WITHIN_INSTANT_CAP';

export interface MerchantPolicy {
  /** Lane A cap in cents, by customer tier. Tiers 0 and 1 never reach Lane A. */
  instantCapCents: Record<Tier, number>;
  /** A claim above this goes to Lane C regardless of tier. */
  holdThresholdCents: number;
  /** Return window in days. */
  returnWindowDays: number;
  /** Approvals above this need the controller. */
  materialityCents: number;
  /** Vouch Record lifetime. */
  recordExpiryDays: number;
  /** Acceptable loss per $1,000 refunded, in cents. Drives the Atlas curve. */
  riskDialLossPer1000Cents: number;
}

/** Defaults from the guide's refund ladder. The merchant edits these on /merchant. */
export const DEFAULT_POLICY: MerchantPolicy = {
  instantCapCents: { 0: 0, 1: 0, 2: 20_000, 3: 100_000 },
  holdThresholdCents: 100_000,
  returnWindowDays: 30,
  materialityCents: 50_000,
  recordExpiryDays: 30,
  riskDialLossPer1000Cents: 2_000,
};
