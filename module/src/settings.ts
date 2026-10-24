import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole } from './desk';

const upsertConfig = (ctx: { db: any; timestamp: any }, key: string, value: string) => {
  const row = ctx.db.config.key.find(key);
  if (row) ctx.db.config.key.update({ ...row, value, updatedAt: ctx.timestamp });
  else ctx.db.config.insert({ key, value, updatedAt: ctx.timestamp });
};
export { upsertConfig };

/** The kill switch. Off: every new case drops to lane C, "underwriter offline". */
export const setCreaoEnabled = spacetimedb.reducer({ enabled: t.bool() }, (ctx, { enabled }) => {
  requireRole(ctx, 'controller');
  upsertConfig(ctx, 'creao_enabled', enabled ? 'true' : 'false');
});

/** The merchant's policy and risk dial. One editable object (MerchantPolicy). */
export const setMerchantPolicy = spacetimedb.reducer(
  { merchantId: t.string(), policyJson: t.string() },
  (ctx, { merchantId, policyJson }) => {
    requireRole(ctx, 'controller');
    JSON.parse(policyJson); // refuse malformed policy
    const row = ctx.db.merchantPolicy.merchantId.find(merchantId);
    if (row) ctx.db.merchantPolicy.merchantId.update({ ...row, policyJson, updatedAt: ctx.timestamp });
    else ctx.db.merchantPolicy.insert({ merchantId, policyJson, updatedAt: ctx.timestamp });
  });
