import { Identity } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { roleOf, type Ctx } from './ctx';
import { ACCOUNTS } from './finance/accounts';
import { COMPANIES } from './finance/companies';
import { RULES, canAutoPost, checkEntry, checkPeriod, checkRelease, entryCents, nextPeriod, post, type EventKind, type Line, type RuleId } from './finance/ledger';
import { POLICY } from './finance/policy';

// The Desk's general ledger, with its internal controls enforced here, in the
// database, not in a prompt:
//   - debits equal credits, whole cents, known accounts (checkEntry)
//   - posted entries are append-only; corrections are new entries
//   - a locked period refuses writes and names the next open one
//   - requester, preparer and approver are three different identities
//   - only entries at or under the limit, inside the period cap, post without a person
// A refused action is not thrown (that would roll back the audit row too): it
// writes finance_audit with the rule id and returns. Callers watch the audit.

/** Fixed identities for the simulated seats inside the module, so the three-identity rule means the same for them. */
export const SIM_ENGINE = new Identity(0x5100_0001n);
export const SIM_ACCOUNTANT = new Identity(0x5100_0002n);
export const SIM_RECONCILER = new Identity(0x5100_0003n);

const FINANCE_SEATS = ['accountant', 'reconciler', 'analyst'] as const;
type FinanceSeat = (typeof FINANCE_SEATS)[number];

export interface Actor { who: Identity; role: string }
const actorOf = (ctx: Ctx): Actor => ({ who: ctx.sender, role: roleOf(ctx)?.role ?? 'none' });

export function audit(ctx: Ctx, companyId: number, rule: RuleId | string, actor: Actor, target: string, detail: string, refused = true) {
  ctx.db.financeAudit.insert({ id: 0n, companyId, rule, actorRole: actor.role, who: actor.who, target, detail: detail.slice(0, 600), refused, at: ctx.timestamp });
}

/** Refuse unless the caller holds one of the roles; the refusal is audited. */
function allowed(ctx: Ctx, companyId: number, target: string, ...roles: string[]): Actor | null {
  const a = actorOf(ctx);
  if (roles.includes(a.role)) return a;
  audit(ctx, companyId, 'ROLE', a, target, `requires ${roles.join(' or ')}`);
  return null;
}

// ---------------------------------------------------------------- catalog, seats, periods

export function seedFinanceCatalogImpl(ctx: Ctx) {
  for (const c of COMPANIES) {
    const row = { id: c.id, slug: c.slug, name: c.name, category: c.category, size: c.size, tagline: c.tagline, featured: c.featured, status: 'active' };
    if (ctx.db.financeCompany.id.find(c.id)) ctx.db.financeCompany.id.update(row);
    else ctx.db.financeCompany.insert(row);
    for (const p of c.products) {
      const prow = { sku: p.sku, companyId: c.id, name: p.name, description: p.description, priceCents: p.priceCents, category: c.category, active: true };
      if (ctx.db.financeProduct.sku.find(p.sku)) ctx.db.financeProduct.sku.update(prow);
      else ctx.db.financeProduct.insert(prow);
    }
  }
  for (const a of ACCOUNTS) {
    const row = { code: a.code, name: a.name, type: a.type, note: a.note };
    if (ctx.db.financeAccount.code.find(a.code)) ctx.db.financeAccount.code.update(row);
    else ctx.db.financeAccount.insert(row);
  }
}

export const seedFinanceCatalog = spacetimedb.reducer((ctx) => {
  if (!allowed(ctx, 0, 'catalog', 'worker')) return;
  seedFinanceCatalogImpl(ctx);
});

/** The first identity to ask for a finance seat gets it, as bootstrapPoster does for the ledger poster. */
export const bootstrapFinanceSeat = spacetimedb.reducer({ seat: t.string() }, (ctx, { seat }) => {
  if (!FINANCE_SEATS.includes(seat as FinanceSeat)) return audit(ctx, 0, 'ROLE', actorOf(ctx), `seat:${seat}`, 'unknown finance seat');
  for (const r of ctx.db.role.iter()) if (r.role === seat) return audit(ctx, 0, 'ROLE', actorOf(ctx), `seat:${seat}`, `${seat} seat already taken`);
  if (roleOf(ctx)) return audit(ctx, 0, 'ROLE', actorOf(ctx), `seat:${seat}`, 'this identity already has a role');
  ctx.db.role.insert({ who: ctx.sender, role: seat, label: `finance-${seat}`, businessId: 0 });
});

