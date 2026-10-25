import { describe, expect, it } from 'vitest';
import { harness, who } from './testkit';
import { seedWorldImpl } from './economy';
import { takeSeat } from './control';
import { approveImpl, bookImpl, editEntryImpl, lockPeriodImpl, prepareImpl, requestImpl, type Actor } from './finance-ledger';
import { accrueImpl, applyReturnImpl, closeLiteImpl, openObligationImpl, reverseImpl } from './finance-obligations';
import { advanceImpl, seedPortfolioImpl } from './finance-sim';
import { scorePortfolioImpl } from './finance-score';
import { trialBalance, sumBalances } from './finance/ledger';
import { SIM } from './finance/sim-config';
import type { Ctx } from './ctx';

// The Desk's controls run as real reducers here (the in-process SpacetimeDB
// harness): every refusal leaves an audit row naming its rule.
const worker = who('worker');
const accountant = who('accountant');
const controller = who('controller');
const COMPANY = 2;

function desk() {
  const k = harness();
  k.as(worker, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'desk-lead', businessId: 0 }));
  k.as(accountant, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'accountant', label: 'finance-accountant', businessId: 0 }));
  k.as(worker, (ctx) => { ctx.db.seatCode.insert({ role: 'business', code: 'b-code' }); ctx.db.seatCode.insert({ role: 'controller', code: 'c-code' }); });
  k.as(controller, (ctx) => takeSeat(ctx, 'c-code'));
  k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false));
  k.as(worker, (ctx) => seedPortfolioImpl(ctx, 7n));
  return k;
}
const actor = (ctx: Ctx, role: string): Actor => ({ who: ctx.sender, role });
const base = { companyId: COMPANY, decisionRef: 'D-1', formulaVersion: 'v1', evidenceIds: 'A-1,A-2', processorRef: 'ch_1' };
const audits = (ctx: Ctx, rule: string) => [...ctx.db.financeAudit.iter()].filter((a) => a.rule === rule && a.refused);
let workerActor: Actor;
let accountantIdentity: Actor['who'];

