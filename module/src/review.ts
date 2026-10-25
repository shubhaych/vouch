import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, worldOf, type Ctx } from './ctx';
import { MATERIALITY_CENTS } from './desk';
import { DEFAULT_AUTO_APPROVE_CENTS } from './review-score';
import { STEP_KEYS } from './review-types';
import { agentLabel, applyCredit, businessLabel, dollars, refundLabel, settleRefund } from './sim';
import type { RefundRow } from './simdb';

// The video reviewer's bookkeeping. The worker runs the pipeline (ingest,
// lanes, three Droid sessions, scoring) and writes every step, artifact,
// finding, score and recommendation here through these reducers, so the phone
// tracker and the business report fill in live. Droid never writes rows itself:
// its MCP tools call the worker, which validates and calls these.
//
// Ids are chosen by the worker (job = claim × 100 + attempt, artifact and
// finding = job × 1000 + n) so an MCP tool can hand Droid the id of the row it
// just created without waiting for the subscription to catch up.

const FINDING_KINDS = ['supports', 'contradicts', 'neutral', 'integrity'];
const AUDIT = ['pending', 'passed', 'rejected'];
const TIERS = ['T1', 'T2', 'T3', 'T4', 'T5'];

function job(ctx: Ctx, jobId: bigint) {
  const j = ctx.db.analysisJob.id.find(jobId);
  if (!j) throw new SenderError('no such analysis job');
  return j;
}

export function startAnalysisImpl(ctx: Ctx, claimId: bigint, jobId: bigint, mode: string) {
  requireRole(ctx, 'worker');
  const c = ctx.db.claim.id.find(claimId);
  if (!c) throw new SenderError('no such claim');
  if (ctx.db.analysisJob.id.find(jobId)) throw new SenderError('job id already used');
  for (const old of ctx.db.analysisJob.claimId.filter(claimId)) {
    if (old.status === 'running') ctx.db.analysisJob.id.update({ ...old, status: 'failed', costNote: `${old.costNote} superseded by job ${jobId}`.trim(), finishedAt: ctx.timestamp });
  }
  ctx.db.analysisJob.insert({ id: jobId, claimId, status: 'running', mode, startedAt: ctx.timestamp, finishedAt: undefined, costNote: '', droidSessions: 0 });
  for (const key of STEP_KEYS) {
    ctx.db.analysisStep.insert({ id: 0n, jobId, key, status: key === 'ingest' ? 'running' : 'pending', startedAt: key === 'ingest' ? ctx.timestamp : undefined, finishedAt: undefined, summary: '', liveNote: '' });
  }
  if (c.status !== 'decided' && c.status !== 'review_only') ctx.db.claim.id.update({ ...c, status: 'investigating' });
}

export const startAnalysis = spacetimedb.reducer({ claimId: t.u64(), jobId: t.u64(), mode: t.string() }, (ctx, a) => {
  startAnalysisImpl(ctx, a.claimId, a.jobId, a.mode);
});

/** Upserts one step. An empty status keeps the current one, so a live note alone does not change state; liveNote always replaces. */
export function setStepImpl(ctx: Ctx, jobId: bigint, key: string, status: string, summary: string, liveNote: string) {
  requireRole(ctx, 'worker');
  job(ctx, jobId);
  if (!(STEP_KEYS as readonly string[]).includes(key)) throw new SenderError(`unknown step ${key}`);
  let row = [...ctx.db.analysisStep.jobId.filter(jobId)].find((s) => s.key === key);
  if (!row) row = ctx.db.analysisStep.insert({ id: 0n, jobId, key, status: 'pending', startedAt: undefined, finishedAt: undefined, summary: '', liveNote: '' });
  const next = status || row.status;
  if (status && !['pending', 'running', 'done', 'failed', 'skipped'].includes(status)) throw new SenderError('bad step status');
  const startedAt = next === 'running' && !row.startedAt ? ctx.timestamp : row.startedAt;
  const finishedAt = ['done', 'failed', 'skipped'].includes(next) ? ctx.timestamp : next === 'running' ? undefined : row.finishedAt;
  ctx.db.analysisStep.id.update({ ...row, status: next, startedAt, finishedAt, summary: summary ? summary.slice(0, 2000) : row.summary, liveNote: liveNote.slice(0, 600) });
}

export const setStep = spacetimedb.reducer({ jobId: t.u64(), key: t.string(), status: t.string(), summary: t.string(), liveNote: t.string() }, (ctx, a) => {
  setStepImpl(ctx, a.jobId, a.key, a.status, a.summary, a.liveNote);
});