const periodKey = (companyId: number, period: string) => `${companyId}:${period}`;

export function periodRow(ctx: Ctx, companyId: number, period: string) {
  const key = periodKey(companyId, period);
  return ctx.db.financePeriod.key.find(key) ?? ctx.db.financePeriod.insert({ key, companyId, period, status: 'open', lockedBy: undefined, lockedAt: undefined, autoPostedCents: 0n });
}
export const isLocked = (ctx: Ctx, companyId: number, period: string) => ctx.db.financePeriod.key.find(periodKey(companyId, period))?.status === 'locked';

// ---------------------------------------------------------------- request, prepare, approve

export interface RequestArgs {
  companyId: number; kind: string; cents: number; period: string; memo: string; sourceRef: string;
  decisionRef: string; formulaVersion: string; evidenceIds: string; processorRef: string;
}

export function requestImpl(ctx: Ctx, a: RequestArgs, requester: Actor): bigint {
  return ctx.db.financeRequest.insert({
    id: 0n, companyId: a.companyId, kind: a.kind, cents: BigInt(a.cents), period: a.period, memo: a.memo.slice(0, 300), sourceRef: a.sourceRef,
    decisionRef: a.decisionRef, formulaVersion: a.formulaVersion, evidenceIds: a.evidenceIds, processorRef: a.processorRef,
    requestedBy: requester.who, requesterRole: requester.role, status: 'open', at: ctx.timestamp,
  }).id;
}

/**
 * The preparer books a request. Lines come from the posting rule for its kind,
 * or, for a correcting proposal, from the caller (and must balance). Returns the
 * entry id, or 0n when a control refused it (and the audit says which).
 */
export function prepareImpl(ctx: Ctx, requestId: bigint, preparer: Actor, opts: { lines?: Line[]; priorPeriodMemo?: string } = {}): bigint {
  const r = ctx.db.financeRequest.id.find(requestId);
  if (!r) { audit(ctx, 0, 'EMPTY_ENTRY', preparer, `request:${requestId}`, 'no such request'); return 0n; }
  const target = `request:${requestId}`;
  if (r.status !== 'open') { audit(ctx, r.companyId, 'POSTED_IMMUTABLE', preparer, target, `request is ${r.status}`); return 0n; }
  const sod = checkRelease(r.requestedBy.toHexString(), preparer.who.toHexString(), null);
  if (sod) { audit(ctx, r.companyId, sod.rule, preparer, target, sod.message); return 0n; }
  const kind = r.kind as EventKind;
  const lines = opts.lines ?? (RULES[kind] ? post(kind, Number(r.cents), r.period, r.memo).lines : []);
  const bad = checkEntry({ lines });
  if (bad) { audit(ctx, r.companyId, bad.rule, preparer, target, bad.message); return 0n; }
  const locked = checkPeriod(r.period, (p) => isLocked(ctx, r.companyId, p));
  if (locked) {
    audit(ctx, r.companyId, locked.rule, preparer, target, locked.message);
    ctx.db.financeRequest.id.update({ ...r, status: 'refused' });
    return 0n;
  }
  const cents = entryCents({ lines });
  const per = periodRow(ctx, r.companyId, r.period);
  const closeEntry = POLICY.closeEntryKinds.includes(r.kind);
  const auto = closeEntry || canAutoPost(cents, Number(per.autoPostedCents));
  const entry = ctx.db.financeEntry.insert({
    id: 0n, companyId: r.companyId, period: r.period, kind: r.kind, memo: r.memo, sourceRef: r.sourceRef, requestId, status: auto ? 'posted' : 'pending_approval',
    cents: BigInt(cents), requestedBy: r.requestedBy, preparedBy: preparer.who, preparerRole: preparer.role, approvedBy: undefined,
    decisionRef: r.decisionRef, formulaVersion: r.formulaVersion, evidenceIds: r.evidenceIds, processorRef: r.processorRef,
    priorPeriodMemo: opts.priorPeriodMemo ?? '', autoPosted: auto, at: ctx.timestamp,
  });
  for (const l of lines) ctx.db.financeLine.insert({ id: 0n, entryId: entry.id, companyId: r.companyId, account: l.account, debit: BigInt(l.debit), credit: BigInt(l.credit) });
  ctx.db.financeRequest.id.update({ ...r, status: 'prepared' });
  if (auto && !closeEntry) ctx.db.financePeriod.key.update({ ...per, autoPostedCents: per.autoPostedCents + BigInt(cents) });
  else {
    ctx.db.financeQueue.insert({
      id: 0n, companyId: r.companyId, kind: 'approve_entry', title: `${RULES[kind]?.what ?? r.kind}: $${(cents / 100).toFixed(2)} is above the auto-post limit`,
      detailJson: JSON.stringify({ entryId: String(entry.id), cents, memo: r.memo, limitCents: POLICY.autoPostLimitCents }), targetRef: `entry:${entry.id}`,
      status: 'open', answer: '', reason: '', requestedBy: preparer.who, decidedBy: undefined, precedentId: 0n, at: ctx.timestamp, decidedAt: undefined,
    });
  }
  return entry.id;
}

