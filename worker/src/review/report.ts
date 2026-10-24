// The business report: assembled from the case state once everything has run,
// validated with zod so a half-written report never reaches the table, and
// written as report.json and report.md inside the case folder. The web reads
// the JSON from the report row; the markdown is for people and for Droid logs.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { FORMULA_VERSION, TIER_LABEL, type SpokenClaim } from '@vouch/module/review-score';
import type { DroidSessionSummary, Report, ReportArtifact, ReportFinding, TimelineEntry } from '@vouch/module/review-types';
import { label } from '../history';
import type { IngestResult } from './ingest';
import type { IntegrityDoc } from './lanes';
import { hms } from './paths';
import type { ScoreResult } from './score-claim';
import type { CaseState, FindingRec } from './state';

const Finding = z.object({
  id: z.number().int(), claimId: z.string().optional(), kind: z.enum(['supports', 'contradicts', 'neutral', 'integrity']), observation: z.string().min(1),
  tStart: z.number().min(0), tEnd: z.number().min(0), confidence: z.number().min(0).max(1), method: z.string(), artifactIds: z.array(z.number().int()).min(1),
  auditStatus: z.enum(['pending', 'passed', 'rejected']), auditNote: z.string().optional(),
});
const Reason = z.object({ text: z.string().min(1), cites: z.string() });
const Session = z.object({
  name: z.string(), plan: z.string(), commands: z.array(z.object({ cmd: z.string(), exitCode: z.number().nullable(), ms: z.number() })), filesWritten: z.array(z.string()),
  mode: z.enum(['live', 'skipped', 'failed', 'replay']), note: z.string().optional(),
});

/** Every report the worker writes passes this; the web can trust the shape. */
export const ReportSchema = z.object({
  claimId: z.string(), retailerId: z.string(), generatedAt: z.string(), formulaVersion: z.string(),
  video: z.object({ durationS: z.number(), resolution: z.string(), audio: z.boolean(), sha256: z.string(), proofReelUrl: z.string() }),
  claimSummary: z.object({ reasonCode: z.string(), reasonText: z.string(), claimsFrom: z.enum(['transcript', 'written']), spokenClaims: z.array(z.object({ id: z.string(), text: z.string(), kind: z.enum(['defect', 'condition', 'functional', 'context']), tSaid: z.number() })) }),
  findings: z.array(Finding), rejectedFindings: z.array(Finding),
  artifacts: z.array(z.object({ id: z.number().int(), kind: z.string(), path: z.string(), url: z.string(), tStart: z.number(), tEnd: z.number(), label: z.string(), sha256: z.string() })),
  integrity: z.object({ score: z.number().min(0).max(1), flags: z.array(z.object({ kind: z.string(), confidence: z.number(), tStart: z.number().optional(), tEnd: z.number().optional(), artifactIds: z.array(z.number()), note: z.string().optional() })) }),
  timeline: z.array(z.object({ t: z.number(), kind: z.enum(['claim', 'supports', 'contradicts', 'integrity', 'challenge']), label: z.string(), findingId: z.number().optional() })),
  history: z.object({
    tenureDays: z.number(), orders: z.number(), refunds365: z.number(), smoothedRefundRate: z.number(), categoryBaseline: z.number(), excessRatio: z.number(),
    anomaly: z.object({ amountZ: z.number(), frequencySurprise: z.number(), windowEdge: z.boolean(), score: z.number(), unusual: z.boolean(), thin: z.boolean() }),
    verifiedIdentity: z.enum(['verified', 'unverified', 'unknown']),
  }),
  score: z.object({ eSupport: z.number(), coverage: z.number(), integrity: z.number(), pLegit: z.number().min(0).max(1), logit: z.number(), components: z.record(z.string(), z.number()) }),
  recommendation: z.object({
    tier: z.enum(['T1', 'T2', 'T3', 'T4', 'T5']), refundNow: z.number().int().min(0), refundOnReturn: z.number().int().min(0), returnRequired: z.boolean(), replacementOffered: z.boolean(),
    evidenceRequested: z.array(z.string()).optional(), reasons: z.array(Reason).min(1), creditPreview: z.object({ base: z.string(), delta: z.number() }).nullable(),
  }),
  creaoReview: z.object({ agrees: z.boolean(), businessSummary: z.string(), concerns: z.array(z.string()), customerMessage: z.string(), runId: z.string(), provenance: z.enum(['live', 'fixture', 'offline']) }).optional(),
  method: z.object({ droidSessions: z.array(Session), toolsUsed: z.array(z.string()), ingestLog: z.array(z.string()), lanesOnly: z.boolean() }),
  limits: z.array(z.string()),
}) satisfies z.ZodType<Report>;

