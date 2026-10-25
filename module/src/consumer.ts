import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { asSenderError, myAgentId, nextCounter, requireRole, worldOf, type Ctx } from './ctx';
import { SHOWCASE_AGENT_ID, agentLabel, createLiveAgent, deliverNow, fileRefund, recordPurchase } from './sim';
import { REASONS } from './text';
import { BUSINESSES, CATALOG, type Category } from './world';
import { companyById } from './finance/companies';

/** Which main-world store category handles a partner category's returns (policy window, video threshold). */
const PARTNER_CATEGORY: Record<string, Category> = {
  ELEC: 'electronics', MKT: 'electronics', GEN: 'electronics', OFFICE: 'electronics', AUTO: 'electronics', MEDIA: 'electronics',
  APP: 'apparel', DEPT: 'apparel', FOOT: 'apparel', ACC: 'apparel', BAG: 'apparel', LUX: 'apparel',
  HOME: 'home', DIY: 'home', GROC: 'home', PET: 'home', BEAUTY: 'beauty', ATH: 'sporting goods', OUT: 'sporting goods', TOY: 'toys',
};

/** Buys one partner product: a main-world purchase at the partner's price, plus the partner_order row naming the real product. */
export function buyPartnerFor(ctx: Ctx, agentId: number, companyId: number, sku: string) {
  const company = companyById(companyId);
  const product = company?.products.find((p) => p.sku === sku);
  if (!company || !product) throw new SenderError('unknown partner product');
  const category = PARTNER_CATEGORY[company.category] ?? 'electronics';
  const store = BUSINESSES.find((b) => b.category === category)!;
  const standIn = CATALOG.find((c) => c.category === category)!;
  const p = buyFor(ctx, agentId, store.id, standIn.sku, 'live');
  const row = ctx.db.purchase.id.find(p.id)!;
  ctx.db.purchase.id.update({ ...row, amount: product.priceCents });
  ctx.db.partnerOrder.insert({ purchaseId: p.id, companyId, companyName: company.name, sku, name: product.name, description: product.description, priceCents: product.priceCents });
  return p;
}

// The judge as a shopper: join, buy, fast-forward to the refund window and
// file a claim. The same functions let the worker play the showcase agent
// A-00421 for the home page's live demo.

export function joinImpl(ctx: Ctx, name: string) {
  if (ctx.db.shopperLink.who.find(ctx.sender)) return; // already has an agent
  const w = worldOf(ctx);
  const n = Number(nextCounter(ctx, 'live_agent'));
  const a = asSenderError(() => createLiveAgent(w, n));
  ctx.db.shopperLink.insert({ who: ctx.sender, agentId: a.id, name: name.slice(0, 40) });
  w.commit();
}

/** Creates a live agent for this identity, starting at 600. */
export const joinAsShopper = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => joinImpl(ctx, name));

export function buyFor(ctx: Ctx, agentId: number, businessId: number, sku: number, source: string) {
  const w = worldOf(ctx);
  const p = asSenderError(() => recordPurchase(w, agentId, businessId, sku, source, 0));
  w.commit();
  return p;
}

export function fastForwardFor(ctx: Ctx, agentId: number, purchaseId: bigint) {
  const p = ctx.db.purchase.id.find(purchaseId);
  if (!p || p.buyer !== agentId) throw new SenderError('not your purchase');
  const w = worldOf(ctx);
  asSenderError(() => deliverNow(w, p));
  w.commit();
}

const randomHex = (ctx: Ctx, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(ctx.random() * 16).toString(16);
  return s;
};

export function requestRefundFor(ctx: Ctx, agentId: number, purchaseId: bigint, reasonCode: string, reasonText: string) {
  const p = ctx.db.purchase.id.find(purchaseId);
  if (!p || p.buyer !== agentId) throw new SenderError('not your purchase');
  if (!(REASONS as readonly string[]).includes(reasonCode)) throw new SenderError('unknown reason');
  const w = worldOf(ctx);
  const r = asSenderError(() => fileRefund(w, p, reasonCode, reasonText.slice(0, 500), p.source, 'investigation'));
  // A fresh nonce and a finger-count challenge make a pre-recorded video harder to reuse.
  const c = ctx.db.claim.insert({
    id: 0n, refundId: r.id, agentId, nonce: randomHex(ctx, 12), fingerCount: 1 + Math.floor(ctx.random() * 5), videoUrl: '',
    frameUrls: [], frameHashes: [], checksJson: '{}', status: 'awaiting_video', kind: p.source === 'showcase' ? 'showcase' : 'live', createdAt: ctx.timestamp,
  });
  w.feed('claim', agentId, p.business, p.amount, c.id, `[Claim] C-${c.id} opened by ${agentLabel(agentId)}: hold up ${c.fingerCount} fingers at the end`);
  w.commit();
  return c;
}

export const buy = spacetimedb.reducer({ businessId: t.u16(), sku: t.u16() }, (ctx, a) => {
  buyFor(ctx, myAgentId(ctx), a.businessId, a.sku, 'live');
});

export const buyPartner = spacetimedb.reducer({ companyId: t.u16(), sku: t.string() }, (ctx, a) => {
  buyPartnerFor(ctx, myAgentId(ctx), a.companyId, a.sku);
});

/** Marks the purchase delivered and inside its refund window, so the judge does not wait. */
export const fastForward = spacetimedb.reducer({ purchaseId: t.u64() }, (ctx, { purchaseId }) => {
  fastForwardFor(ctx, myAgentId(ctx), purchaseId);
});

export const requestRefund = spacetimedb.reducer(
  { purchaseId: t.u64(), reasonCode: t.string(), reasonText: t.string() },
  (ctx, a) => {
    requestRefundFor(ctx, myAgentId(ctx), a.purchaseId, a.reasonCode, a.reasonText);
  },
);

/** The worker plays the showcase agent A-00421 through the same code paths. */
export const showcaseAct = spacetimedb.reducer(
  { action: t.string(), businessId: t.u16(), sku: t.u16(), purchaseId: t.u64(), reasonCode: t.string(), reasonText: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (a.action === 'buy') buyFor(ctx, SHOWCASE_AGENT_ID, a.businessId, a.sku, 'showcase');
    else if (a.action === 'deliver') fastForwardFor(ctx, SHOWCASE_AGENT_ID, a.purchaseId);
    else if (a.action === 'refund') requestRefundFor(ctx, SHOWCASE_AGENT_ID, a.purchaseId, a.reasonCode, a.reasonText);
    else throw new SenderError('action must be buy, deliver or refund');
  },
);
