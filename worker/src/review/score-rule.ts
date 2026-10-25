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

export function scoreRule(i: ScoreInput): ScoreOutput {
  if (i.decision === 'declined') {
    if (i.verifiedFraud) return { direction: 'loss', delta: -60, reason: 'Declined after an investigation verified fraud on this claim.' };
    if (i.contradicted || i.factory?.action === 'decline') return { direction: 'loss', delta: -40, reason: 'Declined: the video contradicted what the shopper said.' };
    return { direction: 'loss', delta: -10, reason: 'Declined by a person on inconclusive evidence: a small loss, not a fraud finding.' };
  }
  const supported = i.factory?.status === 'validated' && i.factory.action === 'accept';
  if (supported && i.amountCents >= i.requestedCents && !i.extraClipUsed) return { direction: 'gain', delta: 12, reason: 'Refund accepted with the problem shown clearly on video.' };
  if (supported) return { direction: 'gain', delta: 6, reason: i.extraClipUsed ? 'Accepted after one extra clip: credible, with a retry.' : 'Accepted at a partial amount: credible, partly supported.' };
  return { direction: 'same', delta: 0, reason: 'Accepted by a person without video support for the claim: no change either way.' };
}