export interface AssembleInput {
  claimId: bigint;
  businessId: number;
  state: CaseState;
  ing: IngestResult;
  claims: SpokenClaim[];
  reasonCode: string;
  reasonText: string;
  integrity: IntegrityDoc;
  score: ScoreResult;
  sessions: DroidSessionSummary[];
  lanesOnly: boolean;
  limits: string[];
  reel: string | null;
  transcribed: boolean;
  creaoReview?: Report['creaoReview'];
}

const toFinding = (f: FindingRec): ReportFinding => ({
  id: Number(f.id), ...(f.kind === 'integrity' ? {} : { claimId: f.spokenClaimId }), kind: f.kind as ReportFinding['kind'], observation: f.observation,
  tStart: f.tStart, tEnd: f.tEnd, confidence: f.confidence, method: f.method, artifactIds: f.artifactIds.map(Number),
  auditStatus: f.auditStatus as ReportFinding['auditStatus'], ...(f.auditNote ? { auditNote: f.auditNote } : {}),
});

function timeline(claims: SpokenClaim[], findings: FindingRec[], transcribed: boolean): TimelineEntry[] {
  // Written-reason claims have no real moment (tSaid is a search hint), so they stay off the timeline.
  const out: TimelineEntry[] = transcribed ? claims.map((c) => ({ t: c.tSaid, kind: 'claim' as const, label: `${c.id}: ${c.text}` })) : [];
  for (const f of findings) {
    if (f.auditStatus === 'rejected' || f.kind === 'neutral') continue;
    const kind: TimelineEntry['kind'] = f.kind === 'integrity' ? (f.spokenClaimId.startsWith('challenge:') ? 'challenge' : 'integrity') : f.kind === 'contradicts' ? 'contradicts' : 'supports';
    out.push({ t: f.tStart, kind, label: `${f.spokenClaimId} ${f.observation.slice(0, 90)}`, findingId: Number(f.id) });
  }
  return out.sort((a, b) => a.t - b.t);
}

function toolsUsed(findings: FindingRec[], sessions: DroidSessionSummary[], transcribed: boolean): string[] {
  const tools = new Set<string>(['ffmpeg', 'ffprobe']);
  if (transcribed) tools.add('faster-whisper');
  for (const f of findings) if (f.method) tools.add(f.method.split(/[,;]/)[0]!.trim());
  for (const s of sessions) for (const c of s.commands) {
    const probe = c.cmd.match(/tools\/probes\/(\w+)\.py/);
    if (probe) tools.add(`probe:${probe[1]}`);
    else if (/work\/\S+\.(py|mjs|js)/.test(c.cmd)) tools.add('custom probe (Droid-written)');
  }
  return [...tools].sort();
}

