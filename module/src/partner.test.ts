import { describe, expect, it } from 'vitest';
import { harness, who } from './testkit';
import { seedWorldImpl } from './economy';
import { buyPartnerFor, fastForwardFor, joinImpl, requestRefundFor } from './consumer';
import { myAgentId } from './ctx';

// A partner company's product is bought through a main-world store of the same
// category, at the partner's price, and the partner_order row names the real product
// (the reviewer's ground truth). The ordinary return flow then works on it.
describe('partner products', () => {
  it('buys at the partner price, records the real product, and can be returned', () => {
    const k = harness();
    const worker = who('worker');
    const shopper = who('shopper');
    k.as(worker, (ctx) => ctx.db.role.insert({ who: ctx.sender, role: 'worker', label: 'w', businessId: 0 }));
    k.as(worker, (ctx) => seedWorldImpl(ctx, 11n, 600, false));
    k.as(shopper, (ctx) => joinImpl(ctx, 'Judge'));
    const p = k.as(shopper, (ctx) => buyPartnerFor(ctx, myAgentId(ctx), 2, 'corner-current-2'));
    k.as(shopper, (ctx) => {
      expect(ctx.db.purchase.id.find(p.id)?.amount).toBe(8999);
      const o = ctx.db.partnerOrder.purchaseId.find(p.id)!;
      expect([o.companyName, o.name, o.description]).toEqual(['Corner Current', 'Full-size mechanical keyboard', 'Full-size 104-key mechanical keyboard with number pad, black, wired USB-C.']);
      fastForwardFor(ctx, myAgentId(ctx), p.id);
      requestRefundFor(ctx, myAgentId(ctx), p.id, 'not_as_described', 'Wrong colour');
      expect([...ctx.db.claim.iter()].some((c) => [...ctx.db.refund.iter()].some((r) => r.purchaseId === p.id && r.id === c.refundId))).toBe(true);
    });
  });
});
