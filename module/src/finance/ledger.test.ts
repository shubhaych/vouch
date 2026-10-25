import { describe, expect, it } from 'vitest';
import { A } from './accounts';
import { accrualCents, canAutoPost, checkEntry, checkPeriod, checkRelease, nextPeriod, post, prevPeriod, sumBalances, trialBalance, type DraftEntry } from './ledger';
import { completionRateBp, trueUpCents } from './reserve';

// The worked example from the brief, as the code books it. Maya: $149.00 sale,
// $62.00 cost, defect proven on video, tier T2: $104.00 now, $45.00 on a
// verified return. Approved late September, returned in October, rate 0.88.
function maya(): DraftEntry[] {
  const sept = '2026-09';
  const oct = '2026-10';
  return [
    post('sale', 149_00, sept, 'Sale'),
    post('cogs', 62_00, sept, 'COGS'),
    post('leg1_authorized', 104_00, sept, 'Leg 1 authorized'),
    post('leg1_settled', 104_00, sept, 'Leg 1 settled'),
    post('accrue_leg2', accrualCents(45_00, 8_800), sept, 'Accrue 0.88 x 45.00'),
    post('reverse_accrual', accrualCents(45_00, 8_800), oct, 'Auto-reverse'),
    post('leg2_authorized', 45_00, oct, 'Return scanned intact, leg 2'),
    post('leg2_settled', 45_00, oct, 'Leg 2 settled'),
    post('goods_back', 62_00, oct, 'Goods back at cost'),
  ];
}

const netIn = (entries: DraftEntry[], account: string, period?: string) =>
  entries.filter((e) => !period || e.period === period).flatMap((e) => e.lines).filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);

describe('worked example: Maya, T2, $104 now and $45 on return', () => {
  const entries = maya();

  it('every entry balances and the trial balance sums to zero', () => {
    for (const e of entries) expect(checkEntry(e)).toBeNull();
    expect(sumBalances(trialBalance(entries.flatMap((e) => e.lines)))).toBe(0);
  });

  it('accrues exactly $39.60', () => {
    expect(accrualCents(45_00, 8_800)).toBe(39_60);
  });

  it('net revenue on the order ends at $0.00', () => {
    const revenue = -netIn(entries, A.revenue);
    const returns = netIn(entries, A.returns);
    expect(revenue).toBe(149_00);
    expect(revenue - returns).toBe(0);
  });

  it('September carries $143.60 of returns and allowances, October $5.40, the reserve shortfall', () => {
    expect(netIn(entries, A.returns, '2026-09')).toBe(143_60);
    expect(netIn(entries, A.returns, '2026-10')).toBe(5_40);
    expect(trueUpCents(39_60, 45_00)).toBe(5_40);
  });

  it('the reserve and refunds payable are both back to zero', () => {
    expect(netIn(entries, A.reserve)).toBe(0);
    expect(netIn(entries, A.refundsPayable)).toBe(0);
  });
});

describe('controls', () => {
  it('refuses an unbalanced entry, fractions and unknown accounts', () => {
    expect(checkEntry({ lines: [{ account: A.returns, debit: 100, credit: 0 }, { account: A.refundsPayable, debit: 0, credit: 99 }] })?.rule).toBe('BALANCE');
    expect(checkEntry({ lines: [{ account: A.returns, debit: 1.5, credit: 0 }, { account: A.refundsPayable, debit: 0, credit: 1.5 }] })?.rule).toBe('NON_INTEGER');
    expect(checkEntry({ lines: [{ account: '9999', debit: 100, credit: 0 }, { account: A.refundsPayable, debit: 0, credit: 100 }] })?.rule).toBe('UNKNOWN_ACCOUNT');
  });

  it('refuses a locked period and names the next open one', () => {
    const locked = new Set(['2026-09', '2026-10']);
    const r = checkPeriod('2026-09', (p) => locked.has(p));
    expect(r?.rule).toBe('REFUSED_PERIOD_LOCKED');
    expect(r?.message).toContain('2026-11');
    expect(checkPeriod('2026-11', (p) => locked.has(p))).toBeNull();
  });

  it('needs three different identities to release a payment', () => {
    expect(checkRelease('engine', 'accountant', 'accountant')?.rule).toBe('SELF_APPROVAL');
    expect(checkRelease('engine', 'engine', 'controller')?.rule).toBe('SOD_THREE_IDENTITIES');
    expect(checkRelease('engine', 'accountant', 'controller')).toBeNull();
  });

  it('auto-posts only under the limit and the period cap', () => {
    expect(canAutoPost(1_000_00, 0)).toBe(true);
    expect(canAutoPost(1_000_01, 0)).toBe(false);
    expect(canAutoPost(100_00, 49_995_000)).toBe(false);
  });

  it('periods roll over the year', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(prevPeriod('2026-01')).toBe('2025-12');
  });
});

describe('reserve rates', () => {
  it('a thin segment stays near the overall rate; a thick one follows its data', () => {
    expect(completionRateBp(undefined, 8_000)).toBe(8_000);
    expect(completionRateBp({ completed: 1, resolved: 1 }, 8_000)).toBe(8_095);
    expect(completionRateBp({ completed: 500, resolved: 1_000 }, 8_000)).toBe(5_059);
  });
});
