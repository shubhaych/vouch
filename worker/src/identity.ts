// The identity desk: when Vouch asks CRS "do this shopper's identity and contact details need
// more verification?", how the answer is recorded, and how every CRS request is metered.
//
// The use case, in one line: a refund paid before the item comes back is an advance, and the
// shoppers it is riskiest to advance to are the ones Vouch knows least about. So a claim from a
// thin-history shopper, one without a verified Vouch credential, or one above the store's
// auto-approve limit gets a CRS identity step-up (AtData Fraud Finder + TransUnion TruValidate)
// before any investigator runs. A clean match lets an honest first-time shopper count as
// verified; a discrepancy sends identity to a person, separately from the item; a fraud alert
// asks for step-up proof. CRS never approves or declines a refund (docs/CRS.md).
import type { DbConnection } from '../module_bindings/index';
import { config, log } from './env';
import { call } from './stdb';
import { health, personaFor, screenWithMeta, setCrsMeter, type IdentityScreening, type PersonaId } from './crs';

export type StepUpTrigger = 'thin_history' | 'over_limit' | 'no_credential' | 'showcase' | 'manual';

export interface StepUpFacts {
  kind: string; // live | showcase | simulated (claim.kind)
  amountCents: number;
  autoApproveLimitCents: number;
  purchasesCompleted: number;
  accountAgeDays: number;
  credentialVerified: boolean;
}

// Below these a shopper's own history cannot carry a refund advance on its own.
export const THIN_PURCHASES = 3;
export const THIN_DAYS = 30;

/**
 * Which claims get the CRS step-up. Established shoppers with a verified credential and a
 * claim under the store's limit are not screened at all: no reason to query identity data.
 */
export function stepUpTrigger(f: StepUpFacts): StepUpTrigger | null {
  if (f.kind === 'showcase') return 'showcase';
  if (f.amountCents > f.autoApproveLimitCents) return 'over_limit';
  if (f.purchasesCompleted < THIN_PURCHASES || f.accountAgeDays < THIN_DAYS) return 'thin_history';
  if (!f.credentialVerified) return 'no_credential';
  return null;
}

/** What the investigators read: a redacted screening, or why there is none. */
export type CaseIdentity =
  | {
    status: 'screened'; provider: 'CRS'; products: string[]; persona: string; source: string; trigger: string; route: string;
    contact_risk_score: number | null; contact_risk_band: string; identity_status: string; message_codes: string[]; reasons: string[]; checked_at: string;
  }
  | { status: 'not_run'; reason: string };

interface ScreeningRow {
  personaId: string; source: string; trigger: string; route: string; contactRiskScore: number; contactRiskBand: string; identityStatus: string;
  messageCodes: string; reasonsJson: string; checkedAt: { toDate(): Date };
}

export function caseIdentity(row: ScreeningRow | undefined, reasonIfNone: string): CaseIdentity {
  if (!row) return { status: 'not_run', reason: reasonIfNone };
  return {
    status: 'screened', provider: 'CRS', products: ['AtData Fraud Finder', 'TransUnion TruValidate (basic)'],
    persona: row.personaId, source: row.source, trigger: row.trigger, route: row.route,
    contact_risk_score: row.contactRiskScore < 0 ? null : row.contactRiskScore, contact_risk_band: row.contactRiskBand,
    identity_status: row.identityStatus, message_codes: JSON.parse(row.messageCodes || '[]') as string[],
    reasons: JSON.parse(row.reasonsJson || '[]') as string[], checked_at: row.checkedAt.toDate().toISOString(),
  };
}

/** Only a clean match counts as a verified identity; anything else is "unverified", never "suspicious". */
export const identityVerified = (id: CaseIdentity) => id.status === 'screened' && id.route === 'refund_investigator';

const SIM_EVERY_MS = 30_000;
const HEALTH_EVERY_MS = 5 * 60_000;

export class IdentityDesk {
  private simCursor = 0n;
  private timers: NodeJS.Timeout[] = [];

  constructor(private conn: DbConnection) {}

  start() {
    // Every request to CRS becomes a crs_call row: product, HTTP status, latency. Never the payload.
    setCrsMeter((m) => void call('recordCrsCall', this.conn.reducers.recordCrsCall({ product: m.product, status: m.status, latencyMs: Math.min(m.latencyMs, 4_000_000_000), source: 'sandbox' })));
    // Start the simulation cursor at today's newest refund: the economy's history is not re-screened.
    for (const r of this.conn.db.refund.iter()) if (r.id > this.simCursor) this.simCursor = r.id;
    this.timers.push(setInterval(() => void this.screenSimulated().catch((e) => log(`identity: simulation batch failed: ${(e as Error).message}`)), SIM_EVERY_MS));
    if (config.crs.mode === 'sandbox') {
      void health();
      this.timers.push(setInterval(() => void health(), HEALTH_EVERY_MS));
    }
    log(`identity desk started (CRS_MODE=${config.crs.mode}${config.crs.mode === 'sandbox' && !config.crs.configured ? ', sandbox credentials missing' : ''})`);
  }

  stop() { for (const t of this.timers) clearInterval(t); setCrsMeter(null); }