describe('the ledger as reducers', () => {
  it('books Maya end to end through request, prepare, accrual, reversal and the return; the trial balance is zero', () => {
    const k = desk();
    k.as(worker, (ctx) => { workerActor = actor(ctx, 'worker'); });
    const sept = '2026-09';
    const reqs = k.as(worker, (ctx) => [
      requestImpl(ctx, { ...base, kind: 'sale', cents: 149_00, period: sept, memo: 'Sale', sourceRef: 'order:1000001' }, workerActor),
      requestImpl(ctx, { ...base, kind: 'cogs', cents: 62_00, period: sept, memo: 'COGS', sourceRef: 'order:1000001' }, workerActor),
      requestImpl(ctx, { ...base, kind: 'leg1_authorized', cents: 104_00, period: sept, memo: 'Leg 1', sourceRef: 'order:1000001' }, workerActor),
      requestImpl(ctx, { ...base, kind: 'leg1_settled', cents: 104_00, period: sept, memo: 'Leg 1 settled', sourceRef: 'order:1000001' }, workerActor),
    ]);
    k.as(accountant, (ctx) => { for (const r of reqs) expect(prepareImpl(ctx, r, actor(ctx, 'accountant'))).toBeGreaterThan(0n); });
    const oblId = k.as(worker, (ctx) => openObligationImpl(ctx, { companyId: COMPANY, orderRef: 'order:1000001', claimRef: 'claim:C-1', decisionRef: 'D-1', tier: 'T2', category: 'MKT', sku: 'manazon-1', leg1Cents: 104_00, leg2Cents: 45_00, costCents: 62_00, openedHour: 2_000 }, workerActor));
    k.as(accountant, (ctx) => {
      accrueImpl(ctx, COMPANY, sept, workerActor, actor(ctx, 'accountant'));
      reverseImpl(ctx, COMPANY, '2026-10', workerActor, actor(ctx, 'accountant'));
      const octHour = (Date.UTC(2026, 9, 3) - SIM.epochMs) / 3_600_000;
      expect(applyReturnImpl(ctx, oblId, 'intact', octHour, SIM.epochMs, actor(ctx, 'accountant'))).toBe('released');
    });
    k.as(worker, (ctx) => {
      const lines = [...ctx.db.financeLine.companyId.filter(COMPANY)];
      const entries = [...ctx.db.financeEntry.companyId.filter(COMPANY)];
      expect(entries.every((e) => e.status === 'posted')).toBe(true);
      expect(entries.map((e) => e.kind)).toEqual(['sale', 'cogs', 'leg1_authorized', 'leg1_settled', 'accrue_leg2', 'reverse_accrual', 'leg2_authorized', 'leg2_settled', 'goods_back']);
      expect(sumBalances(trialBalance(lines.map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit) }))))).toBe(0);
      const reserve = [...ctx.db.financeReserve.companyId.filter(COMPANY)][0]!;
      expect(reserve.accruedCents).toBe(36_00n); // no history yet: the default 80% rate
      expect(reserve.trueUpCents).toBe(9_00n); // paid 45.00 against 36.00 accrued: the reserve was short
    });
  });

  it('refuses an unbalanced proposal, an entry into a locked period, editing a posted entry and self-approval, and audits each', () => {
    const k = desk();
    k.as(worker, (ctx) => { workerActor = actor(ctx, 'worker'); });
    k.as(accountant, (ctx) => { accountantIdentity = ctx.sender; });
    // unbalanced
    const r1 = k.as(worker, (ctx) => requestImpl(ctx, { ...base, kind: 'clawback', cents: 100, period: '2026-08', memo: 'x', sourceRef: 'cluster:1' }, workerActor));
    k.as(accountant, (ctx) => expect(prepareImpl(ctx, r1, actor(ctx, 'accountant'), { lines: [{ account: '1010', debit: 100, credit: 0 }, { account: '4100', debit: 0, credit: 99 }] })).toBe(0n));
    k.as(worker, (ctx) => expect(audits(ctx, 'BALANCE')).toHaveLength(1));
    // the preparer cannot also be the requester
    const r2 = k.as(accountant, (ctx) => requestImpl(ctx, { ...base, kind: 'sale', cents: 100, period: '2026-08', memo: 'x', sourceRef: 'o:1' }, actor(ctx, 'accountant')));
    k.as(accountant, (ctx) => expect(prepareImpl(ctx, r2, actor(ctx, 'accountant'))).toBe(0n));
    k.as(worker, (ctx) => expect(audits(ctx, 'SOD_THREE_IDENTITIES')).toHaveLength(1));
    // above the limit: waits for the controller; the preparer may not approve it, the controller may
    const r3 = k.as(worker, (ctx) => requestImpl(ctx, { ...base, kind: 'leg1_authorized', cents: 1_900_00, period: '2026-08', memo: 'big', sourceRef: 'o:2' }, workerActor));
    const e3 = k.as(accountant, (ctx) => prepareImpl(ctx, r3, actor(ctx, 'accountant')));
    k.as(worker, (ctx) => expect(ctx.db.financeEntry.id.find(e3)?.status).toBe('pending_approval'));
    k.as(accountant, (ctx) => approveImpl(ctx, e3, { who: ctx.sender, role: 'controller' })); // the preparer dressed as a controller
    k.as(worker, (ctx) => expect(audits(ctx, 'SELF_APPROVAL')).toHaveLength(1));
    k.as(controller, (ctx) => approveImpl(ctx, e3, actor(ctx, 'controller')));
    k.as(worker, (ctx) => expect(ctx.db.financeEntry.id.find(e3)?.status).toBe('posted'));
    // posted entries are append-only
    k.as(accountant, (ctx) => editEntryImpl(ctx, e3, actor(ctx, 'accountant')));
    k.as(worker, (ctx) => expect(audits(ctx, 'POSTED_IMMUTABLE')).toHaveLength(1));
    // close and lock August, then try to write into it
    k.as(worker, (ctx) => closeLiteImpl(ctx, COMPANY, '2026-08', workerActor, { who: accountantIdentity, role: 'accountant' }));
    k.as(controller, (ctx) => lockPeriodImpl(ctx, COMPANY, '2026-08', actor(ctx, 'controller')));
    const r4 = k.as(worker, (ctx) => requestImpl(ctx, { ...base, kind: 'leg2_authorized', cents: 45_00, period: '2026-08', memo: 'late', sourceRef: 'o:3' }, workerActor));
    k.as(accountant, (ctx) => expect(prepareImpl(ctx, r4, actor(ctx, 'accountant'))).toBe(0n));
    k.as(worker, (ctx) => {
      const refusal = audits(ctx, 'REFUSED_PERIOD_LOCKED')[0];
      expect(refusal?.detail).toContain('post to 2026-09');
    });
  });

  it('will not lock a period while a bridge line above materiality is unexplained', () => {
    const k = desk();
    k.as(worker, (ctx) => {
      ctx.db.financeClose.insert({ key: `${COMPANY}:2026-07`, companyId: COMPANY, period: '2026-07', ledgerCents: 0n, processorCents: 0n, bankCents: 0n, events: 0, matched: 0, exceptions: 1, closedByPlaybook: 0, toInvestigator: 0, toController: 1, unexplainedCents: 412_18n, status: 'blocked', source: 'book', memo: '', at: ctx.timestamp });
      ctx.db.financeBridge.insert({ id: 0n, companyId: COMPANY, period: '2026-07', cause: 'duplicate refunds', cents: 412_18n, orders: 14, winner: 'processor', why: '', explained: false, clusterId: 0n });
    });
    k.as(controller, (ctx) => lockPeriodImpl(ctx, COMPANY, '2026-07', actor(ctx, 'controller')));
    k.as(worker, (ctx) => {
      expect(audits(ctx, 'UNEXPLAINED_ABOVE_MATERIALITY')).toHaveLength(1);
      expect(ctx.db.financePeriod.key.find(`${COMPANY}:2026-07`)?.status ?? 'open').toBe('open');
    });
  });
});

