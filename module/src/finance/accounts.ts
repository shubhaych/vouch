// The chart of accounts for every partner company's refund book. Small on
// purpose: the Desk books refunds, their obligations and the cash that moves,
// nothing else. Pure (no spacetimedb import): shared by reducers, worker and web.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'contra_revenue' | 'expense';

export interface Account { code: string; name: string; type: AccountType; note: string }

export const ACCOUNTS: readonly Account[] = [
  { code: '1000', name: 'Cash (bank)', type: 'asset', note: 'What the bank says we hold.' },
  { code: '1010', name: 'Processor clearing', type: 'asset', note: 'Cash at the payment processor, not yet paid out to the bank.' },
  { code: '1200', name: 'Inventory', type: 'asset', note: 'Goods on hand at cost.' },
  { code: '1210', name: 'Returned goods', type: 'asset', note: 'Returns received and inspected, at cost.' },
  { code: '2100', name: 'Refunds payable', type: 'liability', note: 'Refunds authorized and not yet settled by the processor.' },
  { code: '2150', name: 'Refund reserve', type: 'liability', note: 'Month-end estimate of second legs expected to be paid; reversed on day one.' },
  { code: '3000', name: 'Retained earnings', type: 'equity', note: 'Closed periods.' },
  { code: '4000', name: 'Product revenue', type: 'revenue', note: 'Gross sales.' },
  { code: '4100', name: 'Sales returns and allowances', type: 'contra_revenue', note: 'Refunds reduce revenue here, not in 4000.' },
  { code: '5000', name: 'COGS', type: 'expense', note: 'Cost of goods sold.' },
  { code: '5100', name: 'Processor fees', type: 'expense', note: 'Fees are not returned on a refund.' },
  { code: '5200', name: 'Chargeback losses', type: 'expense', note: 'Disputes the business lost.' },
];

export const ACCOUNT = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a])) as Record<string, Account>;
export const accountName = (code: string) => ACCOUNT[code]?.name ?? code;

// Codes by role, so posting rules read as accounting rather than as numbers.
export const A = {
  cash: '1000', clearing: '1010', inventory: '1200', returned: '1210',
  refundsPayable: '2100', reserve: '2150', retained: '3000',
  revenue: '4000', returns: '4100', cogs: '5000', fees: '5100', chargebacks: '5200',
} as const;
