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

/** What the CREAO panel said: the Refund Investigator's recommendation and the Risk Scorecard's caution. */
export interface PanelInput {
  investigator?: { action: string; confidence: number };
  scorecard?: { caution: string };
}

/**
 * The score change from a panel of CREAO seats doing their own jobs on the decided claim. The Refund
 * Investigator re-reads the finished evidence: when it backs the decision, the footage supported (or
 * contradicted) the claim. The Risk Scorecard's caution sizes the change. Null when no seat answered.
 */
export function panelVerdict(i: ScoreInput, p: PanelInput): ScoreOutput | null {
  if (!p.investigator && !p.scorecard) return null;
  const inv = p.investigator;
  const backs = inv && inv.confidence >= 0.5 ? inv.action : null;
  const caution = p.scorecard?.caution ?? 'unknown';
  const size = caution === 'high' ? 'high' : caution === 'low' ? 'low' : 'medium';
  const named = [inv ? `Refund Investigator ${inv.action.replace('_', ' ')} (${Math.round(inv.confidence * 100)}%)` : '', p.scorecard ? `Risk Scorecard caution ${caution}` : ''].filter(Boolean).join(', ');
  if (i.decision === 'accepted') {
    const supported = backs === 'accept' || (!inv && supportedByVideo(i));
    if (!supported) return { direction: 'same', delta: 0, reason: `Accepted, but the CREAO panel did not find video support for the claim, so no change (${named}).` };
    const full = i.amountCents >= i.requestedCents && !i.extraClipUsed;
    const base = full ? 12 : 6;
    const delta = Math.min(15, Math.max(1, size === 'high' ? Math.round(base / 2) : size === 'low' ? base + 2 : base));
    return { direction: 'gain', delta, reason: `Accepted with support on video, confirmed by the CREAO panel (${named}).` };
  }
  if (i.verifiedFraud) return { direction: 'loss', delta: -60, reason: `Declined after a confirmed fraud pattern (${named}).` };
  const contradicted = backs === 'decline' || (!inv && contradictedByVideo(i));
  if (contradicted) {
    const delta = size === 'high' ? -50 : size === 'low' ? -30 : -40;
    return { direction: 'loss', delta, reason: `Declined: the CREAO panel found the video contradicted the claim (${named}).` };
  }
  const delta = size === 'high' ? -15 : size === 'low' ? -5 : -10;
  return { direction: 'loss', delta, reason: `Declined on evidence the CREAO panel found inconclusive: a small loss, not a fraud finding (${named}).` };
}
