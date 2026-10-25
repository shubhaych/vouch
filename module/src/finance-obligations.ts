import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { roleOf, type Ctx } from './ctx';
import { COMPANIES } from './finance/companies';
import { nextPeriod, periodOf, prevPeriod } from './finance/ledger';
import { POLICY } from './finance/policy';
import { accrue, completionRateBp, trueUpCents } from './finance/reserve';
import { audit, bookImpl, isLocked, periodRow, type Actor } from './finance-ledger';

// Conditional second legs and the return reserve. A T2 or T3 refund opens an
// obligation with a 30-day clock; a return scan releases it (book leg 2, settle
// it, goods back at cost), a failed inspection makes it partial (a controller
// reviews), and the clock running out lapses it (the held amount stays revenue).
// At month end every open leg is accrued at its segment's expected completion
// rate; day one of the next period reverses the accrual; the true-up between
// accrual and outcome is what next month's rates learn from.

const HOUR_MS = 3_600_000;
export const hourPeriod = (epochMs: number, hour: number) => periodOf(epochMs + hour * HOUR_MS);

export interface OpenObligationArgs {
  companyId: number; orderRef: string; claimRef: string; decisionRef: string; tier: string; category: string; sku: string;
  leg1Cents: number; leg2Cents: number; costCents: number; openedHour: number;
}

export function openObligationImpl(ctx: Ctx, a: OpenObligationArgs, requestedBy: Actor): bigint {
  return ctx.db.financeObligation.insert({
    id: 0n, companyId: a.companyId, orderRef: a.orderRef, claimRef: a.claimRef, decisionRef: a.decisionRef, tier: a.tier, category: a.category, sku: a.sku,
    leg1Cents: a.leg1Cents, leg2Cents: a.leg2Cents, costCents: a.costCents, status: 'open', openedHour: a.openedHour,
    dueHour: a.openedHour + POLICY.leg2.clockDays * 24, closedHour: 0, outcomeNote: '', accruedCents: 0, accruedPeriod: '', requestedBy: requestedBy.who,
  }).id;
}

export type ReturnOutcome = 'intact' | 'partial' | 'missing' | 'lapsed';

/**
 * A warehouse event closes an obligation. The leg-2 entries are requested by
 * whoever authorized the refund and prepared by the caller, so the preparer is
 * never the requester. A return that arrives after its month locked posts to the
 * open period with a prior-period memo.
 */
