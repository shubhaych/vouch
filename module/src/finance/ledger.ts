// Double-entry for refund books: the posting rules, the checks every entry
// must pass, and the trial balance. Pure. The reducers in finance-ledger.ts call
// these checks before any write (that is where they are enforced); the worker
// calls the same functions for the bulk book in DuckDB, and the same RULES
// table is exported to SQL so a live refund and a bulk refund post alike.
import { ACCOUNT, A } from './accounts';
import { POLICY } from './policy';

export interface Line { account: string; debit: number; credit: number }
export interface DraftEntry { period: string; memo: string; kind: EventKind; lines: Line[] }

/** Every business event the Desk books, and the two lines it posts. Amounts are integer cents. */
export const RULES = {
  sale: { debit: A.clearing, credit: A.revenue, what: 'Sale' },
  cogs: { debit: A.cogs, credit: A.inventory, what: 'Cost of goods sold' },
  leg1_authorized: { debit: A.returns, credit: A.refundsPayable, what: 'Leg 1 authorized' },
  leg1_settled: { debit: A.refundsPayable, credit: A.clearing, what: 'Leg 1 settled' },
  accrue_leg2: { debit: A.returns, credit: A.reserve, what: 'Leg 2 accrued at close' },
  reverse_accrual: { debit: A.reserve, credit: A.returns, what: 'Accrual auto-reversed on day one' },
  leg2_authorized: { debit: A.returns, credit: A.refundsPayable, what: 'Leg 2 authorized on a verified return' },
  leg2_settled: { debit: A.refundsPayable, credit: A.clearing, what: 'Leg 2 settled' },
  goods_back: { debit: A.returned, credit: A.cogs, what: 'Goods back at cost' },
  processor_fee: { debit: A.fees, credit: A.clearing, what: 'Processor fee' },
  chargeback: { debit: A.chargebacks, credit: A.clearing, what: 'Chargeback lost' },
  clawback: { debit: A.clearing, credit: A.returns, what: 'Duplicate refund clawed back' },
  payout: { debit: A.cash, credit: A.clearing, what: 'Processor payout to bank' },
  fee_reclass: { debit: A.fees, credit: A.returns, what: 'Fee reclassified out of returns' },
} as const;
export type EventKind = keyof typeof RULES;

/** One event, one entry, two lines. */
export function post(kind: EventKind, cents: number, period: string, memo: string): DraftEntry {
  const r = RULES[kind];
  return { period, memo: memo || r.what, kind, lines: [{ account: r.debit, debit: cents, credit: 0 }, { account: r.credit, debit: 0, credit: cents }] };
}

/** Leg 2 expected cost at close: rate in basis points, rounded half up, integer cents only. */
export const accrualCents = (leg2Cents: number, rateBp: number) => Math.floor((leg2Cents * rateBp + 5_000) / 10_000);

// ---------------------------------------------------------------- checks

export type RuleId =
  | 'BALANCE' | 'NON_INTEGER' | 'UNKNOWN_ACCOUNT' | 'EMPTY_ENTRY'
  | 'REFUSED_PERIOD_LOCKED' | 'POSTED_IMMUTABLE' | 'SELF_APPROVAL' | 'SOD_THREE_IDENTITIES' | 'AUTO_POST_LIMIT' | 'ROLE';

export interface Refusal { rule: RuleId; message: string }

/** Structure: lines exist, each one side only, integer cents, known accounts, debits equal credits. */
export function checkEntry(e: Pick<DraftEntry, 'lines'>): Refusal | null {
  if (!e.lines.length) return { rule: 'EMPTY_ENTRY', message: 'an entry needs at least two lines' };
  let dr = 0;
  let cr = 0;
  for (const l of e.lines) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) return { rule: 'NON_INTEGER', message: `amounts must be whole, non-negative cents (${l.account})` };
    if ((l.debit > 0) === (l.credit > 0)) return { rule: 'NON_INTEGER', message: `each line is a debit or a credit, not both or neither (${l.account})` };
    if (!ACCOUNT[l.account]) return { rule: 'UNKNOWN_ACCOUNT', message: `no account ${l.account} in the chart of accounts` };
    dr += l.debit;
    cr += l.credit;
  }
  if (e.lines.length < 2) return { rule: 'EMPTY_ENTRY', message: 'an entry needs at least two lines' };
  if (dr !== cr) return { rule: 'BALANCE', message: `debits ${dr} do not equal credits ${cr}` };
  return null;
}

/** A locked period refuses every write; the refusal names where the entry should go instead. */
export function checkPeriod(period: string, locked: (p: string) => boolean): Refusal | null {
  if (!locked(period)) return null;
  let next = nextPeriod(period);
  for (let i = 0; i < 24 && locked(next); i++) next = nextPeriod(next);
  return { rule: 'REFUSED_PERIOD_LOCKED', message: `period ${period} is locked; post to ${next} with a prior-period memo` };
}

/** The requester, preparer and approver of a payment release are three different identities. */
export function checkRelease(requester: string, preparer: string, approver: string | null): Refusal | null {
  if (approver !== null && approver === preparer) return { rule: 'SELF_APPROVAL', message: 'the preparer cannot approve their own entry' };
  if (requester === preparer || (approver !== null && (approver === requester))) return { rule: 'SOD_THREE_IDENTITIES', message: 'requester, preparer and approver must be three different identities' };
  return null;
}

/** May this entry post with no person? Only at or under the limit, and while the period cap has room. */
export function canAutoPost(cents: number, autoPostedThisPeriod: number): boolean {
  return cents <= POLICY.autoPostLimitCents && autoPostedThisPeriod + cents <= POLICY.autoPostPeriodCapCents;
}

export const entryCents = (e: Pick<DraftEntry, 'lines'>) => e.lines.reduce((s, l) => s + l.debit, 0);

// ---------------------------------------------------------------- periods and balances

/** Periods are calendar months, 'YYYY-MM'. */
export const periodOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
export function nextPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function prevPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Signed balance per account (debit positive). A correct ledger sums to zero. */
export function trialBalance(lines: readonly Line[]): Map<string, number> {
  const tb = new Map<string, number>();
  for (const l of lines) tb.set(l.account, (tb.get(l.account) ?? 0) + l.debit - l.credit);
  return tb;
}
export const sumBalances = (tb: Map<string, number>) => [...tb.values()].reduce((s, v) => s + v, 0);