export const addArtifact = spacetimedb.reducer(
  { jobId: t.u64(), id: t.u64(), kind: t.string(), path: t.string(), url: t.string(), tStart: t.f64(), tEnd: t.f64(), label: t.string(), sha256: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    job(ctx, a.jobId);
    if (!a.path || a.path.includes('..')) throw new SenderError('artifact path must be a relative path inside the case folder');
    if (!(a.tStart <= a.tEnd) || a.tStart < 0) throw new SenderError('artifact times must satisfy 0 <= tStart <= tEnd');
    const row = { id: a.id, jobId: a.jobId, kind: a.kind, path: a.path, url: a.url, tStart: a.tStart, tEnd: a.tEnd, label: a.label.slice(0, 300), sha256: a.sha256 };
    if (ctx.db.artifact.id.find(a.id)) ctx.db.artifact.id.update(row);
    else ctx.db.artifact.insert(row);
  },
);

export function addFindingImpl(ctx: Ctx, a: { jobId: bigint; id: bigint; kind: string; spokenClaimId: string; observation: string; tStart: number; tEnd: number; confidence: number; artifactIds: bigint[]; method: string }) {
  requireRole(ctx, 'worker');
  job(ctx, a.jobId);
  if (!FINDING_KINDS.includes(a.kind)) throw new SenderError('finding kind must be supports, contradicts, neutral or integrity');
  if (!(a.tStart <= a.tEnd) || a.tStart < 0) throw new SenderError('finding times must satisfy 0 <= tStart <= tEnd');
  if (!(a.confidence >= 0 && a.confidence <= 1)) throw new SenderError('confidence must be between 0 and 1');
  if (!a.observation.trim()) throw new SenderError('a finding needs an observation');
  // Every finding cites at least one artifact of its own job: the auditor rejects anything else, so refuse it here already.
  if (a.artifactIds.length === 0) throw new SenderError('a finding must cite at least one artifact (add_artifact first)');
  for (const id of a.artifactIds) {
    const art = ctx.db.artifact.id.find(id);
    if (!art || art.jobId !== a.jobId) throw new SenderError(`artifact ${id} does not belong to this job`);
  }
  if (ctx.db.finding.id.find(a.id)) throw new SenderError('finding id already used');
  ctx.db.finding.insert({
    id: a.id, jobId: a.jobId, kind: a.kind, spokenClaimId: a.spokenClaimId, observation: a.observation.slice(0, 1200), tStart: a.tStart, tEnd: a.tEnd,
    confidence: a.confidence, artifactIds: a.artifactIds, method: a.method.slice(0, 120), auditStatus: 'pending', auditNote: '',
  });
}

export const addFinding = spacetimedb.reducer(
  { jobId: t.u64(), id: t.u64(), kind: t.string(), spokenClaimId: t.string(), observation: t.string(), tStart: t.f64(), tEnd: t.f64(), confidence: t.f64(), artifactIds: t.array(t.u64()), method: t.string() },
  (ctx, a) => addFindingImpl(ctx, a),
);

export const auditFinding = spacetimedb.reducer({ findingId: t.u64(), status: t.string(), note: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const f = ctx.db.finding.id.find(a.findingId);
  if (!f) throw new SenderError('no such finding');
  if (!AUDIT.includes(a.status)) throw new SenderError('audit status must be pending, passed or rejected');
  ctx.db.finding.id.update({ ...f, auditStatus: a.status, auditNote: a.note.slice(0, 600) });
});

export const writeReport = spacetimedb.reducer(
  { claimId: t.u64(), jobId: t.u64(), json: t.string(), markdownPath: t.string(), proofReelUrl: t.string(), auditPassed: t.bool() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    job(ctx, a.jobId);
    JSON.parse(a.json); // refuse a malformed report
    for (const old of ctx.db.report.claimId.filter(a.claimId)) ctx.db.report.id.delete(old.id);
    ctx.db.report.insert({ id: 0n, claimId: a.claimId, jobId: a.jobId, json: a.json, markdownPath: a.markdownPath, proofReelUrl: a.proofReelUrl, auditPassed: a.auditPassed, at: ctx.timestamp });
  },
);

export const writeScore = spacetimedb.reducer(
  { claimId: t.u64(), jobId: t.u64(), eSupport: t.f64(), coverage: t.f64(), integrity: t.f64(), pLegit: t.f64(), anomaly: t.f64(), excessRefundRatio: t.f64(), featuresJson: t.string(), formulaVersion: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    job(ctx, a.jobId);
    JSON.parse(a.featuresJson);
    const row = { claimId: a.claimId, jobId: a.jobId, eSupport: a.eSupport, coverage: a.coverage, integrity: a.integrity, pLegit: a.pLegit, anomaly: a.anomaly, excessRefundRatio: a.excessRefundRatio, featuresJson: a.featuresJson, formulaVersion: a.formulaVersion };
    if (ctx.db.claimScore.claimId.find(a.claimId)) ctx.db.claimScore.claimId.update(row);
    else ctx.db.claimScore.insert(row);
  },
);

