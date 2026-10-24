import { ScheduleAt, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, roleOf, setControlValue, type Ctx } from './ctx';
import { BUSINESS_A, BUSINESS_B } from './world';

// Roles, seats, the kill switch, simulation speed and the latency probe.

/** The first identity to call this becomes the worker; later callers are refused. */
export const bootstrapWorker = spacetimedb.reducer((ctx) => {
  for (const r of ctx.db.role.iter()) if (r.role === 'worker') throw new Error('a worker already exists');
  if (roleOf(ctx)) throw new Error('this identity already has a role');
  ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'desk-lead', businessId: 0 });
});

/** The ledger poster is a second worker identity: whoever proposes cannot post. */
export const bootstrapPoster = spacetimedb.reducer((ctx) => {
  for (const r of ctx.db.role.iter()) if (r.role === 'poster') throw new Error('a poster already exists');
  if (roleOf(ctx)) throw new Error('this identity already has a role');
  ctx.db.role.insert({ who: ctx.sender, role: 'poster', label: 'ledger-poster', businessId: 0 });
});

/** The worker loads the demo seat codes from its environment; they never reach a client. */
export const setSeatCodes = spacetimedb.reducer({ businessCode: t.string(), controllerCode: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  for (const [role, code] of [['business', a.businessCode], ['controller', a.controllerCode]] as const) {
    if (!code) continue;
    if (ctx.db.seatCode.role.find(role)) ctx.db.seatCode.role.update({ role, code });
    else ctx.db.seatCode.insert({ role, code });
  }
});

export function takeSeat(ctx: Ctx, code: string) {
  const matches = (role: string) => {
    const row = ctx.db.seatCode.role.find(role);
    return !!row && row.code.length > 0 && row.code === code;
  };
  const role = matches('controller') ? 'controller' : matches('business') ? 'business' : null;
  if (!role) throw new Error('wrong seat code');
  const existing = roleOf(ctx);
  if (existing?.role === 'worker' || existing?.role === 'poster') throw new Error('worker identities cannot take a business seat');
  const row = { who: ctx.sender, role, label: role === 'controller' ? 'controller' : 'business', businessId: existing?.businessId || BUSINESS_B };
  if (existing) ctx.db.role.who.update(row);
  else ctx.db.role.insert(row);
}

/** Grants the business (or controller) seat to whoever has the demo code. */
export const takeBusinessSeat = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => takeSeat(ctx, code));

/** The /business switcher: act for Business A (B-019) or Business B (B-002). */
export const switchBusiness = spacetimedb.reducer({ businessId: t.u16() }, (ctx, { businessId }) => {
  const r = requireRole(ctx, 'business', 'controller');
  if (businessId !== BUSINESS_A && businessId !== BUSINESS_B) throw new Error('the demo seats are B-019 and B-002');
  ctx.db.role.who.update({ ...r, businessId });
});

export function setControlImpl(ctx: Ctx, key: string, value: string) {
  // Turning the agents off fails closed, so a business seat may do it; everything else is the controller's.
  if (key === 'creao_enabled') requireRole(ctx, 'business', 'controller', 'worker');
  else requireRole(ctx, 'controller');
  if (!['creao_enabled', 'demo_mode', 'lab_enabled'].includes(key)) throw new Error(`unknown control ${key}`);
  if (value !== 'true' && value !== 'false') throw new Error('control values are true or false');
  setControlValue(ctx, key, value);
}

export const setControl = spacetimedb.reducer({ key: t.string(), value: t.string() }, (ctx, a) => setControlImpl(ctx, a.key, a.value));

export function scheduleTick(ctx: Ctx, micros: bigint) {
  for (const row of [...ctx.db.simTick.iter()]) ctx.db.simTick.scheduledId.delete(row.scheduledId);
  ctx.db.simTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(micros) });
}

/** Pause, play and speed. Reschedules the tick reducer. */
export const setSim = spacetimedb.reducer(
  { running: t.bool(), agentsPerTick: t.u32(), tickMicros: t.u64(), maxDay: t.u32() },
  (ctx, a) => {
    requireRole(ctx, 'controller', 'worker');
    const run = ctx.db.simRun.id.find(1);
    if (!run) throw new Error('simulation not initialised');
    if (a.agentsPerTick < 1 || a.agentsPerTick > 20_000) throw new Error('agentsPerTick must be 1 to 20,000');
    if (a.tickMicros < 20_000n) throw new Error('tickMicros must be at least 20,000 (50 ticks a second)');
    ctx.db.simRun.id.update({ ...run, running: a.running, agentsPerTick: a.agentsPerTick, tickMicros: a.tickMicros, maxDay: a.maxDay || run.maxDay });
    if (a.tickMicros !== run.tickMicros || !ctx.db.simTick.count()) scheduleTick(ctx, a.tickMicros);
  },
);

/** Latency probe: the client times this row's arrival on its own clock. Keeps the last 300 pings. */
export const ping = spacetimedb.reducer({ clientSentMs: t.f64() }, (ctx, { clientSentMs }) => {
  const row = ctx.db.latencyPing.insert({ id: 0n, who: ctx.sender, clientSentMs, serverAt: ctx.timestamp });
  if (row.id > 300n) ctx.db.latencyPing.id.delete(row.id - 300n);
});

/** scripts/bench.ts records what it measured on throwaway databases. Only real runs are written. */
export const recordBench = spacetimedb.reducer(
  { agents: t.u32(), days: t.u32(), stepsPerSec: t.f64(), daysPerMin: t.f64(), machine: t.string(), ranAt: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker', 'controller');
    ctx.db.benchResult.insert({ id: 0, ...a });
  },
);
