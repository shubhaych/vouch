// Helpers shared by reducer files. Not re-exported from index.ts: SpacetimeDB
// refuses entry-file exports that are not reducers, views or procedures.
import { SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import type { spacetimedb } from './schema';
import { World } from './sim';
import type { SimDb } from './simdb';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type Role = 'worker' | 'poster' | 'business' | 'controller';

export const roleOf = (ctx: Ctx) => ctx.db.role.who.find(ctx.sender);

export function requireRole(ctx: Ctx, ...allowed: Role[]) {
  const r = roleOf(ctx);
  if (!r || !allowed.includes(r.role as Role)) throw new SenderError(`requires role: ${allowed.join(' or ')}`);
  return r;
}

/**
 * The engine (sim.ts) stays free of spacetimedb imports, so its refusals are plain
 * Errors. SpacetimeDB shows the caller only a SenderError's message; anything else is
 * a panic and the browser sees "The instance encountered a fatal error" (QA-001).
 */
export function asSenderError<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    throw e instanceof SenderError ? e : new SenderError(e instanceof Error ? e.message : String(e));
  }
}

/** The engine runs against ctx.db exactly as it runs against the in-memory world. */
export const worldOf = (ctx: Ctx): World => World.open(ctx.db as unknown as SimDb);

export function nextCounter(ctx: Ctx, key: string): bigint {
  const row = ctx.db.counter.key.find(key);
  const value = (row?.value ?? 0n) + 1n;
  if (row) ctx.db.counter.key.update({ key, value });
  else ctx.db.counter.insert({ key, value });
  return value;
}

export function setControlValue(ctx: Ctx, key: string, value: string) {
  const row = ctx.db.control.key.find(key);
  if (row) ctx.db.control.key.update({ ...row, value, updatedAt: ctx.timestamp });
  else ctx.db.control.insert({ key, value, updatedAt: ctx.timestamp });
}

/** Fail closed: a missing row reads as off. */
export const controlOn = (ctx: Ctx, key: string) => ctx.db.control.key.find(key)?.value === 'true';

/** The live shopper agent behind this identity. */
export function myAgentId(ctx: Ctx): number {
  const link = ctx.db.shopperLink.who.find(ctx.sender);
  if (!link) throw new SenderError('join as a shopper first');
  return link.agentId;
}
