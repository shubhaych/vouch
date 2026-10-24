import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, worldOf, type Ctx } from './ctx';
import { agentLabel } from './sim';

// The worker's bookkeeping for video evidence and CREAO runs. Agents never
// write here: the worker validates their JSON and calls these reducers.

export const attachVideo = spacetimedb.reducer(
  { claimId: t.u64(), videoUrl: t.string(), frameUrls: t.array(t.string()), frameHashes: t.array(t.string()), checksJson: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    const c = ctx.db.claim.id.find(a.claimId);
    if (!c) throw new SenderError('no such claim');
    if (c.status !== 'awaiting_video' && c.status !== 'more_evidence') throw new SenderError(`claim is ${c.status}`);
    ctx.db.claim.id.update({ ...c, videoUrl: a.videoUrl, frameUrls: a.frameUrls, frameHashes: a.frameHashes, checksJson: a.checksJson, status: 'frames_ready' });
  },
);

export const setClaimStatus = spacetimedb.reducer({ claimId: t.u64(), status: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const c = ctx.db.claim.id.find(a.claimId);
  if (!c) throw new SenderError('no such claim');
  ctx.db.claim.id.update({ ...c, status: a.status });
});

export const recordRun = spacetimedb.reducer(
  { runId: t.string(), seat: t.string(), caseRef: t.string(), runUrl: t.string(), conversationId: t.string(), mode: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    const row = {
      runId: a.runId, seat: a.seat, caseRef: a.caseRef, status: 'running', runUrl: a.runUrl, conversationId: a.conversationId,
      mode: a.mode, stepsJson: JSON.stringify([{ step: 'run started', at: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) }]),
      startedAt: ctx.timestamp, finishedAt: undefined,
    };
    if (ctx.db.agentRun.runId.find(a.runId)) ctx.db.agentRun.runId.update(row);
    else ctx.db.agentRun.insert(row);
  },
);

/** Appends a progress step ("frames sent", "waiting", "result") so the org chart shows movement while a run takes minutes. */
export const runStep = spacetimedb.reducer({ runId: t.string(), step: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const r = ctx.db.agentRun.runId.find(a.runId);
  if (!r) throw new SenderError('no such run');
  const steps = JSON.parse(r.stepsJson || '[]') as unknown[];
  steps.push({ step: a.step.slice(0, 200), at: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) });
  ctx.db.agentRun.runId.update({ ...r, stepsJson: JSON.stringify(steps.slice(-20)) });
});

export const finishRun = spacetimedb.reducer({ runId: t.string(), status: t.string(), runUrl: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const r = ctx.db.agentRun.runId.find(a.runId);
  if (!r) throw new SenderError('no such run');
  ctx.db.agentRun.runId.update({ ...r, status: a.status, runUrl: a.runUrl || r.runUrl, finishedAt: ctx.timestamp });
});

export const recordEvidence = spacetimedb.reducer(
  { claimId: t.u64(), seat: t.string(), runId: t.string(), runUrl: t.string(), json: t.string(), provenance: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (!ctx.db.claim.id.find(a.claimId)) throw new SenderError('no such claim');
    JSON.parse(a.json); // refuse malformed evidence
    ctx.db.evidence.insert({ id: 0n, claimId: a.claimId, seat: a.seat, runId: a.runId, runUrl: a.runUrl, json: a.json, provenance: a.provenance, at: ctx.timestamp });
  },
);

export function openInvestigationImpl(ctx: Ctx, refundId: bigint) {
  requireRole(ctx, 'business', 'controller');
  const r = ctx.db.refund.id.find(refundId);
  if (!r) throw new SenderError('no such refund');
  for (const c of ctx.db.claim.refundId.filter(refundId)) return c; // already open
  const open = r.status === 'requested' || r.status === 'more_evidence';
  if (open) {
    // Take it off the fast path: from now on the investigators and a person decide.
    ctx.db.refund.id.update({ ...r, status: 'investigating', path: 'investigation', decideDay: 0, resolveDay: 0 });
  }
  const c = ctx.db.claim.insert({
    id: 0n, refundId, agentId: r.agentId, nonce: '', fingerCount: 0, videoUrl: '', frameUrls: [], frameHashes: [], checksJson: '{}',
    status: open ? 'frames_ready' : 'review_only', kind: 'simulated', createdAt: ctx.timestamp,
  });
  const w = worldOf(ctx);
  w.feed('claim', r.agentId, r.businessId, r.amount, c.id, `[Claim] C-${c.id}: a person opened ${agentLabel(r.agentId)}'s simulated refund R-${r.id} for investigation`);
  w.commit();
  return c;
}

/** A judge opens a simulated refund from the globe for a CREAO investigation (no video: simulated refunds have claim text and timing). */
export const openInvestigation = spacetimedb.reducer({ refundId: t.u64() }, (ctx, { refundId }) => {
  openInvestigationImpl(ctx, refundId);
});