/** Request and prepare in one go, for flows where two different identities are both inside the module (the simulation). */
export function bookImpl(ctx: Ctx, a: RequestArgs, requester: Actor, preparer: Actor, opts: { lines?: Line[]; priorPeriodMemo?: string } = {}): bigint {
  return prepareImpl(ctx, requestImpl(ctx, a, requester), preparer, opts);
}

export function approveImpl(ctx: Ctx, entryId: bigint, approver: Actor) {
  const e = ctx.db.financeEntry.id.find(entryId);
  const target = `entry:${entryId}`;
  if (!e) return audit(ctx, 0, 'EMPTY_ENTRY', approver, target, 'no such entry');
  if (approver.role !== 'controller') return audit(ctx, e.companyId, 'ROLE', approver, target, 'only the controller approves');
  if (e.status !== 'pending_approval') return audit(ctx, e.companyId, 'POSTED_IMMUTABLE', approver, target, `entry is ${e.status}`);
  const sod = checkRelease(e.requestedBy.toHexString(), e.preparedBy.toHexString(), approver.who.toHexString());
  if (sod) return audit(ctx, e.companyId, sod.rule, approver, target, sod.message);
  const locked = checkPeriod(e.period, (p) => isLocked(ctx, e.companyId, p));
  if (locked) return audit(ctx, e.companyId, locked.rule, approver, target, locked.message);
  ctx.db.financeEntry.id.update({ ...e, status: 'posted', approvedBy: approver.who });
  closeQueueFor(ctx, `entry:${entryId}`, 'approved', '', approver);
  audit(ctx, e.companyId, 'APPROVED', approver, target, `approved ${e.kind} $${(Number(e.cents) / 100).toFixed(2)}`, false);
}

function closeQueueFor(ctx: Ctx, targetRef: string, status: string, reason: string, by: Actor) {
  for (const q of ctx.db.financeQueue.iter()) {
    if (q.targetRef === targetRef && q.status === 'open') ctx.db.financeQueue.id.update({ ...q, status, reason, decidedBy: by.who, decidedAt: ctx.timestamp });
  }
}

/** Saves the controller's answer so the next similar case cites it. */
export function savePrecedent(ctx: Ctx, companyId: number, key: string, decision: string, reason: string, by: Actor, queueId: bigint): bigint {
  return ctx.db.financePrecedent.insert({ id: 0n, companyId, key, decision, reason: reason.slice(0, 600), by: by.who, queueId, citedCount: 0, at: ctx.timestamp }).id;
}

/** Approve or reject one queue item. A rejection needs a reason and becomes a precedent. */
export function decideQueueImpl(ctx: Ctx, queueId: bigint, decision: 'approved' | 'rejected' | 'answered', reason: string, answer: string, by: Actor) {
  const q = ctx.db.financeQueue.id.find(queueId);
  const target = `queue:${queueId}`;
  if (!q) return audit(ctx, 0, 'EMPTY_ENTRY', by, target, 'no such queue item');
  if (by.role !== 'controller') return audit(ctx, q.companyId, 'ROLE', by, target, 'only the controller decides the queue');
  if (q.status !== 'open') return audit(ctx, q.companyId, 'POSTED_IMMUTABLE', by, target, `already ${q.status}`);
  if (decision === 'rejected' && reason.trim().length < 5) return audit(ctx, q.companyId, 'REASON_REQUIRED', by, target, 'a rejection needs a reason (5 characters or more)');
  if (q.kind === 'approve_entry' && q.targetRef.startsWith('entry:')) {
    const entryId = BigInt(q.targetRef.slice(6));
    if (decision === 'approved') return approveImpl(ctx, entryId, by);
    const e = ctx.db.financeEntry.id.find(entryId);
    if (e && e.status === 'pending_approval') ctx.db.financeEntry.id.update({ ...e, status: 'rejected' });
  }
  let precedentId = 0n;
  const key = (JSON.parse(q.detailJson || '{}') as { precedentKey?: string }).precedentKey;
  if (key && decision !== 'approved') precedentId = savePrecedent(ctx, q.companyId, key, decision === 'rejected' ? 'rejected' : answer, reason || answer, by, q.id);
  ctx.db.financeQueue.id.update({ ...q, status: decision, reason: reason.slice(0, 600), answer: answer.slice(0, 600), decidedBy: by.who, decidedAt: ctx.timestamp, precedentId });
  audit(ctx, q.companyId, decision === 'rejected' ? 'CONTROLLER_REJECTED' : 'CONTROLLER_DECIDED', by, target, `${q.kind}: ${decision}${reason ? ` (${reason.slice(0, 200)})` : ''}`, false);
}

