import { z } from 'zod';
import type { FactoryAssessment } from '@vouch/module/review-types';
import type { SpokenClaim } from '@vouch/module/review-score';
import type { FindingRec } from './state';

const EvidenceReason = z.object({ findingId: z.string().regex(/^\d+$/), reason: z.string().min(10).max(600) });
export const AssessmentFields = {
  action: z.enum(['accept', 'decline', 'more_evidence']),
  amountCents: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(20).max(1600),
  forRefund: z.array(EvidenceReason).max(12),
  againstRefund: z.array(EvidenceReason).max(12),
  statements: z.array(z.object({ claimId: z.string(), findingIds: z.array(z.string().regex(/^\d+$/)).min(1), analysis: z.string().min(10).max(700) })).max(8),
  missingEvidence: z.array(z.string().min(10).max(400)).max(6),
  nextStep: z.enum(['extra_clip', 'human_review']).optional()
    .describe('more_evidence only. extra_clip: one more customer clip showing something specific would settle it. human_review: no clip can settle it (e.g. missing contents nobody filmed being unpacked).'),
};
export const AssessmentDraftSchema = z.object(AssessmentFields);
export type AssessmentDraft = z.infer<typeof AssessmentDraftSchema>;
export const FactoryAssessmentSchema = AssessmentDraftSchema.extend({
  requestedCents: z.number().int().min(0), status: z.enum(['validated', 'needs_review', 'unavailable']), guardNotes: z.array(z.string()),
}) satisfies z.ZodType<FactoryAssessment>;

/** Apply AFTER both audits. A low history/formula score alone never demands another video. */
export function assessRefund(draft: AssessmentDraft | undefined, findings: FindingRec[], claims: SpokenClaim[], requestedCents: number, lanesOnly: boolean): FactoryAssessment {
  if (!draft || lanesOnly) return {
    action: 'more_evidence', amountCents: 0, requestedCents, confidence: 0,
    rationale: 'Factory did not complete an evidence-backed recommendation. A person should review the available footage; this is not evidence against the customer.',
    forRefund: [], againstRefund: [], statements: [], missingEvidence: [], nextStep: 'human_review', status: 'unavailable', guardNotes: ['No complete Factory assessment is available. Do not ask the customer to re-record solely because processing failed.'],
  };
  const byId = new Map(findings.map((f) => [String(f.id), f]));
  const issues: string[] = [];
  const passed = (id: string) => byId.get(id)?.auditStatus === 'passed';
  const reasons = (items: AssessmentDraft['forRefund'], kind: string) => items.filter((r) => {
    if (passed(r.findingId) && byId.get(r.findingId)?.kind === kind) return true;
    issues.push(`Evidence ${r.findingId} did not pass the audit as ${kind}.`);
    return false;
  });
  const forRefund = reasons(draft.forRefund, 'supports');
  const againstRefund = reasons(draft.againstRefund, 'contradicts');
  const statements = draft.statements.filter((s) => {
    if (claims.some((c) => c.id === s.claimId) && s.findingIds.every((id) => passed(id) && byId.get(id)?.spokenClaimId === s.claimId)) return true;
    issues.push(`Statement ${s.claimId} cites unverified or unrelated findings.`);
    return false;
  });
  for (const c of claims) if (statements.filter((s) => s.claimId === c.id).length !== 1) issues.push(`Statement ${c.id} needs exactly one audited analysis.`);
  const material = claims.filter((c) => c.kind !== 'context');
  const strong = (kind: string, confidence: number) => findings.filter((f) => f.kind === kind && f.auditStatus === 'passed' && f.confidence >= confidence && material.some((c) => c.id === f.spokenClaimId));
  if (draft.amountCents > requestedCents) issues.push('The amount exceeds the requested refund.');
  if (draft.action === 'accept') {
    if (draft.amountCents <= 0 || draft.confidence < 0.65 || !forRefund.some((r) => strong('supports', 0.7).some((f) => String(f.id) === r.findingId))) issues.push('Approval requires a positive amount and a confidently supported material claim.');
  } else if (draft.action === 'decline') {
    const contradictions = strong('contradicts', 0.8);
    if (!material.length || draft.confidence < 0.8 || material.some((c) => !contradictions.some((f) => f.spokenClaimId === c.id && againstRefund.some((r) => r.findingId === String(f.id))))) {
      issues.push('Rejection requires strong audited contradiction of every material claim, not absence of proof.');
    }
    if (strong('supports', 0.5).length) issues.push('Supporting evidence remains; a person must resolve it before any rejection.');
    if (draft.missingEvidence.length) issues.push('Material evidence is still missing; rejection is not justified.');
  } else if (draft.nextStep !== 'human_review' && !draft.missingEvidence.length) issues.push('An inconclusive recommendation must name the specific evidence that would change the answer.');
  if (draft.action !== 'accept' && draft.amountCents !== 0) issues.push('Only an approval may propose a refund amount.');
  // A recommendation that failed its checks goes to a person. Otherwise only "more evidence" has a next step,
  // and without one a named missing observation means one more clip.
  const nextStep = issues.length ? 'human_review' : draft.action !== 'more_evidence' ? undefined : draft.nextStep ?? (draft.missingEvidence.length ? 'extra_clip' : 'human_review');
  const { nextStep: _asked, ...rest } = draft;
  return {
    ...rest, forRefund, againstRefund, statements, requestedCents, ...(nextStep ? { nextStep } : {}),
    ...(issues.length ? { action: 'more_evidence' as const, amountCents: 0, rationale: 'A person must review this case because the proposed recommendation did not pass its evidence checks. ' + draft.rationale } : {}),
    status: issues.length ? 'needs_review' : 'validated', guardNotes: [...new Set(issues)],
  };
}

/** The finger challenge as the Case Analyst recorded it (a finding the audit rejected does not count). */
export function challengeOf(state: { findings: Map<bigint, FindingRec> }): 'passed' | 'failed' | 'unclear' | 'unchecked' {
  const ids = new Set([...state.findings.values()].filter((f) => f.kind === 'integrity' && f.auditStatus !== 'rejected').map((f) => f.spokenClaimId));
  return ids.has('challenge:passed') ? 'passed' : ids.has('challenge:failed') ? 'failed' : ids.has('challenge:unclear') ? 'unclear' : 'unchecked';
}

/**
 * What happens after the review. One extra clip when a specific, filmable thing would settle it or the
 * finger challenge was missed; a person when the clip is used up, no clip could settle it, or the
 * recommendation failed its checks. A processing failure never sends the customer back to re-record.
 */
export function nextMove(a: FactoryAssessment, challenge: ReturnType<typeof challengeOf>, usedExtra: boolean, lanesOnly: boolean): 'extra_clip' | 'person' | 'verdict' {
  const challengeMissed = !lanesOnly && (challenge === 'failed' || challenge === 'unclear');
  const wantsClip = a.status !== 'unavailable' && (challengeMissed || (a.status === 'validated' && a.action === 'more_evidence' && a.nextStep === 'extra_clip'));
  if (wantsClip) return usedExtra ? 'person' : 'extra_clip';
  return a.status === 'validated' && a.action !== 'more_evidence' ? 'verdict' : 'person';
}