export function applyReturnImpl(ctx: Ctx, obligationId: bigint, outcome: ReturnOutcome, hour: number, epochMs: number, preparer: Actor): string {
  const o = ctx.db.financeObligation.id.find(obligationId);
  const target = `obligation:${obligationId}`;
  if (!o) { audit(ctx, 0, 'EMPTY_ENTRY', preparer, target, 'no such obligation'); return 'missing'; }
  if (o.status !== 'open') { audit(ctx, o.companyId, 'POSTED_IMMUTABLE', preparer, target, `obligation already ${o.status}`); return o.status; }
  let period = hourPeriod(epochMs, hour);
  while (isLocked(ctx, o.companyId, period)) period = nextPeriod(period);
  const opened = hourPeriod(epochMs, o.openedHour);
  const priorPeriodMemo = opened !== period && isLocked(ctx, o.companyId, opened) ? `Relates to ${opened}, which is locked; booked in ${period}.` : '';
  const requester: Actor = { who: o.requestedBy, role: 'decision_engine' };
  const base = { companyId: o.companyId, period, sourceRef: o.claimRef, decisionRef: o.decisionRef, formulaVersion: '', evidenceIds: '', processorRef: '' };
  let paid = 0;
  let status = 'lapsed';
  let note = '';
  if (outcome === 'intact') {
    bookImpl(ctx, { ...base, kind: 'leg2_authorized', cents: o.leg2Cents, memo: `Leg 2 authorized: return scanned intact (${o.orderRef})` }, requester, preparer, { priorPeriodMemo });
    bookImpl(ctx, { ...base, kind: 'leg2_settled', cents: o.leg2Cents, memo: `Leg 2 settled (${o.orderRef})` }, requester, preparer, { priorPeriodMemo });
    if (o.costCents > 0) bookImpl(ctx, { ...base, kind: 'goods_back', cents: o.costCents, memo: `Goods back at cost (${o.orderRef})` }, requester, preparer, { priorPeriodMemo });
    paid = o.leg2Cents;
    status = 'released';
    note = 'Return scanned intact; leg 2 released.';
  } else if (outcome === 'partial') {
    status = 'partial';
    note = 'The returned item failed inspection; a controller reviews before any second leg.';
    ctx.db.financeQueue.insert({
      id: 0n, companyId: o.companyId, kind: 'partial_return', title: `Return for ${o.orderRef} failed inspection`,
      detailJson: JSON.stringify({ obligationId: String(o.id), leg2Cents: o.leg2Cents, claimRef: o.claimRef, winner: 'warehouse', why: POLICY.authorityWhy.goods_returned }),
      targetRef: target, status: 'open', answer: '', reason: '', requestedBy: preparer.who, decidedBy: undefined, precedentId: 0n, at: ctx.timestamp, decidedAt: undefined,
    });
  } else {
    note = outcome === 'missing' ? 'Nothing came back before the clock ran out; the held amount stays revenue.' : 'The 30-day clock ran out; the held amount stays revenue.';
  }
  ctx.db.financeObligation.id.update({ ...o, status, closedHour: hour, outcomeNote: note });
  if (o.accruedCents > 0) recordTrueUp(ctx, o.companyId, o.accruedPeriod, o.accruedCents, paid);
  const st = ctx.db.financeCompanyState.companyId.find(o.companyId);
  if (st && outcome === 'intact') ctx.db.financeCompanyState.companyId.update({ ...st, goodsBackUnits: st.goodsBackUnits + 1, goodsBackCents: st.goodsBackCents + BigInt(o.costCents) });
  return status;
}

function recordTrueUp(ctx: Ctx, companyId: number, period: string, accrued: number, paid: number) {
  const row = [...ctx.db.financeReserve.companyId.filter(companyId)].filter((r) => r.period === period).sort((a, b) => Number(b.id - a.id))[0];
  if (!row) return;
  const resolvedAccruedCents = row.resolvedAccruedCents + BigInt(accrued);
  const actualCents = row.actualCents + BigInt(paid);
  ctx.db.financeReserve.id.update({ ...row, resolvedAccruedCents, actualCents, trueUpCents: BigInt(trueUpCents(Number(resolvedAccruedCents), Number(actualCents))) });
}

/** Completion rates by tier and category from this company's resolved obligations. */
function ratesFor(ctx: Ctx, companyId: number) {
  const cells = new Map<string, { completed: number; resolved: number }>();
  let completed = 0;
  let resolved = 0;
  for (const o of ctx.db.financeObligation.companyId.filter(companyId)) {
    if (o.status === 'open') continue;
    const k = `${o.tier}|${o.category}`;
    const c = cells.get(k) ?? { completed: 0, resolved: 0 };
    c.resolved++;
    resolved++;
    if (o.status === 'released') { c.completed++; completed++; }
    cells.set(k, c);
  }
  const overall = completionRateBp({ completed, resolved }, POLICY.reserve.defaultRateBp);
  return { overall, rate: (tier: string, category: string) => completionRateBp(cells.get(`${tier}|${category}`), overall), cells: cells.size, resolved };
}

