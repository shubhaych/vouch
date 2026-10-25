import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole } from './ctx';

// The returns pulse (how many returns per second, by item) is computed by the
// worker from the live refund rows and written here as one row, so every
// browser can subscribe to it. The Returns Monitor agent's notes about the
// pulse are appended to monitor_note. Both are worker-only writes.

export const writePulse = spacetimedb.reducer(
  { windowSeconds: t.u16(), returns: t.u32(), perSecond: t.f64(), baselinePerSecond: t.f64(), itemsJson: t.string(), businessesJson: t.string(), cohortsJson: t.string(), spikes: t.u16() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    JSON.parse(a.itemsJson); JSON.parse(a.businessesJson); JSON.parse(a.cohortsJson); // refuse malformed JSON
    const row = { id: 1, ...a, computedAt: ctx.timestamp };
    if (ctx.db.returnsPulse.id.find(1)) ctx.db.returnsPulse.id.update(row);
    else ctx.db.returnsPulse.insert(row);
  },
);

const KEEP_NOTES = 50;

export const recordMonitorNote = spacetimedb.reducer(
  { runId: t.string(), runUrl: t.string(), trigger: t.string(), json: t.string(), provenance: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (!['schedule', 'spike', 'manual'].includes(a.trigger)) throw new SenderError('trigger is schedule, spike or manual');
    if (!['live', 'fixture'].includes(a.provenance)) throw new SenderError('provenance is live or fixture');
    JSON.parse(a.json);
    ctx.db.monitorNote.insert({ id: 0n, ...a, at: ctx.timestamp });
    const all = [...ctx.db.monitorNote.iter()].sort((x, y) => Number(x.id - y.id));
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_NOTES))) ctx.db.monitorNote.id.delete(old.id);
  },
);
