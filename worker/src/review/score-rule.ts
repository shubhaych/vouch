// What a claim should do to the shopper's Vouch score, as a plain rule. It is
// the CREAO Score Reviewer's fixture answer, and the labelled fallback when that
// agent is not connected. The live agent sees the same input and may decide
// differently inside the bounds the module enforces (gain +1..+15, loss -1..-60).

export interface ScoreInput {
  decision: 'accepted' | 'declined';
  amountCents: number;
  requestedCents: number;
  factory?: { action: string; status: string; nextStep?: string; rationale?: string };
  challenge?: string; // passed | failed | unclear | unchecked
  extraClipUsed?: boolean;
  contradicted?: boolean;
  verifiedFraud?: boolean;
  shopper: { score: number; band: string };
}
export interface ScoreOutput { direction: 'gain' | 'loss' | 'same'; delta: number; reason: string }

export const SCORE_BOUNDS = { gain: [1, 15], loss: [-60, -1] } as const;
/** Rule 3 of the Score Reviewer's brief: a decline on inconclusive evidence is at most a small loss. */
export const INCONCLUSIVE_LOSS_FLOOR = -15;

/** Footage supported the claim: Factory validated an accept. */
export const supportedByVideo = (i: ScoreInput) => i.factory?.status === 'validated' && i.factory.action === 'accept';
/** Footage contradicted the claim: an audited contradiction or a validated decline. Verified fraud counts too. */
export const contradictedByVideo = (i: ScoreInput) => !!i.contradicted || i.factory?.action === 'decline' || !!i.verifiedFraud;

export function scoreRule(i: ScoreInput): ScoreOutput {
  if (i.decision === 'declined') {
    if (i.verifiedFraud) return { direction: 'loss', delta: -60, reason: 'Declined after an investigation verified fraud on this claim.' };
    if (i.contradicted || i.factory?.action === 'decline') return { direction: 'loss', delta: -40, reason: 'Declined: the video contradicted what the shopper said.' };
    return { direction: 'loss', delta: -10, reason: 'Declined by a person on inconclusive evidence: a small loss, not a fraud finding.' };
  }
  const supported = supportedByVideo(i);
  if (supported && i.amountCents >= i.requestedCents && !i.extraClipUsed) return { direction: 'gain', delta: 12, reason: 'Refund accepted with the problem shown clearly on video.' };
  if (supported) return { direction: 'gain', delta: 6, reason: i.extraClipUsed ? 'Accepted after one extra clip: credible, with a retry.' : 'Accepted at a partial amount: credible, partly supported.' };
  return { direction: 'same', delta: 0, reason: 'Accepted by a person without video support for the claim: no change either way.' };
}

export type Evaluated =
  | { ok: true; out: ScoreOutput; notes: string[] }
  | { ok: false; why: string };

/**
 * Checks the Score Reviewer's answer against its own brief before anything is applied. The agent
 * judges inside the rules; it does not get to break them: a declined claim never gains, an accepted
 * one never loses, the sign must match the direction, an inconclusive decline is at most a small
 * loss, and an accept the footage did not support stays "same". Bounds are clamped and noted;
 * anything else is rejected and the caller uses the labelled rule instead.
 */
export function evaluateScoreVerdict(i: ScoreInput, v: unknown): Evaluated {
  if (!v || typeof v !== 'object') return { ok: false, why: 'not a JSON object' };
  const o = v as Record<string, unknown>;
  const direction = String(o.direction);
  if (direction !== 'gain' && direction !== 'loss' && direction !== 'same') return { ok: false, why: `direction "${direction}" is not gain, loss or same` };
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (reason.length < 8) return { ok: false, why: 'no readable reason' };
  const raw = Number(o.delta);
  if (!Number.isFinite(raw)) return { ok: false, why: `delta "${String(o.delta)}" is not a number` };
  let delta = Math.round(raw);
  if (i.decision === 'declined' && direction === 'gain') return { ok: false, why: 'a declined claim cannot gain' };
  if (i.decision === 'accepted' && direction === 'loss') return { ok: false, why: 'an accepted claim cannot lose' };
  if (direction === 'same' && delta !== 0) return { ok: false, why: `"same" with a delta of ${delta}` };
  if (direction === 'gain' && delta <= 0) return { ok: false, why: `gain with a delta of ${delta}` };
  if (direction === 'loss' && delta >= 0) return { ok: false, why: `loss with a delta of ${delta}` };
  const notes: string[] = [];
  if (direction !== 'same') {
    const [lo, hi] = SCORE_BOUNDS[direction];
    const clamped = Math.max(lo, Math.min(hi, delta));
    if (clamped !== delta) { notes.push(`delta ${delta} clamped to ${clamped}`); delta = clamped; }
  }
  if (direction === 'loss' && !contradictedByVideo(i) && delta < INCONCLUSIVE_LOSS_FLOOR) {
    notes.push(`inconclusive decline: loss ${delta} limited to ${INCONCLUSIVE_LOSS_FLOOR}`);
    delta = INCONCLUSIVE_LOSS_FLOOR;
  }
  if (direction === 'gain' && !supportedByVideo(i)) return { ok: false, why: 'a gain needs video support for the claim' };
  return { ok: true, out: { direction, delta, reason: reason.slice(0, 300) }, notes };
}
