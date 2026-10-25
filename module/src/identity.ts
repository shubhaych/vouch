import { SenderError, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, type Ctx } from './ctx';

// The worker screens each real claim's shopper with CRS and records the redacted result here,
// so the business page and the agents read the same identity input. One row per claim.

const ROUTES = ['refund_investigator', 'merchant_identity_review', 'additional_verification'];
const PERSONAS = ['P01', 'P12', 'P13', 'P16'];

export interface IdentityScreeningArgs {
  claimId: bigint; personaId: string; source: string; contactRiskScore: number; contactRiskBand: string; identityStatus: string;
  messageCodes: string[]; route: string; reasonsJson: string; failed: boolean;
}

export function recordIdentityScreeningImpl(ctx: Ctx, a: IdentityScreeningArgs) {
  requireRole(ctx, 'worker');
  const claim = ctx.db.claim.id.find(a.claimId);
  if (!claim) throw new SenderError('no such claim');
  // Only the four sandbox personas: anything else would mean real or invented personal data reached CRS.
  if (!PERSONAS.includes(a.personaId)) throw new SenderError(`unknown CRS persona ${a.personaId}`);
  if (!ROUTES.includes(a.route)) throw new SenderError(`unknown route ${a.route}`);
  JSON.parse(a.reasonsJson); // refuse malformed reasons
  const row = { ...a, agentId: claim.agentId, checkedAt: ctx.timestamp };
  if (ctx.db.identityScreening.claimId.find(a.claimId)) ctx.db.identityScreening.claimId.update(row);
  else ctx.db.identityScreening.insert(row);
}

export const recordIdentityScreening = spacetimedb.reducer(
  {
    claimId: t.u64(), personaId: t.string(), source: t.string(), contactRiskScore: t.i32(), contactRiskBand: t.string(), identityStatus: t.string(),
    messageCodes: t.array(t.string()), route: t.string(), reasonsJson: t.string(), failed: t.bool(),
  },
  (ctx, a) => recordIdentityScreeningImpl(ctx, a),
);
