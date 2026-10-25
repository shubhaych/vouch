import { describe, expect, it } from 'vitest';
import type { SpokenClaim } from '@vouch/module/review-score';
import type { FactoryAssessment } from '@vouch/module/review-types';
import { assessRefund, challengeOf, nextMove, type AssessmentDraft } from '../src/review/assessment';
import { joinArgs, targetSize, type VideoMeta } from '../src/review/ingest';
import type { FindingRec } from '../src/review/state';

// The review ends in a verdict, one extra clip, or a person. A missed finger challenge earns one
// retry (never a decline, never a credit change); an unverifiable claim goes straight to a person.
const claims: SpokenClaim[] = [{ id: 'c1', text: 'the cable is about three feet, not ten', kind: 'defect', tSaid: 3 }];
const f = (id: number, over: Partial<FindingRec>): FindingRec => ({
  id: BigInt(id), kind: 'supports', spokenClaimId: 'c1', observation: 'The cable spans about two hand lengths, roughly 1 m.', tStart: 2, tEnd: 6, confidence: 0.8,
  artifactIds: [1n], method: 'looked', auditStatus: 'passed', auditNote: '', ...over,
});
const draft = (over: Partial<AssessmentDraft>): AssessmentDraft => ({
  action: 'accept', amountCents: 2900, confidence: 0.8, rationale: 'The cable shown is far shorter than the ten feet ordered.',
  forRefund: [{ findingId: '1', reason: 'The cable is about 1 m long against two hands.' }], againstRefund: [],
  statements: [{ claimId: 'c1', findingIds: ['1'], analysis: 'The footage shows a cable of about 1 m.' }], missingEvidence: [], ...over,
});
const assessed = (d: AssessmentDraft, findings: FindingRec[] = [f(1, {})]) => assessRefund(d, findings, claims, 2900, false);
const state = (...fs: FindingRec[]) => ({ findings: new Map(fs.map((x) => [x.id, x])) });

describe('assessment next step', () => {
  it('an accept with audited support is a verdict', () => {
    const a = assessed(draft({}));
    expect(a.status).toBe('validated');
    expect(a.nextStep).toBeUndefined();
    expect(nextMove(a, 'passed', false, false)).toBe('verdict');
  });

  it('unverifiable missing contents go to a person without naming more footage', () => {
    const a = assessed(draft({ action: 'more_evidence', amountCents: 0, forRefund: [], nextStep: 'human_review', rationale: 'The case is shown empty, but nobody filmed it being opened.' }), [f(1, { kind: 'neutral' })]);
    expect(a.status).toBe('validated');
    expect(a.nextStep).toBe('human_review');
    expect(nextMove(a, 'passed', false, false)).toBe('person');
  });

  it('a named filmable gap defaults to one extra clip', () => {
    const a = assessed(draft({ action: 'more_evidence', amountCents: 0, forRefund: [], missingEvidence: ['Lay the cable next to a tape measure from end to end.'] }), [f(1, { kind: 'neutral' })]);
    expect(a.nextStep).toBe('extra_clip');
    expect(nextMove(a, 'passed', false, false)).toBe('extra_clip');
    expect(nextMove(a, 'passed', true, false)).toBe('person');
  });

  it('a recommendation that fails its checks goes to a person', () => {
    const a = assessed(draft({ action: 'decline', amountCents: 0, forRefund: [], confidence: 0.6 }));
    expect(a.status).toBe('needs_review');
    expect(a.nextStep).toBe('human_review');
    expect(nextMove(a, 'passed', false, false)).toBe('person');
  });
});

describe('finger challenge retry', () => {
  it('reads the challenge from integrity findings, ignoring rejected ones', () => {
    expect(challengeOf(state(f(9, { kind: 'integrity', spokenClaimId: 'challenge:failed' })))).toBe('failed');
    expect(challengeOf(state(f(9, { kind: 'integrity', spokenClaimId: 'challenge:failed', auditStatus: 'rejected' })))).toBe('unchecked');
    expect(challengeOf(state(f(9, { kind: 'integrity', spokenClaimId: 'challenge:unclear' }), f(10, { kind: 'integrity', spokenClaimId: 'challenge:passed' })))).toBe('passed');
  });

  it('a missed challenge asks for the one extra clip even when the item evidence is clear, then a person', () => {
    const a = assessed(draft({}));
    expect(nextMove(a, 'failed', false, false)).toBe('extra_clip');
    expect(nextMove(a, 'unclear', false, false)).toBe('extra_clip');
    expect(nextMove(a, 'failed', true, false)).toBe('person');
  });

  it('never asks the customer to re-record because processing failed', () => {
    const a: FactoryAssessment = assessRefund(undefined, [], claims, 2900, true);
    expect(a.status).toBe('unavailable');
    expect(nextMove(a, 'failed', false, true)).toBe('person');
    expect(nextMove(a, 'unchecked', false, false)).toBe('person');
  });
});

describe('joining the extra clip', () => {
  const meta = (over: Partial<VideoMeta>): VideoMeta => ({
    durationS: 10, width: 1280, height: 720, fps: 30, codec: 'h264', rotation: 0, hasAudio: true, creationTime: null, encoder: null, make: null, model: null, bitrate: null, container: 'mp4', ...over,
  });

  it('keeps a rotated phone clip portrait', () => {
    expect(targetSize(meta({ rotation: -90 }))).toEqual({ w: 406, h: 720 });
    expect(targetSize(meta({ width: 640, height: 480 }))).toEqual({ w: 640, h: 480 });
  });

  it('gives a silent clip a silent track so both clips join, and writes the WAV only when there is sound', () => {
    const args = joinArgs({ file: 'a.mov', meta: meta({}) }, { file: 'b.mp4', meta: meta({ hasAudio: false, durationS: 6 }) });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('anullsrc=r=48000:cl=mono,atrim=0:6[a1]');
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(args).toContain('audio.wav');
    const mute = joinArgs({ file: 'a.mov', meta: meta({ hasAudio: false }) }, { file: 'b.mp4', meta: meta({ hasAudio: false }) });
    expect(mute.join(' ')).toContain('concat=n=2:v=1:a=0');
    expect(mute).not.toContain('audio.wav');
  });
});
