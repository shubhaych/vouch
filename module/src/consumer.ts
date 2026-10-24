import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { myAgentId, nextCounter, requireRole, worldOf, type Ctx } from './ctx';
import { SHOWCASE_AGENT_ID, agentLabel, createLiveAgent, deliverNow, fileRefund, recordPurchase } from './sim';
import { REASONS } from './text';

// The judge as a shopper: join, buy, fast-forward to the refund window and
// file a claim. The same functions let the worker play the showcase agent
// A-00421 for the home page's live demo.

export function joinImpl(ctx: Ctx, name: string) {
  if (ctx.db.shopperLink.who.find(ctx.sender)) return; // already has an agent
  const w = worldOf(ctx);
  const n = Number(nextCounter(ctx, 'live_agent'));
  const a = createLiveAgent(w, n);
  ctx.db.shopperLink.insert({ who: ctx.sender, agentId: a.id, name: name.slice(0, 40) });
  w.commit();
}

/** Creates a live agent for this identity, starting at 600. */
export const joinAsShopper = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => joinImpl(ctx, name));

export function buyFor(ctx: Ctx, agentId: number, businessId: number, sku: number, source: string) {
  const w = worldOf(ctx);
  const p = recordPurchase(w, agentId, businessId, sku, source, 0);
  w.commit();
  return p;
}

export function fastForwardFor(ctx: Ctx, agentId: number, purchaseId: bigint) {
  const p = ctx.db.purchase.id.find(purchaseId);
  if (!p || p.buyer !== agentId) throw new Error('not your purchase');
  const w = worldOf(ctx);
  deliverNow(w, p);
  w.commit();
}

const randomHex = (ctx: Ctx, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(ctx.random() * 16).toString(16);
  return s;
};

export function requestRefundFor(ctx: Ctx, agentId: number, purchaseId: bigint, reasonCode: string, reasonText: string) {
  const p = ctx.db.purchase.id.find(purchaseId);
  if (!p || p.buyer !== agentId) throw new Error('not your purchase');
  if (!(REASONS as readonly string[]).includes(reasonCode)) throw new Error('unknown reason');
  const w = worldOf(ctx);
  const r = fileRefund(w, p, reasonCode, reasonText.slice(0, 500), p.source, 'investigation');
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
    else throw new Error('action must be buy, deliver or refund');
  },
);
