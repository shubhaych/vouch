import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { controlOn, nextCounter, requireRole, type Ctx } from './ctx';

// The Droid Detector Lab queue. Four triggers enqueue jobs (event, schedule,
// user action, another agent); the worker runs one at a time. Jobs cost
// credits, so the queue is capped per simulation run and deduplicated, and
// nothing here starts a job by itself.

export const LAB_CAP_PER_RUN = 6;

/** The only goals a person may pick on /lab: no free text, so it stays safe and cheap. */
export const PRESET_GOALS: { goal: string; detectorId: string }[] = [
  { goal: 'Reduce honest agents flagged by the coordinated-claims detector without losing recall.', detectorId: 'coordinated' },
  { goal: 'Raise recall of the false-defect detector on opportunist agents without flagging more honest agents.', detectorId: 'false_defect' },
  { goal: 'Make the refund-frequency detector robust to agents with few purchases.', detectorId: 'refund_frequency' },
  { goal: 'Make the coordinated-claims detector catch rings that spread claims over three days.', detectorId: 'coordinated' },
  { goal: 'Explain the false-defect detector features more clearly for the Pattern Analyst.', detectorId: 'false_defect' },
];

/**
 * The jobs of the current simulation run: those created since the last (re)seed.
 * demo-reset reseeds with the same seed, so the seed alone cannot tell runs apart.
 */
function runJobs(ctx: Ctx) {
  const first = ctx.db.counter.key.find('lab_run_first_job')?.value ?? 0n;
  return [...ctx.db.labJob.iter()].filter((j) => BigInt(j.id) >= first);
}

/** seedWorld calls this: the next job opens a new run's budget. */
export function startLabRun(ctx: Ctx) {
  const next = (ctx.db.counter.key.find('lab_job')?.value ?? 0n) + 1n;
  const row = ctx.db.counter.key.find('lab_run_first_job');
  if (row) ctx.db.counter.key.update({ key: 'lab_run_first_job', value: next });
  else ctx.db.counter.insert({ key: 'lab_run_first_job', value: next });
}

/** Returns the new job id, or null when capped, duplicated or the lab is off. Never throws: it runs inside the tick. */
export function enqueueLabJob(ctx: Ctx, trigger: string, goal: string, detectorId: string): number | null {
  if (!controlOn(ctx, 'lab_enabled')) return null;
  const seed = ctx.db.simRun.id.find(1)?.seed ?? 0n;
  for (const j of ctx.db.labJob.iter()) {
    if ((j.status === 'queued' || j.status === 'running') && j.detectorId === detectorId && j.trigger === trigger) return null;
  }
  // Every job counts, including ones that ran without Droid, and the schedule gets one
  // job per run, so drift reviews cannot use up the budget the demo's triggers need (QA-005).
  const jobs = runJobs(ctx);
  if (jobs.length >= LAB_CAP_PER_RUN) return null;
  if (trigger === 'schedule' && jobs.some((j) => j.trigger === 'schedule')) return null;
  const id = Number(nextCounter(ctx, 'lab_job'));
  ctx.db.labJob.insert({
    id, trigger, goal, detectorId, status: 'queued', seed, mode: 'live', candidateDir: '', summary: '', scoresJson: '',
    createdAt: ctx.timestamp, finishedAt: undefined,
  });
  return id;
}

/** User trigger: anyone may ask, one preset at a time. */
export const enqueueLab = spacetimedb.reducer({ preset: t.u8() }, (ctx, { preset }) => {
  const p = PRESET_GOALS[preset];
  if (!p) throw new SenderError('pick one of the five preset goals');
  for (const j of ctx.db.labJob.iter()) {
    if (j.trigger === 'user' && (j.status === 'queued' || j.status === 'running')) throw new SenderError('a user job is already queued or running');
  }
  if (enqueueLabJob(ctx, 'user', p.goal, p.detectorId) === null) throw new SenderError('the lab is off or this run already used its 6 jobs');
});

/** Event and agent triggers come from the worker (an override, a dismissal, two needs_review verdicts). */
export const enqueueLabTrigger = spacetimedb.reducer(
  { trigger: t.string(), goal: t.string(), detectorId: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (!['event', 'agent', 'schedule'].includes(a.trigger)) throw new SenderError('trigger must be event, agent or schedule');
    enqueueLabJob(ctx, a.trigger, a.goal, a.detectorId);
  },
);

export const startLabJob = spacetimedb.reducer({ jobId: t.u32(), mode: t.string() }, (ctx, { jobId, mode }) => {
  requireRole(ctx, 'worker');
  const j = ctx.db.labJob.id.find(jobId);
  if (!j || j.status !== 'queued') throw new SenderError('no queued job');
  ctx.db.labJob.id.update({ ...j, status: 'running', mode });
});

/** Every message Droid streams becomes a row, so /lab fills in live. */
export const appendLabEvent = spacetimedb.reducer(
  { jobId: t.u32(), kind: t.string(), text: t.string(), json: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (!ctx.db.labJob.id.find(a.jobId)) throw new SenderError('no such job');
    ctx.db.labEvent.insert({ id: 0n, jobId: a.jobId, kind: a.kind, text: a.text.slice(0, 4_000), json: a.json.slice(0, 60_000), at: ctx.timestamp });
  },
);

export const finishLabJob = spacetimedb.reducer(
  { jobId: t.u32(), status: t.string(), summary: t.string(), scoresJson: t.string(), candidateDir: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    const j = ctx.db.labJob.id.find(a.jobId);
    if (!j) throw new SenderError('no such job');
    if (!['succeeded', 'failed', 'cancelled'].includes(a.status)) throw new SenderError('bad status');
    ctx.db.labJob.id.update({ ...j, status: a.status, summary: a.summary, scoresJson: a.scoresJson, candidateDir: a.candidateDir, finishedAt: ctx.timestamp });
  },
);

/** Promote or reject is a person's call: the controller only. The worker does the file copy. */
export const reviewCandidate = spacetimedb.reducer({ jobId: t.u32(), promote: t.bool() }, (ctx, { jobId, promote }) => {
  requireRole(ctx, 'controller');
  const j = ctx.db.labJob.id.find(jobId);
  if (!j || j.status !== 'succeeded') throw new SenderError('only a finished job with a candidate can be reviewed');
  ctx.db.labJob.id.update({ ...j, status: promote ? 'promote_requested' : 'rejected' });
  ctx.db.labEvent.insert({ id: 0n, jobId, kind: 'verdict', text: promote ? 'Controller asked to promote the candidate.' : 'Controller rejected the candidate.', json: '', at: ctx.timestamp });
});

export const markPromoted = spacetimedb.reducer({ jobId: t.u32(), version: t.u32(), ok: t.bool(), note: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const j = ctx.db.labJob.id.find(a.jobId);
  if (!j || j.status !== 'promote_requested') throw new SenderError('promotion was not requested');
  ctx.db.labJob.id.update({ ...j, status: a.ok ? 'promoted' : 'failed', summary: a.ok ? j.summary : `${j.summary}\nPromotion failed: ${a.note}` });
  ctx.db.labEvent.insert({
    id: 0n, jobId: a.jobId, kind: a.ok ? 'promoted' : 'log', text: a.ok ? `Promoted ${j.detectorId} to v${a.version}. ${a.note}` : a.note,
    json: JSON.stringify({ detectorId: j.detectorId, version: a.version }), at: ctx.timestamp,
  });
});
