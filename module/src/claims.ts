import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole } from './desk';
import { decide as decideLane } from './policy';
import { DEFAULT_POLICY, type MerchantPolicy, type Tier } from './types';

const MERCHANT_ID = 'threadline';

const loadPolicy = (ctx: { db: any }): MerchantPolicy => {
  const row = ctx.db.merchantPolicy.merchantId.find(MERCHANT_ID);
  return row ? (JSON.parse(row.policyJson) as MerchantPolicy) : DEFAULT_POLICY;
};

/** Fail closed: a missing row counts as off. */
export const creaoEnabled = (ctx: { db: any }): boolean =>
  ctx.db.config.key.find('creao_enabled')?.value === 'true';

/**
 * A shopper files a claim. "Spending trust is a lookup": the lane comes from
 * the stored Vouch Record, never from an agent run. A subject with no record
 * (or an expired one) is tier 0, lands in lane C, and the worker starts the
 * Credit Analyst. The worker may escalate later (duplicate photo, Refund Desk).
 */
export const submitClaim = spacetimedb.reducer(
  { subjectId: t.string(), orderId: t.u64(), amountCents: t.u32(), kind: t.string() },
  (ctx, { subjectId, orderId, amountCents, kind }) => {
    const rec = ctx.db.vouchRecord.subjectId.find(subjectId);
    const expired = !rec || rec.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch;
    const tier = (rec && !expired ? rec.tier : 0) as Tier;
    let incident = false;
    for (const i of ctx.db.incident.iter()) if (i.subjectId === subjectId) { incident = true; break; }

    const d = decideLane(
      tier,
      { verdict: 'not_contested' },
      { incident, underwriterOffline: !creaoEnabled(ctx), recordExpired: !!rec && expired },
      { amountCents },
      loadPolicy(ctx),
    );
    ctx.db.claim.insert({
      id: 0n, orderId, subjectId, amountCents, kind,
      status: d.lane === 'A' || d.lane === 'B' ? 'decided' : 'held',
      lane: d.lane, reasonCodes: d.reasons, provenance: 'live', createdAt: ctx.timestamp,
    });
  });

/** The Desk Lead (worker) moves a claim after the Refund Desk or a photo-hash hit. */
export const setClaimLane = spacetimedb.reducer(
  { claimId: t.u64(), lane: t.string(), reasonCodes: t.array(t.string()) },
  (ctx, { claimId, lane, reasonCodes }) => {
    requireRole(ctx, 'router');
    if (!['A', 'B', 'C', 'D'].includes(lane)) throw new Error('lane must be A, B, C or D');
    const row = ctx.db.claim.id.find(claimId);
    if (!row) throw new Error('no such claim');
    ctx.db.claim.id.update({ ...row, lane, reasonCodes, status: lane === 'A' || lane === 'B' ? 'decided' : 'held' });
  });