export function assembleReport(i: AssembleInput): Report {
  const all = [...i.state.findings.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const kept = all.filter((f) => f.auditStatus !== 'rejected');
  const rejected = all.filter((f) => f.auditStatus === 'rejected');
  const s = i.score;
  const artifacts: ReportArtifact[] = [...i.state.artifacts.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({ id: Number(a.id), kind: a.kind, path: a.path, url: a.url, tStart: a.tStart, tEnd: a.tEnd, label: a.label, sha256: a.sha256 }));
  const report: Report = {
    claimId: label.claim(i.claimId),
    retailerId: label.business(i.businessId),
    generatedAt: new Date().toISOString(),
    formulaVersion: FORMULA_VERSION,
    video: { durationS: i.ing.meta.durationS, resolution: `${i.ing.meta.width}×${i.ing.meta.height}`, audio: i.ing.meta.hasAudio, sha256: i.ing.sha256, proofReelUrl: i.reel ? i.state.url(i.reel) : '' },
    claimSummary: { reasonCode: i.reasonCode, reasonText: i.reasonText, claimsFrom: i.transcribed ? 'transcript' : 'written', spokenClaims: i.claims },
    findings: kept.map(toFinding),
    rejectedFindings: rejected.map(toFinding),
    artifacts,
    integrity: { score: s.integrity, flags: s.flags.map((f) => ({ kind: f.kind, confidence: f.confidence, ...(f.tStart !== undefined ? { tStart: f.tStart } : {}), ...(f.tEnd !== undefined ? { tEnd: f.tEnd } : {}), artifactIds: f.artifactIds ?? [], ...(f.note ? { note: f.note } : {}) })) },
    timeline: timeline(i.claims, all, i.transcribed),
    history: {
      tenureDays: s.historyInput.tenureDays, orders: s.historyInput.orders, refunds365: s.historyInput.refunds365, smoothedRefundRate: s.history.smoothedRefundRate,
      categoryBaseline: s.historyInput.categoryBaseline, excessRatio: s.history.excessRatio, anomaly: s.history.anomaly, verifiedIdentity: s.historyInput.verifiedIdentity,
    },
    score: { eSupport: s.support.eSupport, coverage: s.support.coverage, integrity: s.integrity, pLegit: s.legit.pLegit, logit: s.legit.logit, components: s.legit.components },
    recommendation: {
      tier: s.tier.tier, refundNow: s.tier.refundNowCents, refundOnReturn: s.tier.refundOnReturnCents, returnRequired: s.tier.returnRequired, replacementOffered: false,
      ...(s.tier.evidenceRequested ? { evidenceRequested: s.tier.evidenceRequested } : {}), reasons: s.tier.reasons, creditPreview: s.creditPreview,
    },
    method: {
      droidSessions: i.sessions, toolsUsed: toolsUsed(kept, i.sessions, i.transcribed),
      ingestLog: i.ing.log.slice(0, 60).map((l) => `[exit ${l.exitCode}, ${l.ms} ms]${l.note ? ` ${l.note}:` : ''} ${l.cmd.slice(0, 220)}`),
      lanesOnly: i.lanesOnly,
    },
    limits: [...new Set(i.limits)],
    ...(i.creaoReview ? { creaoReview: i.creaoReview } : {}),
  };
  return ReportSchema.parse(report);
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** report.md: the same report for people reading the case folder (links are relative to it). */
export function reportMarkdown(r: Report): string {
  const art = new Map(r.artifacts.map((a) => [a.id, a]));
  const fLine = (f: Report['findings'][number]) => {
    const files = f.artifactIds.map((id) => art.get(id)).filter((a): a is ReportArtifact => !!a).map((a) => `[${a.kind}](${a.path})`).join(' ');
    return `| ${f.claimId ?? '—'} | ${f.kind} | ${hms(f.tStart)}–${hms(f.tEnd)} | ${pct(f.confidence)} | ${f.method} | ${f.observation.replace(/\|/g, '/')} | ${files} |`;
  };
  const lines = [
    `# Report ${r.claimId} (${r.retailerId})`, '',
    `Generated ${r.generatedAt}; formula ${r.formulaVersion}. ${r.method.lanesOnly ? '**Automated checks only (Droid did not run).**' : ''}`, '',
    `## Recommendation: ${r.recommendation.tier} — ${TIER_LABEL[r.recommendation.tier]}`,
    `- Refund now ${money(r.recommendation.refundNow)}; on return ${money(r.recommendation.refundOnReturn)}; return required: ${r.recommendation.returnRequired ? 'yes' : 'no'}`,
    ...r.recommendation.reasons.map((x) => `- ${x.text} _(${x.cites})_`),
    ...(r.recommendation.evidenceRequested?.length ? ['- Evidence requested:', ...r.recommendation.evidenceRequested.map((e) => `  - ${e}`)] : []),
    ...(r.recommendation.creditPreview ? [`- Credit preview: ${r.recommendation.creditPreview.delta >= 0 ? '+' : ''}${r.recommendation.creditPreview.delta} (${r.recommendation.creditPreview.base})`] : []),
    '',
    `## Score: P(legit) ${pct(r.score.pLegit)}`,
    `- Evidence support E ${r.score.eSupport.toFixed(3)}, coverage C ${r.score.coverage.toFixed(3)}, integrity I ${r.score.integrity.toFixed(3)}, logit ${r.score.logit.toFixed(3)}`,
    `- Components: ${Object.entries(r.score.components).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(3)}`).join(', ')}`,
    `- History: ${r.history.orders} orders over ${r.history.tenureDays} days, ${r.history.refunds365} refunds in a year (smoothed rate ${pct(r.history.smoothedRefundRate)} vs category ${pct(r.history.categoryBaseline)}, ratio ${r.history.excessRatio.toFixed(2)}); anomaly ${r.history.anomaly.score.toFixed(2)}${r.history.anomaly.thin ? ' (thin history)' : ''}; identity ${r.history.verifiedIdentity}`,
    '',
    r.claimSummary.claimsFrom === 'transcript' ? '## Spoken claims' : '## Claims (from the written reason; nothing was transcribed)',
    ...r.claimSummary.spokenClaims.map((c) => `- **${c.id}** (${c.kind}${r.claimSummary.claimsFrom === 'transcript' ? `, ${hms(c.tSaid)}` : ''}): ${c.text}`),
    `- Written reason (${r.claimSummary.reasonCode}): ${r.claimSummary.reasonText}`,
    '',
    '## Findings (passed the audit)',
    '| claim | kind | window | conf | method | observation | artifacts |', '|---|---|---|---|---|---|---|',
    ...(r.findings.length ? r.findings.map(fLine) : ['| — | — | — | — | — | no findings | — |']),
    ...(r.rejectedFindings.length ? ['', '## Rejected by the audit', ...r.rejectedFindings.map((f) => `- ${f.claimId ?? 'integrity'} ${f.kind} ${hms(f.tStart)}–${hms(f.tEnd)}: ${f.observation.slice(0, 160)} — **${f.auditNote ?? 'rejected'}**`)] : []),
    '',
    `## Integrity ${pct(r.integrity.score)}`,
    ...(r.integrity.flags.length ? r.integrity.flags.map((f) => `- ${f.kind} (${pct(f.confidence)})${f.note ? `: ${f.note}` : ''}`) : ['- Nothing flagged. Internally consistent footage is not proof of authenticity.']),
    '',
    '## Timeline',
    ...r.timeline.map((t) => `- ${hms(t.t)} ${t.kind}: ${t.label}`),
    '',
    `## Proof`, r.video.proofReelUrl ? `- Reel: proof/reel.mp4 (${r.video.durationS.toFixed(1)} s source, ${r.video.resolution}, ${r.video.audio ? 'with audio' : 'no audio'})` : '- No reel.',
    ...r.artifacts.filter((a) => a.kind === 'clip').map((a) => `- ${a.path}: ${a.label}`),
    '',
    '## How this was investigated',
    ...(r.method.droidSessions.length ? r.method.droidSessions.flatMap((s) => [
      `### ${s.name} (${s.mode}${s.note ? `: ${s.note}` : ''})`,
      ...(s.plan ? ['Plan:', ...s.plan.split('\n').map((l) => `> ${l}`)] : []),
      ...(s.commands.length ? ['Commands:', ...s.commands.map((c) => `- \`${c.cmd}\` → exit ${c.exitCode ?? '?'} in ${c.ms} ms`)] : ['No commands were run.']),
      ...(s.filesWritten.length ? [`Files written: ${s.filesWritten.join(', ')}`] : []),
    ]) : ['No Droid session ran (automated checks only).']),
    `Tools used: ${r.method.toolsUsed.join(', ')}. Full transcript of every Droid session: droid.log. Ingest: ingest.log.`,
    '',
    '## Limits',
    ...(r.limits.length ? r.limits.map((l) => `- ${l}`) : ['- None recorded.']),
    '',
    '_Findings describe the footage, never the person. Fictional retailer; simulated shoppers._',
  ];
  return lines.join('\n') + '\n';
}

export function writeReportFiles(dir: string, report: Report): { json: string; md: string } {
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(dir, 'report.json'), json);
  writeFileSync(resolve(dir, 'report.md'), reportMarkdown(report));
  return { json, md: 'report.md' };
}
