import { describe, expect, it } from 'vitest';
import { SenderError } from 'spacetimedb/server';
import { harness, who } from './testkit';
import { recordCrsCallImpl, recordIdentityScreeningImpl, recordSimScreeningsImpl, type ScreeningArgs } from './identity';

const worker = who('worker');
const shopper = who('shopper');

function setup() {
  const k = harness();
  k.as(worker, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'desk-lead', businessId: 0 }));
  return k;
}

const clean: ScreeningArgs = {
  claimId: 7n, refundId: 9n, agentId: 900001, personaId: 'P01', trigger: 'thin_history', source: 'sandbox', cached: false,
  contactRiskScore: 11, contactRiskBand: 'low', identityStatus: 'match', messageCodes: '[]', route: 'refund_investigator',
  reasonsJson: JSON.stringify(['Contact risk 11 is below 70', 'No identity discrepancies returned']), errorsJson: '[]', latencyMs: 412,
};

const refused = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof SenderError ? (e as Error).message : `not a SenderError: ${String(e)}`; }
  return 'accepted';
};

describe('CRS identity screening rows', () => {
  it('only the worker records screenings and CRS calls', () => {
    const k = setup();
    expect(refused(() => k.as(shopper, (ctx) => recordIdentityScreeningImpl(ctx, clean)))).toMatch(/requires role/);
    expect(refused(() => k.as(shopper, (ctx) => recordCrsCallImpl(ctx, { product: 'fraud_finder', status: 200, latencyMs: 90, source: 'sandbox' })))).toMatch(/requires role/);
  });

  it('a screening row is redacted: persona id, bands, codes and route, and the totals move', () => {
    const k = setup();
    k.as(worker, (ctx) => recordIdentityScreeningImpl(ctx, clean));
    k.as(worker, (ctx) => recordIdentityScreeningImpl(ctx, { ...clean, personaId: 'P12', contactRiskScore: 85, contactRiskBand: 'review', identityStatus: 'discrepancy', messageCodes: '["2201","2101"]', route: 'merchant_identity_review', cached: true }));
    const rows = [...k.db.identityScreening.iter()];
    expect(rows).toHaveLength(2);
    // No column can hold an SSN, a birth date, an email or a raw vendor payload.
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'agentId', 'cached', 'checkedAt', 'claimId', 'contactRiskBand', 'contactRiskScore', 'errorsJson', 'id', 'identityStatus',
      'latencyMs', 'messageCodes', 'personaId', 'reasonsJson', 'refundId', 'route', 'source', 'trigger',
    ]);
    const s = k.db.crsStat.id.find(1)!;
    expect(s.screenings).toBe(2n);
    expect(s.cachedScreenings).toBe(1n);
    expect(JSON.parse(s.routesJson)).toEqual({ refund_investigator: 1, merchant_identity_review: 1 });
  });

  it('refuses anything that is not a scripted persona, a known route or a short message code', () => {
    const k = setup();
    const w = (a: Partial<ScreeningArgs>) => refused(() => k.as(worker, (ctx) => recordIdentityScreeningImpl(ctx, { ...clean, ...a })));
    expect(w({ personaId: 'Jane Doe' })).toMatch(/personaId/);
    expect(w({ route: 'decline' })).toMatch(/route/);
    expect(w({ messageCodes: '[{"code":"2101","ssn":"123-45-6789"}]' })).toMatch(/messageCodes/);
    expect(w({ reasonsJson: JSON.stringify(['SSN 123-45-6789 matched']) })).toMatch(/identity data/);
    expect(w({ reasonsJson: JSON.stringify(['born 1985-04-12']) })).toMatch(/identity data/);
    expect(w({ contactRiskScore: 140 })).toMatch(/0\.\.100/);
    expect(k.db.identityScreening.count()).toBe(0n);
  });

  it('meters every CRS request by product and keeps the last health answer', () => {
    const k = setup();
    k.as(worker, (ctx) => recordCrsCallImpl(ctx, { product: 'login', status: 200, latencyMs: 300, source: 'sandbox' }));
    k.as(worker, (ctx) => recordCrsCallImpl(ctx, { product: 'fraud_finder', status: 200, latencyMs: 120, source: 'sandbox' }));
    k.as(worker, (ctx) => recordCrsCallImpl(ctx, { product: 'truvalidate_basic', status: 502, latencyMs: 2000, source: 'sandbox' }));
    k.as(worker, (ctx) => recordCrsCallImpl(ctx, { product: 'health', status: 200, latencyMs: 40, source: 'sandbox' }));
    const s = k.db.crsStat.id.find(1)!;
    expect(s.calls).toBe(4n);
    expect(s.failedCalls).toBe(1n);
    expect(s.lastHealthStatus).toBe(200);
    expect(JSON.parse(s.productsJson)).toEqual({ login: 1, fraud_finder: 1, truvalidate_basic: 1, health: 1 });
    expect(refused(() => k.as(worker, (ctx) => recordCrsCallImpl(ctx, { product: 'credit_report', status: 200, latencyMs: 1, source: 'sandbox' })))).toMatch(/product/);
  });

  it('adds the simulation\'s screened refunds to the totals', () => {
    const k = setup();
    k.as(worker, (ctx) => recordSimScreeningsImpl(ctx, { refunds: 120, routesJson: JSON.stringify({ refund_investigator: 108, merchant_identity_review: 8, additional_verification: 4 }) }));
    k.as(worker, (ctx) => recordSimScreeningsImpl(ctx, { refunds: 10, routesJson: JSON.stringify({ refund_investigator: 10 }) }));
    const s = k.db.crsStat.id.find(1)!;
    expect(s.simRefundsScreened).toBe(130n);
    expect(JSON.parse(s.simRoutesJson)).toEqual({ refund_investigator: 118, merchant_identity_review: 8, additional_verification: 4 });
    expect(refused(() => k.as(worker, (ctx) => recordSimScreeningsImpl(ctx, { refunds: 1, routesJson: '{"auto_decline":1}' })))).toMatch(/route/);
  });
});
