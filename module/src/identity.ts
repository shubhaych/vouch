import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, type Ctx } from './ctx';

// CRS identity screening results and the CRS call meter (docs/CRS.md). Worker-only
// writes. The reducers refuse anything that could carry personal data: persona ids
// must be one of CRS's four scripted sandbox personas, message codes must be short
// codes, and free text is limited to Vouch's own routing reasons.

export const PERSONAS = ['P01', 'P12', 'P13', 'P16'];
export const ROUTES = ['refund_investigator', 'merchant_identity_review', 'additional_verification'];
const TRIGGERS = ['thin_history', 'over_limit', 'no_credential', 'showcase', 'manual'];
const BANDS = ['low', 'review', 'unavailable'];
const STATUSES = ['match', 'discrepancy', 'additional_verification', 'unavailable'];
const PRODUCTS = ['login', 'refresh', 'fraud_finder', 'truvalidate_basic', 'health'];
const SOURCES = ['sandbox', 'fixture'];
const KEEP_CALLS = 2000;
const KEEP_SCREENINGS = 1000;

const oneOf = (name: string, v: string, allowed: string[]) => {
  if (!allowed.includes(v)) throw new SenderError(`${name} must be one of ${allowed.join(', ')}`);
};

/** A JSON array of strings, each matching `re`: the shape check that keeps vendor payloads out. */
function stringArray(name: string, json: string, re: RegExp, maxLen: number): string[] {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new SenderError(`${name} must be JSON`); }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.length > maxLen || !re.test(x))) {
    throw new SenderError(`${name} must be a JSON array of short strings`);
  }
  return v as string[];
}

// Anything shaped like an SSN or a birth date in Vouch's own reason text is refused.
const PII_LIKE = /\b\d{3}-?\d{2}-?\d{4}\b|\b(19|20)\d{2}-\d{2}-\d{2}\b/;

function stat(ctx: Ctx) {
  const row = ctx.db.crsStat.id.find(1);
  if (row) return row;
  return ctx.db.crsStat.insert({
    id: 1, calls: 0n, failedCalls: 0n, screenings: 0n, cachedScreenings: 0n, routesJson: '{}', productsJson: '{}',
    simRefundsScreened: 0n, simRoutesJson: '{}', lastHealthStatus: 0, lastHealthAt: ctx.timestamp, updatedAt: ctx.timestamp,
  });
}

const bump = (json: string, key: string, by = 1) => {
  const m = JSON.parse(json || '{}') as Record<string, number>;
  m[key] = (m[key] ?? 0) + by;
  return JSON.stringify(m);
};

export function recordCrsCallImpl(ctx: Ctx, a: { product: string; status: number; latencyMs: number; source: string }) {
  requireRole(ctx, 'worker');
  oneOf('product', a.product, PRODUCTS);
  oneOf('source', a.source, SOURCES);
  ctx.db.crsCall.insert({ id: 0n, ...a, at: ctx.timestamp });
  const s = stat(ctx);
  const failed = a.status === 0 || a.status >= 300;
  ctx.db.crsStat.id.update({
    ...s,
    calls: s.calls + 1n,
    failedCalls: s.failedCalls + (failed ? 1n : 0n),
    productsJson: bump(s.productsJson, a.product),
    ...(a.product === 'health' ? { lastHealthStatus: a.status, lastHealthAt: ctx.timestamp } : {}),
    updatedAt: ctx.timestamp,
  });
  if (ctx.db.crsCall.count() > BigInt(KEEP_CALLS)) {
    const old = [...ctx.db.crsCall.iter()].sort((x, y) => Number(x.id - y.id)).slice(0, Number(ctx.db.crsCall.count()) - KEEP_CALLS);
    for (const r of old) ctx.db.crsCall.id.delete(r.id);
  }
}

export const recordCrsCall = spacetimedb.reducer(
  { product: t.string(), status: t.u16(), latencyMs: t.u32(), source: t.string() },
  (ctx, a) => recordCrsCallImpl(ctx, a),
);