  /** The newest screening recorded for a refund, if any. */
  latest(refundId: bigint): ScreeningRow | undefined {
    let best: (ScreeningRow & { id: bigint }) | undefined;
    for (const r of this.conn.db.identityScreening.refundId.filter(refundId)) if (!best || r.id > best.id) best = r;
    return best;
  }

  /** The case field for the investigators: the latest screening, or the reason none ran. */
  forRefund(refundId: bigint): CaseIdentity {
    return caseIdentity(this.latest(refundId), 'No step-up was needed: an established shopper with a verified credential, under the store limit.');
  }

  /**
   * The step-up decision and the screening in one call, shared by the video reviewer and the
   * Desk Lead. A refund screened once is not screened again; one that needs no step-up says why.
   */
  async stepUp(a: {
    claimId: bigint; refund: { id: bigint; agentId: number; amount: number }; kind: string; autoApproveLimitCents: number;
    history: { purchases_completed: number; account_age_days: number }; credentialVerified: boolean;
  }): Promise<CaseIdentity> {
    const done = this.latest(a.refund.id);
    if (done) return caseIdentity(done, '');
    const trigger = stepUpTrigger({
      kind: a.kind, amountCents: a.refund.amount, autoApproveLimitCents: a.autoApproveLimitCents,
      purchasesCompleted: a.history.purchases_completed, accountAgeDays: a.history.account_age_days, credentialVerified: a.credentialVerified,
    });
    if (!trigger) return this.forRefund(a.refund.id);
    return this.screenRefund({ refundId: a.refund.id, claimId: a.claimId, agentId: a.refund.agentId, trigger });
  }

  /**
   * Screens the shopper behind a refund through their mapped sandbox persona and records the
   * redacted result. Fails soft: a CRS outage becomes "additional verification", never a red flag.
   */
  async screenRefund(a: { refundId: bigint; claimId: bigint; agentId: number; trigger: StepUpTrigger; persona?: PersonaId }): Promise<CaseIdentity> {
    const persona = a.persona ?? personaFor(a.agentId);
    let res: { screening: IdentityScreening; cached: boolean; latencyMs: number };
    try {
      res = await screenWithMeta(persona);
    } catch (e) {
      log(`identity: CRS screening for R-${a.refundId} failed: ${(e as Error).message}`);
      return { status: 'not_run', reason: 'The CRS screening could not run; identity was not checked (never treated as risk).' };
    }
    const s = res.screening;
    await call('recordIdentityScreening', this.conn.reducers.recordIdentityScreening({
      claimId: a.claimId, refundId: a.refundId, agentId: a.agentId, personaId: s.personaId, trigger: a.trigger, source: s.source, cached: res.cached,
      contactRiskScore: s.contactRiskScore ?? -1, contactRiskBand: s.contactRiskBand, identityStatus: s.identityStatus,
      messageCodes: JSON.stringify(s.messages.map((m) => m.code).filter((c) => /^[0-9A-Z]{1,8}$/.test(c))),
      route: s.route, reasonsJson: JSON.stringify(s.reasons), errorsJson: JSON.stringify(s.errors), latencyMs: res.latencyMs,
    }));
    log(`identity: R-${a.refundId} (${a.trigger}) screened as ${s.personaId} via CRS ${s.source}${res.cached ? ' (cached)' : ''}: route ${s.route}`);
    return caseIdentity(this.latest(a.refundId) ?? {
      personaId: s.personaId, source: s.source, trigger: a.trigger, route: s.route, contactRiskScore: s.contactRiskScore ?? -1, contactRiskBand: s.contactRiskBand,
      identityStatus: s.identityStatus, messageCodes: JSON.stringify(s.messages.map((m) => m.code)), reasonsJson: JSON.stringify(s.reasons), checkedAt: { toDate: () => new Date(s.checkedAt) },
    }, '');
  }

  /**
   * The simulation at scale: each new investigation-path refund in the economy is mapped onto a
   * persona and routed by that persona's screening. The cache means at most four CRS requests
   * per ten minutes however many simulated refunds arrive; only route counts are stored.
   */
  async screenSimulated(): Promise<{ refunds: number; routes: Record<string, number> }> {
    // Only real sandbox answers are counted at scale; fixture mode would make the totals fiction.
    if (!config.crs.configured) return { refunds: 0, routes: {} };
    const fresh = [...this.conn.db.refund.iter()].filter((r) => r.id > this.simCursor && r.source === 'sim' && r.path === 'investigation');
    for (const r of this.conn.db.refund.iter()) if (r.id > this.simCursor) this.simCursor = r.id;
    if (!fresh.length) return { refunds: 0, routes: {} };
    const byPersona = new Map<PersonaId, number>();
    for (const r of fresh) { const p = personaFor(r.agentId); byPersona.set(p, (byPersona.get(p) ?? 0) + 1); }
    const routes: Record<string, number> = {};
    for (const [p, n] of byPersona) {
      const { screening } = await screenWithMeta(p);
      routes[screening.route] = (routes[screening.route] ?? 0) + n;
    }
    await call('recordSimScreenings', this.conn.reducers.recordSimScreenings({ refunds: fresh.length, routesJson: JSON.stringify(routes) }));
    return { refunds: fresh.length, routes };
  }
}