describe('the 100-company portfolio', () => {
  const run = () => {
    const k = desk();
    k.as(worker, (ctx) => { for (let i = 0; i < 4; i++) advanceImpl(ctx, 24); });
    return k.as(worker, (ctx) => ({
      claims: [...ctx.db.financeSimClaim.iter()].map((c) => `${c.id}:${c.companyId}:${c.agentId}:${c.cents}:${c.tier}:${c.flagged}:${c.outcome}`),
      truth: [...ctx.db.financeSimTruth.iter()].map((t) => `${t.claimId}:${t.archetype}:${t.fraud}`),
      entries: [...ctx.db.financeEntry.iter()].length,
      hours: ctx.db.financeSimState.id.find(1)?.simHour,
    }));
  };

  it('two runs with the same seed give identical claims and identical hidden truth', () => {
    const a = run();
    const b = run();
    expect(a.hours).toBe(96);
    expect(a.claims.length).toBeGreaterThan(100);
    expect(a.claims).toEqual(b.claims);
    expect(a.truth).toEqual(b.truth);
    expect(a.entries).toBeGreaterThan(0);
  });

  it('every paid sim claim books balanced entries, and the scorer writes its rows', () => {
    const k = desk();
    k.as(worker, (ctx) => { for (let i = 0; i < 3; i++) advanceImpl(ctx, 24); scorePortfolioImpl(ctx); });
    k.as(worker, (ctx) => {
      const lines = [...ctx.db.financeLine.iter()].map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit) }));
      expect(sumBalances(trialBalance(lines))).toBe(0);
      expect(ctx.db.financeScore.key.find('detector.recall')?.value).toMatch(/%$/);
      expect([...ctx.db.financeAudit.iter()].filter((a) => a.refused)).toEqual([]);
    });
  });
});
