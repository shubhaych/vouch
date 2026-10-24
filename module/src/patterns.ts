import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { nextCounter, requireRole, worldOf, type Ctx } from './ctx';
import { enqueueLabJob } from './lab';
import { applyCredit, agentLabel, patternLabel } from './sim';
import { CREDIT } from './score';

// Detector output and the Pattern Analyst's verdict. Only a confirmed
// pattern changes anyone's credit, and only for agents the analyst calls core.

const PatternEventIn = t.object('PatternEventIn', { table: t.string(), id: t.u64(), day: t.u32(), why: t.string() });

export function flagPatternImpl(
  ctx: Ctx,
  a: {
    kind: string; detectorId: string; detectorVersion: number; firstDay: number; lastDay: number; agentIds: number[]; businessIds: number[];
    featuresJson: string; events: { table: string; id: bigint; day: number; why: string }[];
  },
) {
  requireRole(ctx, 'worker');
  JSON.parse(a.featuresJson);
  const agents = [...new Set(a.agentIds)].sort((x, y) => x - y);
  const signature = `${a.detectorId}@${a.detectorVersion}:${agents.join(',')}`;
  if (ctx.db.fraudPattern.signature.find(signature)) return null; // already flagged by this detector version
  const id = Number(nextCounter(ctx, 'pattern'));
  const run = ctx.db.simRun.id.find(1);
  const row = ctx.db.fraudPattern.insert({
    id, kind: a.kind, status: 'detected', detectorId: a.detectorId, detectorVersion: a.detectorVersion, firstDay: a.firstDay, lastDay: a.lastDay,
    agentIds: agents, businessIds: [...new Set(a.businessIds)].sort((x, y) => x - y), features: a.featuresJson, runId: '', runUrl: '', narrative: '',
    rolesJson: '', signature, flaggedDay: run?.day ?? 0, reviewedDay: 0,
  });
  for (const e of a.events) ctx.db.patternEvent.insert({ id: 0n, patternId: id, eventTable: e.table, eventId: e.id, day: e.day, why: e.why.slice(0, 300) });
  const w = worldOf(ctx);
  for (const agentId of agents) {
    const ag = ctx.db.agent.id.find(agentId);
    if (ag) w.stat(ag.region).fraudFlags += 1;
  }
  w.feed('pattern', agents[0] ?? 0, a.businessIds[0] ?? 0, 0, BigInt(id), `[Pattern] ${patternLabel(id)} flagged by ${a.detectorId} v${a.detectorVersion}: ${agents.length} agents (${a.kind.replaceAll('_', ' ')})`);
  w.commit();
  return row;
}

export const flagPattern = spacetimedb.reducer(
  {
    kind: t.string(), detectorId: t.string(), detectorVersion: t.u32(), firstDay: t.u32(), lastDay: t.u32(), agentIds: t.array(t.u32()),
    businessIds: t.array(t.u16()), featuresJson: t.string(), events: t.array(PatternEventIn),
  },
  (ctx, a) => {
    flagPatternImpl(ctx, a);
  },
);

/** reviewing (Pattern Analyst running) or awaiting_review (over the 12-review budget). */
export const setPatternStatus = spacetimedb.reducer({ patternId: t.u32(), status: t.string(), runId: t.string(), runUrl: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const p = ctx.db.fraudPattern.id.find(a.patternId);
  if (!p) throw new Error('no such pattern');
  if (!['reviewing', 'awaiting_review', 'detected'].includes(a.status)) throw new Error('bad status');
  ctx.db.fraudPattern.id.update({ ...p, status: a.status, runId: a.runId || p.runId, runUrl: a.runUrl || p.runUrl });
});

interface Role { id: string; role: string }

export function confirmPatternImpl(ctx: Ctx, a: { patternId: number; verdict: string; runId: string; runUrl: string; narrative: string; rolesJson: string }) {
  requireRole(ctx, 'worker');
  const p = ctx.db.fraudPattern.id.find(a.patternId);
  if (!p) throw new Error('no such pattern');
  if (p.status === 'confirmed' || p.status === 'dismissed') throw new Error(`pattern already ${p.status}`);
  const status = a.verdict === 'confirm' ? 'confirmed' : a.verdict === 'dismiss' ? 'dismissed' : a.verdict === 'needs_review' ? 'needs_review' : null;
  if (!status) throw new Error('verdict must be confirm, dismiss or needs_review');
  const roles = (JSON.parse(a.rolesJson || '[]') as Role[]).filter((r) => r && typeof r.id === 'string');
  const run = ctx.db.simRun.id.find(1);
  ctx.db.fraudPattern.id.update({ ...p, status, runId: a.runId, runUrl: a.runUrl, narrative: a.narrative.slice(0, 4_000), rolesJson: JSON.stringify(roles), reviewedDay: run?.day ?? 0 });
  const w = worldOf(ctx);
  if (status === 'confirmed') {
    // Only core agents pay; an agent the analyst did not name as core is never penalised.
    const core = new Set(roles.filter((r) => r.role === 'core').map((r) => r.id));
    for (const agentId of p.agentIds) {
      if (core.has(agentLabel(agentId))) applyCredit(w, agentId, CREDIT.fraudConfirmed.kind, CREDIT.fraudConfirmed.delta, 'fraud_pattern', BigInt(p.id));
    }
  }
  w.feed('pattern', p.agentIds[0] ?? 0, 0, 0, BigInt(p.id), `[Pattern] ${patternLabel(p.id)} ${status.replace('_', ' ')} by the Pattern Analyst`);
  w.commit();

  // Event trigger: a dismissal means the detector flagged agents it should not have.
  if (status === 'dismissed') {
    enqueueLabJob(ctx, 'event', `Detector ${p.detectorId} v${p.detectorVersion} flagged agents in ${patternLabel(p.id)} that the Pattern Analyst dismissed. Reduce false positives without losing recall.`, p.detectorId);
  }
  // Another-agent trigger: two needs_review verdicts for the same detector version.
  if (status === 'needs_review') {
    let n = 0;
    for (const q of ctx.db.fraudPattern.iter()) if (q.detectorId === p.detectorId && q.detectorVersion === p.detectorVersion && q.status === 'needs_review') n++;
    if (n >= 2) {
      enqueueLabJob(ctx, 'agent', `The Pattern Analyst could not decide on two patterns from ${p.detectorId} v${p.detectorVersion}. Make its features clearer.`, p.detectorId);
    }
  }
}

export const confirmPattern = spacetimedb.reducer(
  { patternId: t.u32(), verdict: t.string(), runId: t.string(), runUrl: t.string(), narrative: t.string(), rolesJson: t.string() },
  (ctx, a) => confirmPatternImpl(ctx, a),
);
