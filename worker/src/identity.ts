// CRS identity screening for a real claim's shopper (docs/CRS.md). Simulated shoppers never get
// identity data of their own: each is mapped onto one of the four CRS sandbox personas, and only
// the redacted result is stored (identity_screening) for the business page and the agents.
import type { DbConnection } from '../module_bindings/index';
import type { Claim, IdentityScreening as ScreeningRow } from '../module_bindings/types';
import { sandboxReady, screen, type PersonaId } from './crs';
import { config, log } from './env';
import { call } from './stdb';

/** Deterministic and mostly clean, like real returns: about 85% P01, 5% each for P12, P13 and P16. */
export function personaFor(agentId: number): PersonaId {
  const n = Math.imul(agentId, 2654435761) >>> 0; // spread neighbouring ids so live shoppers do not share a persona
  const slot = n % 20;
  return slot === 0 ? 'P12' : slot === 1 ? 'P13' : slot === 2 ? 'P16' : 'P01';
}

/**
 * A stored screening is kept unless it failed, or it is a fixture and the sandbox can now answer. A sandbox answer is
 * always kept: it is a real API response, and the personas answer from a script, so asking again would only spend calls.
 */
export function keepScreening(row: ScreeningRow | undefined, sandboxUsable = config.crs.mode === 'sandbox' && !sandboxReady()): boolean {
  return !!row && !row.failed && (row.source === 'sandbox' || !sandboxUsable);
}

/** Screens the claim's shopper once and records it; later calls return the stored row. Null when CRS could not answer. */
export async function screenClaim(conn: DbConnection, c: Claim): Promise<ScreeningRow | null> {
  const have = conn.db.identityScreening.claimId.find(c.id);
  if (have && keepScreening(have)) return have;
  const persona = personaFor(c.agentId);
  try {
    const s = await screen(persona);
    await call('recordIdentityScreening', conn.reducers.recordIdentityScreening({
      claimId: c.id, personaId: s.personaId, source: s.source, contactRiskScore: s.contactRiskScore ?? -1, contactRiskBand: s.contactRiskBand,
      identityStatus: s.identityStatus, messageCodes: s.messages.map((m) => m.code), route: s.route, reasonsJson: JSON.stringify(s.reasons), failed: s.errors.length > 0,
    }));
    log(`C-${c.id}: CRS ${s.source} ${persona} → ${s.route}`);
    return conn.db.identityScreening.claimId.find(c.id) ?? null;
  } catch (e) {
    log(`C-${c.id}: CRS screening unavailable: ${(e as Error).message}`);
    return null;
  }
}

/** What the agents read: the route and the signals behind it, never persona details. */
export function identityCase(row: ScreeningRow | null | undefined) {
  if (!row) return { status: 'not_run', reason: 'CRS could not screen this shopper; identity is unknown, which is not a reason for caution' };
  return {
    status: row.failed ? 'unavailable' : 'screened',
    source: row.source === 'sandbox' ? 'CRS sandbox' : 'CRS fixture',
    route: row.route,
    contact_risk_score: row.contactRiskScore < 0 ? null : row.contactRiskScore,
    contact_risk_band: row.contactRiskBand,
    identity_status: row.identityStatus,
    message_codes: row.messageCodes,
    reasons: JSON.parse(row.reasonsJson) as string[],
    // Keeps the identity question apart from the item question.
    note: 'Routes identity verification only. A discrepancy is a reason for a person to look, never proof that the return is improper.',
  };
}