export function writeRecommendationImpl(ctx: Ctx, a: { claimId: bigint; jobId: bigint; tier: string; refundNow: number; refundOnReturn: number; returnRequired: boolean; reasonsJson: string; creaoReview: string; creaoRunId: string }) {
  requireRole(ctx, 'worker');
  job(ctx, a.jobId);
  if (!TIERS.includes(a.tier)) throw new SenderError('tier must be T1..T5');
  JSON.parse(a.reasonsJson);
  if (a.creaoReview) JSON.parse(a.creaoReview);
  const c = ctx.db.claim.id.find(a.claimId);
  const r = c ? ctx.db.refund.id.find(c.refundId) : undefined;
  if (r && a.refundNow + a.refundOnReturn > r.amount) throw new SenderError('a recommendation can never exceed the amount requested');
  const row = { claimId: a.claimId, jobId: a.jobId, tier: a.tier, refundNow: a.refundNow, refundOnReturn: a.refundOnReturn, returnRequired: a.returnRequired, reasonsJson: a.reasonsJson, creaoReview: a.creaoReview, creaoRunId: a.creaoRunId, autoDecided: false, at: ctx.timestamp };
  if (ctx.db.recommendation.claimId.find(a.claimId)) ctx.db.recommendation.claimId.update(row);
  else ctx.db.recommendation.insert(row);
}

export const writeRecommendation = spacetimedb.reducer(
  { claimId: t.u64(), jobId: t.u64(), tier: t.string(), refundNow: t.u32(), refundOnReturn: t.u32(), returnRequired: t.bool(), reasonsJson: t.string(), creaoReview: t.string(), creaoRunId: t.string() },
  (ctx, a) => writeRecommendationImpl(ctx, a),
);

export const finishAnalysis = spacetimedb.reducer({ jobId: t.u64(), status: t.string(), costNote: t.string(), droidSessions: t.u8() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const j = job(ctx, a.jobId);
  if (!['done', 'lanes_only', 'failed'].includes(a.status)) throw new SenderError('status must be done, lanes_only or failed');
  ctx.db.analysisJob.id.update({ ...j, status: a.status, costNote: a.costNote.slice(0, 600), droidSessions: a.droidSessions, finishedAt: ctx.timestamp });
});

/**
 * The only automatic decision in Vouch, and it can only pay: tier T1 or T2, the CREAO
 * Refund Reviewer agreed, the amount paid now is within the business's auto-approve
 * limit (and far below the controller's $500). Everything else waits for a person, and
 * nothing is ever declined automatically.
 */
export function autoDecideImpl(ctx: Ctx, refundId: bigint, amount: number, note: string) {
  requireRole(ctx, 'worker');
  const r = ctx.db.refund.id.find(refundId);
  if (!r || !['investigating', 'recommended'].includes(r.status)) throw new SenderError('this refund is not open for an automatic decision');
  const claim = [...ctx.db.claim.refundId.filter(refundId)].find((c) => c.kind !== 'simulated');
  const rec = claim ? ctx.db.recommendation.claimId.find(claim.id) : undefined;
  if (!claim || !rec) throw new SenderError('no recommendation for this refund');
  if (rec.autoDecided) throw new SenderError('already decided automatically');
  if (rec.tier !== 'T1' && rec.tier !== 'T2') throw new SenderError(`tier ${rec.tier} is never decided automatically`);
  const review = rec.creaoReview ? (JSON.parse(rec.creaoReview) as { agrees?: boolean }) : null;
  if (!review || review.agrees !== true) throw new SenderError('the CREAO Refund Reviewer has not agreed; a person decides');
  const business = ctx.db.business.id.find(r.businessId);
  const policy = business ? (JSON.parse(business.policy) as { autoApproveLimitCents?: number }) : {};
  const limit = Math.min(policy.autoApproveLimitCents ?? DEFAULT_AUTO_APPROVE_CENTS, MATERIALITY_CENTS);
  if (amount <= 0 || amount > rec.refundNow || amount > r.amount) throw new SenderError('amount must be positive and at most the recommended refund-now amount');
  if (amount > limit) throw new SenderError(`${dollars(amount)} is above the auto-approve limit ${dollars(limit)}; a person decides`);
  let d: ReturnType<typeof ctx.db.decision.insert> | undefined;
  for (const x of ctx.db.decision.refundId.filter(refundId)) if (x.status === 'proposed' && x.action === 'accept' && (!d || x.id > d.id)) d = x;
  if (!d) throw new SenderError('no accept proposal to decide on');
  const w = worldOf(ctx);
  try {
    settleRefund(w, r as RefundRow, 'accepted', amount, 'evidence');
  } catch (e) {
    throw new SenderError(e instanceof Error ? e.message : String(e));
  }
  ctx.db.decision.id.update({ ...d, status: 'decided', finalAction: 'accept', finalAmount: amount, decidedBy: ctx.sender, note: note.slice(0, 400) });
  for (const c of ctx.db.claim.refundId.filter(refundId)) ctx.db.claim.id.update({ ...c, status: c.status === 'review_only' ? c.status : 'decided' });
  ctx.db.recommendation.claimId.update({ ...rec, autoDecided: true });
  w.feed('decision', r.agentId, r.businessId, amount, r.id, `[Decision] ${businessLabel(r.businessId)} auto-approved ${refundLabel(r.id)} ${dollars(amount)} for ${agentLabel(r.agentId)} (tier ${rec.tier}, within the auto-approve limit)`);
  w.commit();
}