/** Month-end: accrue every open second leg in `period`; records the reserve snapshot. */
export function accrueImpl(ctx: Ctx, companyId: number, period: string, requester: Actor, preparer: Actor) {
  if ([...ctx.db.financeReserve.companyId.filter(companyId)].some((r) => r.period === period)) return; // once per period
  const open = [...ctx.db.financeObligation.companyId.filter(companyId)].filter((o) => o.status === 'open');
  const r = ratesFor(ctx, companyId);
  const acc = accrue(open.map((o) => ({ obligationId: String(o.id), tier: o.tier, category: o.category, leg2Cents: o.leg2Cents })), r.rate);
  for (const [i, o] of open.entries()) ctx.db.financeObligation.id.update({ ...o, accruedCents: acc.lines[i]!.cents, accruedPeriod: period });
  const openLeg2 = open.reduce((s, o) => s + o.leg2Cents, 0);
  ctx.db.financeReserve.insert({
    id: 0n, companyId, period, openCount: open.length, openLeg2Cents: BigInt(openLeg2), accruedCents: BigInt(acc.totalCents),
    avgRateBp: openLeg2 ? Math.round((acc.totalCents * 10_000) / openLeg2) : r.overall, resolvedAccruedCents: 0n, actualCents: 0n, trueUpCents: 0n,
    ratesJson: JSON.stringify({ overallBp: r.overall, segments: r.cells, resolved: r.resolved, priorStrength: POLICY.reserve.priorStrength }), at: ctx.timestamp,
  });
  if (acc.totalCents > 0) {
    bookImpl(ctx, { companyId, kind: 'accrue_leg2', cents: acc.totalCents, period, memo: `Accrue leg 2 of ${open.length} open return obligation(s) at ${(acc.totalCents * 100 / Math.max(1, openLeg2)).toFixed(1)}% expected completion`, sourceRef: `reserve:${companyId}:${period}`, decisionRef: '', formulaVersion: POLICY.version, evidenceIds: '', processorRef: '' }, requester, preparer);
  }
}

/** Day one of `period`: reverse the previous period's accrual. */
export function reverseImpl(ctx: Ctx, companyId: number, period: string, requester: Actor, preparer: Actor) {
  const prev = prevPeriod(period);
  const row = [...ctx.db.financeReserve.companyId.filter(companyId)].filter((r) => r.period === prev).sort((a, b) => Number(b.id - a.id))[0];
  if (!row || row.accruedCents === 0n) return;
  const already = [...ctx.db.financeEntry.sourceRef.filter(`reverse:${companyId}:${prev}`)].length > 0;
  if (already) return;
  bookImpl(ctx, { companyId, kind: 'reverse_accrual', cents: Number(row.accruedCents), period, memo: `Auto-reverse the ${prev} leg-2 accrual on day one`, sourceRef: `reverse:${companyId}:${prev}`, decisionRef: '', formulaVersion: POLICY.version, evidenceIds: '', processorRef: '' }, requester, preparer);
}

/**
 * The close for a company with no external feeds (lite mode): the three totals
 * come from the same ledger, so the bridge is empty; the accrual and its
 * reversal are booked. A company with a real book (the featured one) records
 * its close from the worker instead (financeRecordClose).
 */
export function closeLiteImpl(ctx: Ctx, companyId: number, period: string, requester: Actor, preparer: Actor) {
  const key = `${companyId}:${period}`;
  const existing = ctx.db.financeClose.key.find(key);
  if (existing?.source === 'book' || existing?.status === 'locked' || isLocked(ctx, companyId, period)) return;
  accrueImpl(ctx, companyId, period, requester, preparer);
  reverseImpl(ctx, companyId, nextPeriod(period), requester, preparer);
  let returns = 0n;
  let settled = 0n;
  let events = 0;
  for (const e of ctx.db.financeEntry.companyId.filter(companyId)) {
    if (e.period !== period || e.status !== 'posted') continue;
    if (e.kind === 'leg1_authorized' || e.kind === 'leg2_authorized') { returns += e.cents; events++; }
    if (e.kind === 'leg1_settled' || e.kind === 'leg2_settled') settled += e.cents;
  }
  const row = {
    key, companyId, period, ledgerCents: returns, processorCents: settled, bankCents: settled, events, matched: events, exceptions: 0, closedByPlaybook: 0,
    toInvestigator: 0, toController: 0, unexplainedCents: 0n, status: 'ready', source: 'lite',
    memo: 'Lite close: no processor or bank feed for this company; totals from its own ledger. Accrual booked; reversal booked on day one.', at: ctx.timestamp,
  };
  if (existing) ctx.db.financeClose.key.update(row);
  else ctx.db.financeClose.insert(row);
  periodRow(ctx, companyId, nextPeriod(period));
}

// ---------------------------------------------------------------- reducers

