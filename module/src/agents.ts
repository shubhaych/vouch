import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole } from './desk';

// Hub reducers behind worker/creao.ts. The worker (Desk Lead, role "router")
// is the only writer; agents never touch the database directly.

export const recordRun = spacetimedb.reducer(
  { runId: t.string(), seat: t.string(), caseRef: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'router');
    ctx.db.agentRun.insert({ runId: a.runId, seat: a.seat, caseRef: a.caseRef, status: 'started', resultHash: '', shareUrl: '', startedAt: ctx.timestamp, finishedAt: undefined });
  });

export const finishRun = spacetimedb.reducer(
  { runId: t.string(), status: t.string(), resultHash: t.string(), shareUrl: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'router');
    const run = ctx.db.agentRun.runId.find(a.runId);
    if (!run) throw new Error('unknown run');
    ctx.db.agentRun.runId.update({ ...run, status: a.status, resultHash: a.resultHash, shareUrl: a.shareUrl, finishedAt: ctx.timestamp });
  });

/** Returns nothing; the worker calls it first and reads `webhook_delivery` to see whether it was a repeat. */
export const markDelivery = spacetimedb.reducer({ deliveryId: t.string() }, (ctx, { deliveryId }) => {
  requireRole(ctx, 'router');
  if (!ctx.db.webhookDelivery.deliveryId.find(deliveryId)) ctx.db.webhookDelivery.insert({ deliveryId, at: ctx.timestamp });
});
