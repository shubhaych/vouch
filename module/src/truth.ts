import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';

// Ground truth leaves the database only through this procedure, only to the
// worker, and only for the evaluator export (scripts/export-history.ts).
// Detectors and Droid never see it.
export const exportTruth = spacetimedb.procedure(t.string(), (ctx) =>
  ctx.withTx((tx) => {
    const role = tx.db.role.who.find(ctx.sender);
    if (role?.role !== 'worker') throw new SenderError('only the worker may export truth');
    const out: { agentId: number; kind: string; ringId: number }[] = [];
    for (const r of tx.db.agentTruth.iter()) out.push({ agentId: r.agentId, kind: r.kind, ringId: r.ringId });
    return JSON.stringify(out);
  }),
);