/** Posted entries cannot change. This reducer exists so the attempt is refused and logged (the red team calls it). */
export function editEntryImpl(ctx: Ctx, entryId: bigint, by: Actor) {
  const e = ctx.db.financeEntry.id.find(entryId);
  audit(ctx, e?.companyId ?? 0, 'POSTED_IMMUTABLE', by, `entry:${entryId}`, 'posted entries are append-only; book a correcting entry instead');
}

/** The controller locks a month. Refused while any bridge line above materiality is unexplained. */
export function lockPeriodImpl(ctx: Ctx, companyId: number, period: string, by: Actor) {
  const target = `period:${companyId}:${period}`;
  if (by.role !== 'controller') return audit(ctx, companyId, 'ROLE', by, target, 'only the controller locks a period');
  const close = ctx.db.financeClose.key.find(periodKey(companyId, period));
  if (!close) return audit(ctx, companyId, 'CLOSE_NOT_RUN', by, target, 'run the close first');
  const open = [...ctx.db.financeBridge.companyId.filter(companyId)].filter((b) => b.period === period && !b.explained && (b.cents < 0n ? -b.cents : b.cents) > BigInt(POLICY.materialityCents));
  if (open.length) return audit(ctx, companyId, 'UNEXPLAINED_ABOVE_MATERIALITY', by, target, `${open.length} bridge line(s) above $${(POLICY.materialityCents / 100).toFixed(2)} unexplained: ${open.map((b) => b.cause).join(', ')}`);
  const per = periodRow(ctx, companyId, period);
  if (per.status === 'locked') return audit(ctx, companyId, 'POSTED_IMMUTABLE', by, target, 'already locked');
  ctx.db.financePeriod.key.update({ ...per, status: 'locked', lockedBy: by.who, lockedAt: ctx.timestamp });
  ctx.db.financeClose.key.update({ ...close, status: 'locked' });
  periodRow(ctx, companyId, nextPeriod(period));
  audit(ctx, companyId, 'PERIOD_LOCKED', by, target, `locked ${period}`, false);
}

// ---------------------------------------------------------------- reducers (the doors people and the worker use)

const ReqArgs = {
  companyId: t.u16(), kind: t.string(), cents: t.u64(), period: t.string(), memo: t.string(), sourceRef: t.string(),
  decisionRef: t.string(), formulaVersion: t.string(), evidenceIds: t.string(), processorRef: t.string(),
};
const toArgs = (a: { companyId: number; kind: string; cents: bigint; period: string; memo: string; sourceRef: string; decisionRef: string; formulaVersion: string; evidenceIds: string; processorRef: string }): RequestArgs =>
  ({ ...a, cents: Number(a.cents) });

/** The requester (the Vouch decision engine, i.e. the worker) asks for an entry. */
export const financeRequestEntry = spacetimedb.reducer(ReqArgs, (ctx, a) => {
  const who = allowed(ctx, a.companyId, `request:${a.sourceRef}`, 'worker', 'reconciler', 'analyst');
  if (who) requestImpl(ctx, toArgs(a), who);
});

/** The returns accountant books a request; a correcting proposal may carry its own lines. */
export const financePrepareEntry = spacetimedb.reducer({ requestId: t.u64(), linesJson: t.string(), priorPeriodMemo: t.string() }, (ctx, a) => {
  const who = allowed(ctx, 0, `request:${a.requestId}`, 'accountant');
  if (!who) return;
  let lines: Line[] | undefined;
  if (a.linesJson) {
    try { lines = (JSON.parse(a.linesJson) as Line[]).map((l) => ({ account: String(l.account), debit: Number(l.debit), credit: Number(l.credit) })); }
    catch { return audit(ctx, 0, 'NON_INTEGER', who, `request:${a.requestId}`, 'lines are not valid JSON'); }
  }
  prepareImpl(ctx, a.requestId, who, { lines, priorPeriodMemo: a.priorPeriodMemo });
});

