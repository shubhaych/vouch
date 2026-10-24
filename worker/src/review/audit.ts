// The deterministic audit the worker always runs, whether or not the Report
// Auditor session ran: never trust a finding we did not check ourselves. A
// finding passes only when every check below holds and the Droid auditor (if
// it ran) did not reject it.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SpokenClaim } from '@vouch/module/review-score';
import { sha256File } from './paths';
import { CLIP_MAX_S } from './proof';
import type { ArtifactRec, FindingRec } from './state';

export const PERSON_JUDGEMENT = /\b(liar|lying|lies|fraud(ster|ulent)?|scam(mer|ming)?|dishonest|cheat(er|ing)?|fake customer|suspicious (person|customer)|criminal|con artist|untrustworthy)\b/i;
/** Artifacts that describe a moment must overlap the finding's window (with slack); scripts, logs and measurements are time-agnostic. */
const TIMELESS = new Set(['script', 'measurement', 'chart', 'log', 'transcript', 'audio', 'video']);
const SLACK_S = 1.5;

export interface AuditVerdict { id: bigint; status: 'passed' | 'rejected'; note: string }

export function auditFindings(dir: string, findings: FindingRec[], artifacts: Map<bigint, ArtifactRec>, durationS: number, claims: SpokenClaim[]): AuditVerdict[] {
  const out: AuditVerdict[] = [];
  const seenClaim = new Set<string>();
  const sorted = [...findings].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const f of sorted) {
    const problems: string[] = [];
    if (!f.observation.trim()) problems.push('empty observation');
    if (PERSON_JUDGEMENT.test(f.observation)) problems.push('the observation judges the person instead of describing the footage');
    if (!(f.tStart >= 0 && f.tStart <= f.tEnd)) problems.push('tStart/tEnd are not ordered');
    if (f.tEnd > durationS + 0.5) problems.push(`tEnd ${f.tEnd.toFixed(1)} s is past the end of the video (${durationS.toFixed(1)} s)`);
    if (!(f.confidence >= 0 && f.confidence <= 1)) problems.push('confidence outside 0..1');
    const cited = f.artifactIds.map((id) => artifacts.get(id)).filter((a): a is ArtifactRec => !!a);
    if (!cited.length) problems.push('no cited artifact exists');
    let anyIntact = false;
    for (const a of cited) {
      const abs = resolve(dir, a.path);
      if (!existsSync(abs)) { problems.push(`artifact ${a.path} is missing`); continue; }
      if (sha256File(abs) !== a.sha256) { problems.push(`artifact ${a.path} changed after it was registered`); continue; }
      anyIntact = true;
    }
    if (cited.length && !anyIntact) problems.push('no cited artifact is intact');
    const visual = cited.filter((a) => !TIMELESS.has(a.kind) && a.kind !== 'clip');
    if (visual.length && !visual.some((a) => a.tEnd >= f.tStart - SLACK_S && a.tStart <= f.tEnd + SLACK_S)) problems.push('no cited frame or crop overlaps the finding window');
    if (f.kind !== 'integrity') {
      if (!claims.some((c) => c.id === f.spokenClaimId)) problems.push(`spokenClaimId ${f.spokenClaimId} is not one of the spoken claims`);
      else if (seenClaim.has(f.spokenClaimId)) problems.push(`a second finding for ${f.spokenClaimId}; exactly one is allowed`);
      else seenClaim.add(f.spokenClaimId);
    }
    const clip = cited.find((a) => a.kind === 'clip');
    if (!clip) problems.push('no proof clip covers this finding');
    else if (clip.tStart > f.tStart + SLACK_S || clip.tEnd < Math.min(f.tEnd, clip.tStart + CLIP_MAX_S) - SLACK_S) problems.push('the proof clip does not cover the finding window');
    out.push(problems.length ? { id: f.id, status: 'rejected', note: problems.join('; ').slice(0, 600) } : { id: f.id, status: 'passed', note: 'artifacts intact, times inside the video, clip covers the window, wording describes the footage' });
  }
  return out;
}