const actorOf = (ctx: Ctx): Actor => ({ who: ctx.sender, role: roleOf(ctx)?.role ?? 'none' });
const need = (ctx: Ctx, companyId: number, target: string, ...roles: string[]) => {
  const a = actorOf(ctx);
  if (roles.includes(a.role)) return a;
  audit(ctx, companyId, 'ROLE', a, target, `requires ${roles.join(' or ')}`);
  return null;
};
const epochOf = (ctx: Ctx) => Number(ctx.db.financeSimState.id.find(1)?.epochMs ?? 0n);

/** The decision engine (worker) opens an obligation for a T2 or T3 refund it authorized. */
export const financeOpenObligation = spacetimedb.reducer({
  companyId: t.u16(), orderRef: t.string(), claimRef: t.string(), decisionRef: t.string(), tier: t.string(), category: t.string(), sku: t.string(),
  leg1Cents: t.u32(), leg2Cents: t.u32(), costCents: t.u32(), openedHour: t.u32(),
}, (ctx, a) => {
  const who = need(ctx, a.companyId, `claim:${a.claimRef}`, 'worker');
  if (who) openObligationImpl(ctx, a, who);
});

/** A warehouse scan (or the clock) closes an obligation; the accountant books it. */
export const financeApplyReturn = spacetimedb.reducer({ obligationId: t.u64(), outcome: t.string(), hour: t.u32() }, (ctx, a) => {
  const who = need(ctx, 0, `obligation:${a.obligationId}`, 'accountant');
  if (!who) return;
  if (!['intact', 'partial', 'missing', 'lapsed'].includes(a.outcome)) return audit(ctx, 0, 'ROLE', who, `obligation:${a.obligationId}`, 'outcome must be intact, partial, missing or lapsed');
  applyReturnImpl(ctx, a.obligationId, a.outcome as ReturnOutcome, a.hour, epochOf(ctx), who);
});

/** The accountant runs the month-end accrual (with the decision engine as requester: the worker identity). */
export const financeAccrue = spacetimedb.reducer({ companyId: t.u16(), period: t.string() }, (ctx, a) => {
  const who = need(ctx, a.companyId, `reserve:${a.companyId}:${a.period}`, 'accountant');
  if (!who) return;
  const engine = [...ctx.db.role.iter()].find((r) => r.role === 'worker');
  if (!engine) return audit(ctx, a.companyId, 'SOD_THREE_IDENTITIES', who, `reserve:${a.period}`, 'no decision-engine identity to request the accrual');
  accrueImpl(ctx, a.companyId, a.period, { who: engine.who, role: 'worker' }, who);
  reverseImpl(ctx, a.companyId, nextPeriod(a.period), { who: engine.who, role: 'worker' }, who);
});

/** The reconciler closes every lite company for a period in one call. */
export const financeCloseLite = spacetimedb.reducer({ period: t.string() }, (ctx, a) => {
  const who = need(ctx, 0, `close:${a.period}`, 'reconciler');
  if (!who) return;
  const engine = [...ctx.db.role.iter()].find((r) => r.role === 'worker');
  const accountant = [...ctx.db.role.iter()].find((r) => r.role === 'accountant');
  if (!engine || !accountant) return audit(ctx, 0, 'SOD_THREE_IDENTITIES', who, `close:${a.period}`, 'the decision engine and the accountant must both exist');
  for (const c of COMPANIES) closeLiteImpl(ctx, c.id, a.period, { who: engine.who, role: 'worker' }, { who: accountant.who, role: 'accountant' });
});

