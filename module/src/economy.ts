import { t } from 'spacetimedb/server';
import { simTick, spacetimedb } from './schema';
import { requireRole, setControlValue, type Ctx } from './ctx';
import { scheduleTick } from './control';
import { enqueueLabJob } from './lab';
import { DEFAULT_AGENTS_PER_TICK, DEFAULT_MAX_DAY, DEFAULT_TICK_MICROS, seedWorld as seedEngine, step } from './sim';
import type { SimDb } from './simdb';

// The economy lives here: the world is seeded by a reducer and stepped by a
// scheduled reducer, so the simulation's logic sits next to its data.

export function initImpl(ctx: Ctx) {
  ctx.db.simRun.insert({
    id: 1, seed: 0n, day: 0, cursor: 0, agentsPerTick: DEFAULT_AGENTS_PER_TICK, tickMicros: DEFAULT_TICK_MICROS, running: false,
    rngState: 1n, population: 0, seeded: false, maxDay: DEFAULT_MAX_DAY, eventSeq: 0n, startDay: 0, rings: 0,
  });
  setControlValue(ctx, 'creao_enabled', 'true');
  setControlValue(ctx, 'demo_mode', 'false');
  setControlValue(ctx, 'lab_enabled', 'true');
  ctx.db.metrics.insert({
    id: 1, eventsTotal: 0n, eventsLastTick: 0, stepsTotal: 0n, stepsLastTick: 0, lastTickAt: ctx.timestamp, lastTickMicros: 0n,
    ticksObserved: 0n, rowCounts: '{}',
  });
  scheduleTick(ctx, DEFAULT_TICK_MICROS);
}

export const init = spacetimedb.init((ctx) => initImpl(ctx));

const RESET_TABLES = [
  'agent', 'agentTruth', 'shopperLink', 'business', 'purchase', 'refundIntent', 'refund', 'creditEvent', 'eventFeed', 'regionStat',
  'fraudPattern', 'patternEvent', 'claim', 'evidence', 'decision', 'journalEntry', 'journalLine', 'credential', 'verification',
] as const;

export function seedWorldImpl(ctx: Ctx, seed: bigint, population: number, force: boolean) {
  requireRole(ctx, 'worker', 'controller');
  const run = ctx.db.simRun.id.find(1);
  if (run?.seeded && !force) throw new Error('world already seeded; pass force to reseed');
  if (force) {
    for (const name of RESET_TABLES) (ctx.db[name] as { clear(): bigint }).clear();
    for (const key of ['live_agent', 'pattern', 'credential_status']) {
      const c = ctx.db.counter.key.find(key);
      if (c) ctx.db.counter.key.update({ key, value: 0n });
    }
    if (run) ctx.db.simRun.id.update({ ...run, seeded: false, running: false });
  }
  const seeded = seedEngine(ctx.db as unknown as SimDb, {
    seed, population, agentsPerTick: run?.agentsPerTick || DEFAULT_AGENTS_PER_TICK, tickMicros: run?.tickMicros || DEFAULT_TICK_MICROS,
    maxDay: run?.maxDay || DEFAULT_MAX_DAY,
  });
  scheduleTick(ctx, seeded.tickMicros);
}

/** Creates agents, private truth rows, 60 businesses and 40 regions. Refuses to reseed without force. */
export const seedWorld = spacetimedb.reducer(
  { seed: t.u64(), population: t.u32(), force: t.bool() },
  (ctx, a) => seedWorldImpl(ctx, a.seed, a.population, a.force),
);

const COUNTED = ['agent', 'business', 'purchase', 'refund', 'creditEvent', 'fraudPattern', 'patternEvent', 'claim', 'evidence', 'credential', 'labEvent'] as const;

export function tickImpl(ctx: Ctx) {
  const res = step(ctx.db as unknown as SimDb);
  const m = ctx.db.metrics.id.find(1);
  if (m) {
    const ticks = m.ticksObserved + 1n;
    let rowCounts = m.rowCounts;
    if (ticks % 25n === 1n) {
      const counts: Record<string, number> = {};
      for (const name of COUNTED) counts[name] = Number((ctx.db[name] as { count(): bigint }).count());
      rowCounts = JSON.stringify(counts);
    }
    ctx.db.metrics.id.update({
      ...m, eventsTotal: m.eventsTotal + BigInt(res.events), eventsLastTick: res.events, stepsTotal: m.stepsTotal + BigInt(res.steps),
      stepsLastTick: res.steps, lastTickAt: ctx.timestamp,
      lastTickMicros: ctx.timestamp.microsSinceUnixEpoch - m.lastTickAt.microsSinceUnixEpoch, ticksObserved: ticks, rowCounts,
    });
  }
  // Schedule trigger for the Droid Lab: every 30 simulated days, review drift.
  const run = ctx.db.simRun.id.find(1);
  if (res.dayEnded !== null && run && res.dayEnded > run.startDay && (res.dayEnded - run.startDay) % 30 === 0) {
    const detectors = ['coordinated', 'false_defect', 'refund_frequency'];
    const detector = detectors[((res.dayEnded - run.startDay) / 30) % detectors.length]!;
    enqueueLabJob(ctx, 'schedule', `Review detector drift on the last 30 days (${detector}).`, detector);
  }
}

/** The scheduled tick. Only the database itself may call it. */
export const tick = spacetimedb.reducer({ onSchedule: simTick }, { scheduledMessage: simTick.rowType }, (ctx) => {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new Error('tick is called by the scheduler only');
  tickImpl(ctx);
});