export const autoDecide = spacetimedb.reducer({ refundId: t.u64(), amount: t.u32(), note: t.string() }, (ctx, a) => autoDecideImpl(ctx, a.refundId, a.amount, a.note));

/** What the CREAO Score Reviewer may move a score by after one claim: code holds these bounds, the agent picks inside them. */
export const SCORE_BOUNDS = { gain: [1, 15], loss: [-60, -1] } as const;

/**
 * The shopper's score change for one decided real claim, judged by the CREAO Score Reviewer (or a
 * labelled rule when that agent is not connected). Once per refund, only after the decision, bounded.
 */
export function applyScoreReviewImpl(ctx: Ctx, a: { refundId: bigint; direction: string; delta: number; reason: string; runId: string; provenance: string }) {
  requireRole(ctx, 'worker');
  const r = ctx.db.refund.id.find(a.refundId);
  if (!r) throw new SenderError('no such refund');
  // A CREAO verdict (an open accept/decline proposal) is enough: the worker only asks when the review was
  // not put on hold (extra clip, a person, offline). A later merchant decision does not apply it twice.
  let verdict = '';
  if (r.status === 'recommended') {
    let open: { id: bigint; action: string } | undefined;
    for (const d of ctx.db.decision.refundId.filter(r.id)) if ((d.status === 'proposed' || d.status === 'sent_to_controller') && (!open || d.id > open.id)) open = d;
    if (open && (open.action === 'accept' || open.action === 'decline')) verdict = `creao_${open.action}`;
  }
  if (r.status !== 'accepted' && r.status !== 'declined' && !verdict) throw new SenderError(`refund is ${r.status}; the score is reviewed after the decision or a CREAO verdict`);
  if (ctx.db.scoreReview.refundId.find(a.refundId)) throw new SenderError('this refund already has a score review');
  if (!['gain', 'loss', 'same'].includes(a.direction)) throw new SenderError('direction must be gain, loss or same');
  const [lo, hi] = a.direction === 'same' ? [0, 0] : SCORE_BOUNDS[a.direction as 'gain' | 'loss'];
  const delta = Math.max(lo, Math.min(hi, Math.round(a.delta)));
  const w = worldOf(ctx);
  const before = w.agent(r.agentId).score;
  if (delta !== 0) applyCredit(w, r.agentId, `score_review_${a.direction}`, delta, 'refund', r.id, false);
  const after = w.agent(r.agentId).score;
  w.feed('score_review', r.agentId, r.businessId, 0, r.id, `[Score] ${agentLabel(r.agentId)} ${before} → ${after} after ${refundLabel(r.id)}: ${a.reason.slice(0, 120)}`);
  w.commit();
  ctx.db.scoreReview.insert({
    refundId: r.id, agentId: r.agentId, direction: a.direction, delta: after - before, before, after, reason: a.reason.slice(0, 300),
    decision: verdict || r.status, runId: a.runId, provenance: a.provenance, at: ctx.timestamp,
  });
}

export const applyScoreReview = spacetimedb.reducer(
  { refundId: t.u64(), direction: t.string(), delta: t.i32(), reason: t.string(), runId: t.string(), provenance: t.string() },
  (ctx, a) => applyScoreReviewImpl(ctx, a),
);