/** The featured company's close, computed in the worker over the 1,000,000-order book, recorded by the reconciler. */
export const financeRecordClose = spacetimedb.reducer({
  companyId: t.u16(), period: t.string(), ledgerCents: t.i64(), processorCents: t.i64(), bankCents: t.i64(), events: t.u32(), matched: t.u32(),
  exceptions: t.u32(), closedByPlaybook: t.u32(), toInvestigator: t.u32(), toController: t.u32(), bridgeJson: t.string(), clustersJson: t.string(), memo: t.string(),
}, (ctx, a) => {
  const who = need(ctx, a.companyId, `close:${a.companyId}:${a.period}`, 'reconciler');
  if (!who) return;
  if (isLocked(ctx, a.companyId, a.period)) return audit(ctx, a.companyId, 'REFUSED_PERIOD_LOCKED', who, `close:${a.period}`, `period ${a.period} is locked`);
  for (const b of [...ctx.db.financeBridge.companyId.filter(a.companyId)]) if (b.period === a.period) ctx.db.financeBridge.id.delete(b.id);
  for (const c of [...ctx.db.financeCluster.companyId.filter(a.companyId)]) if (c.period === a.period) ctx.db.financeCluster.id.delete(c.id);
  interface ClusterIn { cls: string; status: string; cents: number; orders: number; winner: string; reason: string; playbook: string; proposalJson?: string; explanation?: string; sampleRefs?: string }
  interface BridgeIn { cause: string; cents: number; orders: number; winner: string; why: string; explained: boolean; cluster?: number }
  const clusters = JSON.parse(a.clustersJson || '[]') as ClusterIn[];
  const ids = clusters.map((c) => ctx.db.financeCluster.insert({
    id: 0n, companyId: a.companyId, period: a.period, cls: c.cls, status: c.status, cents: BigInt(c.cents), orders: c.orders, winner: c.winner, reason: c.reason,
    playbook: c.playbook, proposalJson: c.proposalJson ?? '', explanation: c.explanation ?? '', sampleRefs: c.sampleRefs ?? '', at: ctx.timestamp,
  }).id);
  let unexplained = 0n;
  for (const b of JSON.parse(a.bridgeJson || '[]') as BridgeIn[]) {
    ctx.db.financeBridge.insert({ id: 0n, companyId: a.companyId, period: a.period, cause: b.cause, cents: BigInt(b.cents), orders: b.orders, winner: b.winner, why: b.why, explained: b.explained, clusterId: b.cluster !== undefined ? ids[b.cluster] ?? 0n : 0n });
    if (!b.explained) unexplained += BigInt(Math.abs(b.cents));
  }
  const row = {
    key: `${a.companyId}:${a.period}`, companyId: a.companyId, period: a.period, ledgerCents: a.ledgerCents, processorCents: a.processorCents, bankCents: a.bankCents,
    events: a.events, matched: a.matched, exceptions: a.exceptions, closedByPlaybook: a.closedByPlaybook, toInvestigator: a.toInvestigator, toController: a.toController,
    unexplainedCents: unexplained, status: unexplained > BigInt(POLICY.materialityCents) ? 'blocked' : 'ready', source: 'book', memo: a.memo, at: ctx.timestamp,
  };
  if (ctx.db.financeClose.key.find(row.key)) ctx.db.financeClose.key.update(row);
  else ctx.db.financeClose.insert(row);
});

/** The reconciler records an explanation the Verifier accepted (or a controller's resolution) for one cluster. */
export const financeResolveCluster = spacetimedb.reducer({ clusterId: t.u64(), status: t.string(), explanation: t.string(), proposalJson: t.string() }, (ctx, a) => {
  const c = ctx.db.financeCluster.id.find(a.clusterId);
  const who = need(ctx, c?.companyId ?? 0, `cluster:${a.clusterId}`, 'reconciler');
  if (!who || !c) return;
  if (isLocked(ctx, c.companyId, c.period)) return audit(ctx, c.companyId, 'REFUSED_PERIOD_LOCKED', who, `cluster:${a.clusterId}`, `period ${c.period} is locked`);
  ctx.db.financeCluster.id.update({ ...c, status: a.status, explanation: a.explanation.slice(0, 2000), proposalJson: a.proposalJson || c.proposalJson });
  const explained = a.status === 'explained' || a.status === 'resolved';
  for (const b of ctx.db.financeBridge.companyId.filter(c.companyId)) if (b.clusterId === c.id) ctx.db.financeBridge.id.update({ ...b, explained });
  const close = ctx.db.financeClose.key.find(`${c.companyId}:${c.period}`);
  if (close && close.status !== 'locked') {
    let unexplained = 0n;
    for (const b of ctx.db.financeBridge.companyId.filter(c.companyId)) if (b.period === c.period && !b.explained) unexplained += b.cents < 0n ? -b.cents : b.cents;
    ctx.db.financeClose.key.update({ ...close, unexplainedCents: unexplained, status: unexplained > BigInt(POLICY.materialityCents) ? 'blocked' : 'ready' });
  }
});
