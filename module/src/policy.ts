import { DEFAULT_POLICY, type Lane, type MerchantPolicy, type ReasonCode, type Tier, type Verdict } from './types';

export interface Evidence {
  verdict: Verdict;
  /** Sources disagree in a way the Refund Desk could not settle. */
  contradicts?: boolean;
}

export interface DecideFlags {
  duplicatePhoto?: boolean;
  incident?: boolean;
  identityMismatch?: boolean;
  /** creao_enabled is off, or no agent run completed inside the expiry window. */
  underwriterOffline?: boolean;
  /** The stored Vouch Record has expired. */
  recordExpired?: boolean;
}

export interface Claim { amountCents: number }

export interface Decision { lane: Lane; reasons: ReasonCode[] }

/**
 * The Policy Engine. Deterministic: a model supplies the verdict, never the lane.
 * Order matters: D (a person) beats C (hold and verify) beats A (instant) beats B.
 * Missing evidence always lands in C. Nothing here denies a claim.
 */
export function decide(
  tier: Tier,
  evidence: Evidence,
  flags: DecideFlags,
  claim: Claim,
  policy: MerchantPolicy = DEFAULT_POLICY,
): Decision {
  const stop: ReasonCode[] = [];
  if (flags.duplicatePhoto) stop.push('DUPLICATE_PHOTO');
  if (flags.incident) stop.push('INCIDENT_ON_RECORD');
  if (flags.identityMismatch) stop.push('IDENTITY_MISMATCH');
  if (evidence.contradicts) stop.push('EVIDENCE_CONTRADICTS');
  if (stop.length) return { lane: 'D', reasons: stop };

  const hold: ReasonCode[] = [];
  if (flags.underwriterOffline) hold.push('UNDERWRITER_OFFLINE'); // fail closed
  if (flags.recordExpired) hold.push('RECORD_EXPIRED');
  if (evidence.verdict === 'unable_to_verify') hold.push('UNABLE_TO_VERIFY');
  if (evidence.verdict === 'not_supported') hold.push('NOT_SUPPORTED_HOLD'); // hold and verify, never deny
  if (tier === 0) hold.push('TIER_0_VERIFY');
  if (claim.amountCents > policy.holdThresholdCents) hold.push('OVER_HOLD_THRESHOLD');
  if (hold.length) return { lane: 'C', reasons: hold };

  const cap = policy.instantCapCents[tier];
  const okVerdict = evidence.verdict === 'supported' || evidence.verdict === 'not_contested';
  if (tier >= 2 && okVerdict && claim.amountCents <= cap) return { lane: 'A', reasons: ['WITHIN_INSTANT_CAP'] };

  const why: ReasonCode[] = [];
  if (tier === 1) why.push('THIN_HISTORY');
  if (tier >= 2 && claim.amountCents > cap) why.push('OVER_INSTANT_CAP');
  if (evidence.verdict === 'partly_supported') why.push('PARTLY_SUPPORTED');
  return { lane: 'B', reasons: why };
}