export interface ScreeningArgs {
  claimId: bigint; refundId: bigint; agentId: number; personaId: string; trigger: string; source: string; cached: boolean;
  contactRiskScore: number; contactRiskBand: string; identityStatus: string; messageCodes: string; route: string;
  reasonsJson: string; errorsJson: string; latencyMs: number;
}

export function recordIdentityScreeningImpl(ctx: Ctx, a: ScreeningArgs) {
  requireRole(ctx, 'worker');
  oneOf('personaId', a.personaId, PERSONAS);
  oneOf('trigger', a.trigger, TRIGGERS);
  oneOf('source', a.source, SOURCES);
  oneOf('contactRiskBand', a.contactRiskBand, BANDS);
  oneOf('identityStatus', a.identityStatus, STATUSES);
  oneOf('route', a.route, ROUTES);
  if (a.contactRiskScore < -1 || a.contactRiskScore > 100) throw new SenderError('contactRiskScore is 0..100, or -1 when unavailable');
  stringArray('messageCodes', a.messageCodes, /^[0-9A-Z]{1,8}$/, 8);
  const reasons = stringArray('reasonsJson', a.reasonsJson, /^[^<>]*$/, 300);
  stringArray('errorsJson', a.errorsJson, /^[^<>]*$/, 300);
  if (reasons.some((r) => PII_LIKE.test(r))) throw new SenderError('reasons must not contain identity data');
  const row = ctx.db.identityScreening.insert({ id: 0n, ...a, checkedAt: ctx.timestamp });
  const s = stat(ctx);
  ctx.db.crsStat.id.update({
    ...s,
    screenings: s.screenings + 1n,
    cachedScreenings: s.cachedScreenings + (a.cached ? 1n : 0n),
    routesJson: bump(s.routesJson, a.route),
    updatedAt: ctx.timestamp,
  });
  if (ctx.db.identityScreening.count() > BigInt(KEEP_SCREENINGS)) {
    const old = [...ctx.db.identityScreening.iter()].sort((x, y) => Number(x.id - y.id)).slice(0, Number(ctx.db.identityScreening.count()) - KEEP_SCREENINGS);
    for (const r of old) ctx.db.identityScreening.id.delete(r.id);
  }
  return row;
}

export const recordIdentityScreening = spacetimedb.reducer(
  {
    claimId: t.u64(), refundId: t.u64(), agentId: t.u32(), personaId: t.string(), trigger: t.string(), source: t.string(), cached: t.bool(),
    contactRiskScore: t.i32(), contactRiskBand: t.string(), identityStatus: t.string(), messageCodes: t.string(), route: t.string(),
    reasonsJson: t.string(), errorsJson: t.string(), latencyMs: t.u32(),
  },
  (ctx, a) => { recordIdentityScreeningImpl(ctx, a); },
);

/** The simulation's investigation-path refunds, each mapped onto a persona and routed by its (cached) screening. */
export function recordSimScreeningsImpl(ctx: Ctx, a: { refunds: number; routesJson: string }) {
  requireRole(ctx, 'worker');
  const routes = JSON.parse(a.routesJson || '{}') as Record<string, number>;
  for (const [k, v] of Object.entries(routes)) {
    oneOf('route', k, ROUTES);
    if (!Number.isInteger(v) || v < 0) throw new SenderError('route counts are whole numbers');
  }
  const s = stat(ctx);
  let sim = s.simRoutesJson;
  for (const [k, v] of Object.entries(routes)) sim = bump(sim, k, v);
  ctx.db.crsStat.id.update({ ...s, simRefundsScreened: s.simRefundsScreened + BigInt(a.refunds), simRoutesJson: sim, updatedAt: ctx.timestamp });
}

export const recordSimScreenings = spacetimedb.reducer(
  { refunds: t.u32(), routesJson: t.string() },
  (ctx, a) => recordSimScreeningsImpl(ctx, a),
);