export const financeApproveEntry = spacetimedb.reducer({ entryId: t.u64() }, (ctx, { entryId }) => approveImpl(ctx, entryId, actorOf(ctx)));

export const financeDecideQueue = spacetimedb.reducer({ queueId: t.u64(), decision: t.string(), reason: t.string(), answer: t.string() }, (ctx, a) => {
  if (!['approved', 'rejected', 'answered'].includes(a.decision)) return audit(ctx, 0, 'ROLE', actorOf(ctx), `queue:${a.queueId}`, 'decision must be approved, rejected or answered');
  decideQueueImpl(ctx, a.queueId, a.decision as 'approved' | 'rejected' | 'answered', a.reason, a.answer, actorOf(ctx));
});

export const financeEditEntry = spacetimedb.reducer({ entryId: t.u64() }, (ctx, { entryId }) => editEntryImpl(ctx, entryId, actorOf(ctx)));

export const financeLockPeriod = spacetimedb.reducer({ companyId: t.u16(), period: t.string() }, (ctx, a) => lockPeriodImpl(ctx, a.companyId, a.period, actorOf(ctx)));

/** Opens a queue item (an unexplained cluster, a write-off proposal, an investigator's question). */
export const financeAskController = spacetimedb.reducer({ companyId: t.u16(), kind: t.string(), title: t.string(), detailJson: t.string(), targetRef: t.string() }, (ctx, a) => {
  const who = allowed(ctx, a.companyId, a.targetRef, 'worker', 'reconciler', 'analyst', 'accountant');
  if (!who) return;
  // A precedent for this key answers the question without a person: cite it instead of asking again.
  const key = (JSON.parse(a.detailJson || '{}') as { precedentKey?: string }).precedentKey;
  const prior = key ? [...ctx.db.financePrecedent.key.filter(key)].filter((p) => p.companyId === a.companyId).sort((x, y) => Number(y.id - x.id))[0] : undefined;
  if (prior) ctx.db.financePrecedent.id.update({ ...prior, citedCount: prior.citedCount + 1 });
  ctx.db.financeQueue.insert({
    id: 0n, companyId: a.companyId, kind: a.kind, title: a.title.slice(0, 200), detailJson: prior ? JSON.stringify({ ...JSON.parse(a.detailJson || '{}'), citesPrecedent: String(prior.id), precedentReason: prior.reason }) : a.detailJson,
    targetRef: a.targetRef, status: 'open', answer: '', reason: '', requestedBy: who.who, decidedBy: undefined, precedentId: prior?.id ?? 0n, at: ctx.timestamp, decidedAt: undefined,
  });
});

/** Writes a finance-agent run after the asynchronous call finishes; this is separate from the refund path. */
export const financeRecordAgentRun = spacetimedb.reducer({
  runId: t.string(), seat: t.string(), companyId: t.u16(), caseRef: t.string(), status: t.string(), mode: t.string(),
  inputJson: t.string(), outputJson: t.string(), valid: t.bool(), rejectReason: t.string(), runUrl: t.string(), agentId: t.string(), ms: t.u32(),
}, (ctx, a) => {
  const who = allowed(ctx, a.companyId, `agent-run:${a.runId}`, 'worker');
  if (!who) return;
  if (!['impact_analyst', 'impact_reviewer', 'close_controller', 'advisor', 'guardian'].includes(a.seat)) return audit(ctx, a.companyId, 'ROLE', who, `agent-run:${a.runId}`, 'unknown finance agent seat');
  if (!['running', 'done', 'rejected', 'failed'].includes(a.status) || !['live', 'mock', 'replay'].includes(a.mode)) return audit(ctx, a.companyId, 'ROLE', who, `agent-run:${a.runId}`, 'invalid run status or mode');
  const row = {
    ...a, inputJson: a.inputJson.slice(0, 120_000), outputJson: a.outputJson.slice(0, 120_000), rejectReason: a.rejectReason.slice(0, 2_000),
    runUrl: a.runUrl.slice(0, 2_000), agentId: a.agentId.slice(0, 200), ms: Math.min(a.ms, 2_147_483_647), at: ctx.timestamp,
  };
  if (ctx.db.financeAgentRun.runId.find(a.runId)) ctx.db.financeAgentRun.runId.update(row);
  else ctx.db.financeAgentRun.insert(row);
});
