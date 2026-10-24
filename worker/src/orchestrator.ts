// The Desk Lead: worker code, not an agent, so the org chart stays honest.
// It watches SpacetimeDB and hands work between the three saved CREAO agents:
//   claim frames_ready → Evidence Analyst → Refund Investigator → propose()
//   fraud_pattern detected → Pattern Analyst → confirmPattern()
// Agents only return JSON; the worker validates it and writes through reducers.
// Fail closed: the kill switch is checked before every run, unparseable
// output becomes unable_to_verify / more_evidence / needs_review.
import type { DbConnection } from '../module_bindings/index';
import type { Claim, FraudPattern } from '../module_bindings/types';
import { catalogItem } from '@vouch/module/world';
import { config, log, type Seat } from './env';
import { call } from './stdb';
import { parseVerdict, startRun, waitForRun, type RunHandle } from './creao';
import { historySummary, label } from './history';
import { mirrorOf } from './mirror';

export const PATTERN_REVIEWS_PER_RUN = 12;
export const CONTROLLER_THRESHOLD_CENTS = 50_000;

export interface CredentialCheck {
  presented: boolean; verified: boolean; failed_step: number | null; issuer: string | null; claims: Record<string, unknown>;
}
export type CredentialChecker = (agentId: number, refundId: bigint, verifier: number) => Promise<CredentialCheck | null>;

interface EvidenceJson {
  unable_to_verify?: boolean; offline?: boolean; no_video?: boolean; challenge?: { passed?: boolean }; capture_flags?: string[]; [k: string]: unknown;
}

export class Orchestrator {
  private busy = new Set<string>();
  private runsToday = 0;
  private today = new Date().toDateString();
  private reviewsThisRun = new Map<string, number>(); // seed → reviews

  /** Showcase claims are replayed from stored runs (no credits) unless the showcase runner marks one as live. */
  readonly liveShowcaseClaims = new Set<bigint>();

  constructor(private conn: DbConnection, private checkCredential: CredentialChecker) {}

  start() {
    const db = this.conn.db;
    db.claim.onInsert((_c, row) => this.onClaim(row));
    db.claim.onUpdate((_c, _old, row) => this.onClaim(row));
    db.fraudPattern.onInsert((_c, row) => this.onPattern(row));
    db.fraudPattern.onUpdate((_c, _old, row) => this.onPattern(row));
    // Pick up work that arrived while the worker was down.
    for (const c of db.claim.iter()) this.onClaim(c);
    for (const p of db.fraudPattern.iter()) this.onPattern(p);
    log(`orchestrator started (CREAO_MODE=${config.creao.mode}, ${config.creao.dailyRunLimit} runs/day)`);
  }

  private agentsOn() {
    return this.conn.db.control.key.find('creao_enabled')?.value === 'true';
  }

  private takeBudget(): boolean {
    const d = new Date().toDateString();
    if (d !== this.today) { this.today = d; this.runsToday = 0; }
    if (config.creao.mode === 'live' && this.runsToday >= config.creao.dailyRunLimit) return false;
    this.runsToday++;
    return true;
  }

  private onClaim(c: Claim) {
    if (c.status !== 'frames_ready') return;
    if (c.kind === 'showcase' && !this.liveShowcaseClaims.has(c.id)) return;
    const key = `claim:${c.id}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.runClaim(c).catch((e) => log(`claim ${label.claim(c.id)} failed: ${(e as Error).message}`)).finally(() => this.busy.delete(key));
  }

  private async offline(c: Claim, why: string) {
    await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat: 'system', runId: '', runUrl: '', json: JSON.stringify({ offline: true, reason: why }), provenance: 'live' }));
    await call('setClaimStatus', this.conn.reducers.setClaimStatus({ claimId: c.id, status: 'offline' }));
    log(`${label.claim(c.id)}: investigator offline (${why})`);
  }

  /** Runs one seat: records the run row, streams progress steps, returns the parsed JSON (or the fail-closed fallback). */
  private async runSeat<T extends object>(seat: Seat, caseRef: string, caseJson: unknown, fallback: T, valid: (v: Record<string, unknown>) => boolean): Promise<{ value: T; ok: boolean; handle: RunHandle }> {
    const handle = await startRun(seat, caseJson, caseRef);
    await call('recordRun', this.conn.reducers.recordRun({ runId: handle.runId, seat, caseRef, runUrl: handle.runUrl, conversationId: handle.conversationId, mode: handle.path === 'fixture' ? 'fixture' : 'live' }));
    const step = (s: string) => void call('runStep', this.conn.reducers.runStep({ runId: handle.runId, step: s }));
    step(seat === 'evidence_analyst' ? 'frames sent' : seat === 'pattern_analyst' ? 'events and histories sent' : 'evidence and history sent');
    const result = await waitForRun(handle, caseJson, step);
    const parsed = parseVerdict(result.text, fallback, valid);
    step(result.status !== 'completed' ? `run ${result.status}` : parsed.ok ? 'result received' : 'result unparseable: failed closed');
    await call('finishRun', this.conn.reducers.finishRun({ runId: handle.runId, status: result.status === 'completed' ? 'completed' : 'failed', runUrl: handle.runUrl }));
    return { ...parsed, handle };
  }

  private async runClaim(c: Claim) {
    const db = this.conn.db;
    const m = mirrorOf(this.conn);
    const refund = m.refunds.get(c.refundId);
    if (!refund) return;
    const purchase = m.purchases.get(refund.purchaseId);
    const business = db.business.id.find(refund.businessId);
    if (!purchase || !business) return;
    if (!this.agentsOn()) return this.offline(c, 'creao_enabled is off');
    await call('setClaimStatus', this.conn.reducers.setClaimStatus({ claimId: c.id, status: 'investigating' }));

    const item = catalogItem(purchase.item);
    const policy = JSON.parse(business.policy) as { windowDays: number; needsVideoOverCents: number; restockingFeePct: number; storeCreditAllowed: boolean; notes: string };
    const checks = JSON.parse(c.checksJson || '{}') as Record<string, unknown>;
    const day = db.simRun.id.find(1)?.day ?? refund.day;
    const withinWindow = purchase.windowEndDay > 0 ? refund.day <= purchase.windowEndDay : refund.day - purchase.deliverDay <= policy.windowDays;
    const caseRef = label.claim(c.id);

    // 1. Evidence Analyst (live claims with a video). Simulated refunds opened from the globe have claim text and timing only.
    let evidence: EvidenceJson;
    const existing = [...db.evidence.iter()].find((e) => e.claimId === c.id && e.seat === 'evidence_analyst');
    if (existing) {
      evidence = JSON.parse(existing.json) as EvidenceJson;
    } else if ((c.kind === 'live' || c.kind === 'showcase') && c.frameUrls.length > 0) {
      if (!this.takeBudget()) return this.offline(c, `daily CREAO run limit (${config.creao.dailyRunLimit}) reached`);
      const evCase = {
        claim_id: caseRef,
        order: { item: item?.name ?? 'item', category: purchase.category, amount: purchase.amount / 100, purchased_day: purchase.day, delivered_day: purchase.deliverDay },
        claim: { reason_code: refund.reasonCode, reason_text: refund.reasonText },
        reference: { description: item?.description ?? '', listing_image_urls: [] },
        policy: { window_days: policy.windowDays, requires_video_over: policy.needsVideoOverCents / 100, notes: policy.notes },
        challenge: { fingers: c.fingerCount },
        frames: c.frameUrls.map((url, index) => ({ index, t: Number((checks.frame_times as number[] | undefined)?.[index] ?? index), url })),
        deterministic_checks: { fresh: checks.fresh ?? true, duration_s: checks.duration_s ?? null, frame_reuse: checks.frame_reuse ?? [], blank_frames: checks.blank_frames ?? 0 },
      };
      const r = await this.runSeat<EvidenceJson>('evidence_analyst', caseRef, evCase,
        { unable_to_verify: true, summary: 'The Evidence Analyst output could not be read, so the claim is treated as unable to verify.', capture_flags: [] },
        (v) => typeof v.unable_to_verify === 'boolean' && typeof v.summary === 'string');
      evidence = r.value;
      await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat: 'evidence_analyst', runId: r.handle.runId, runUrl: r.handle.runUrl, json: JSON.stringify(r.value), provenance: r.handle.path === 'fixture' ? 'fixture' : 'live' }));
    } else {
      evidence = { no_video: true, unable_to_verify: c.kind === 'live', summary: c.kind === 'live' ? 'No video was uploaded.' : 'Simulated refund: claim text and timing only, no video.' };
      await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat: 'system', runId: '', runUrl: '', json: JSON.stringify(evidence), provenance: 'live' }));
    }

    // The kill switch can be flipped while a run is in flight: check again before the next hand-off.
    if (!this.agentsOn()) return this.offline(c, 'creao_enabled was turned off mid-investigation');
    if (!this.takeBudget()) return this.offline(c, `daily CREAO run limit (${config.creao.dailyRunLimit}) reached`);

    // 2. Refund Investigator
    const credential = await this.checkCredential(refund.agentId, refund.id, refund.businessId).catch(() => null);
    const patterns = [...db.fraudPattern.iter()].filter((p) => p.agentIds.includes(refund.agentId)).map((p) => ({
      id: label.pattern(p.id), status: p.status, role: ((JSON.parse(p.rolesJson || '[]') as { id: string; role: string }[]).find((x) => x.id === label.agent(refund.agentId))?.role) ?? 'unknown',
    }));
    const invCase = {
      claim_id: caseRef,
      amount_requested: refund.amount / 100,
      controller_threshold: CONTROLLER_THRESHOLD_CENTS / 100,
      order: { item: item?.name ?? 'item', category: purchase.category, amount: purchase.amount / 100, purchased_day: purchase.day, delivered_day: purchase.deliverDay, claim_day: refund.day },
      claim: { reason_code: refund.reasonCode, reason_text: refund.reasonText },
      policy: { window_days: policy.windowDays, restocking_fee_pct: policy.restockingFeePct, store_credit_allowed: policy.storeCreditAllowed, notes: policy.notes },
      evidence,
      deterministic_checks: { fresh: checks.fresh ?? true, duration_s: checks.duration_s ?? null, frame_reuse: checks.frame_reuse ?? [], within_window: withinWindow },
      history: await historySummary(this.conn, refund.agentId),
      credential: credential ?? { presented: false, verified: false, failed_step: null, issuer: null, claims: {} },
      patterns,
      today: day,
    };
    const fallback = {
      action: 'more_evidence', amount: 0, method: 'none', needs_controller: false, confidence: 0,
      reasons: [{ text: 'The Investigator output could not be read, so the claim needs more evidence or a person.', cites: 'check:unparseable' }],
      what_would_change_my_mind: 'A readable recommendation from the Investigator.',
    };
    const inv = await this.runSeat('refund_investigator', caseRef, invCase, fallback, (v) => ['accept', 'decline', 'more_evidence'].includes(String(v.action)) && Array.isArray(v.reasons));
    const v = inv.value as typeof fallback & { amount: number };
    // Never exceed what was asked; never decline on evidence nobody could verify.
    let action = v.action;
    if (action === 'decline' && (evidence.unable_to_verify || evidence.offline)) action = 'more_evidence';
    const amount = action === 'accept' ? Math.min(refund.amount, Math.round(Number(v.amount || refund.amount / 100) * 100)) : 0;
    await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat: 'refund_investigator', runId: inv.handle.runId, runUrl: inv.handle.runUrl, json: JSON.stringify({ ...v, action, credential: invCase.credential }), provenance: inv.handle.path === 'fixture' ? 'fixture' : 'live' }));
    if (!this.agentsOn()) return this.offline(c, 'creao_enabled was turned off before the proposal');
    await call('propose', this.conn.reducers.propose({
      refundId: refund.id, action, amount, method: String(v.method || 'original_payment'), confidence: Number(v.confidence) || 0,
      reasonsJson: JSON.stringify(v.reasons ?? []), runId: inv.handle.runId, runUrl: inv.handle.runUrl,
    }));
    log(`${caseRef}: Investigator recommends ${action}${amount ? ` $${(amount / 100).toFixed(2)}` : ''} (${inv.handle.path})`);
  }

  // ---------------------------------------------------------------- patterns

  private onPattern(p: FraudPattern) {
    if (p.status !== 'detected') return;
    const key = `pattern:${p.id}:${p.detectorVersion}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.runPattern(p).catch((e) => log(`${label.pattern(p.id)} review failed: ${(e as Error).message}`));
    // never removed from busy: the Pattern Analyst reviews a pattern once per detector version
  }

  private async runPattern(p: FraudPattern) {
    const db = this.conn.db;
    const seed = String(db.simRun.id.find(1)?.seed ?? 0n);
    const done = [...db.fraudPattern.iter()].filter((x) => x.runId && x.flaggedDay >= (db.simRun.id.find(1)?.startDay ?? 0)).length;
    const used = Math.max(this.reviewsThisRun.get(seed) ?? 0, done);
    if (!this.agentsOn() || used >= PATTERN_REVIEWS_PER_RUN || !this.takeBudget()) {
      await call('setPatternStatus', this.conn.reducers.setPatternStatus({ patternId: p.id, status: 'awaiting_review', runId: '', runUrl: '' }));
      return;
    }
    this.reviewsThisRun.set(seed, used + 1);
    const ref = label.pattern(p.id);
    const events = [...db.patternEvent.iter()].filter((e) => e.patternId === p.id);
    const refunds = events.filter((e) => e.kind === 'refund');
    const agents = await Promise.all(p.agentIds.slice(0, 15).map(async (id) => {
      const h = await historySummary(this.conn, id);
      return { id: h.agent_id, score: h.score, account_age_days: h.account_age_days, purchases_completed: h.purchases_completed, refund_ratio_90d: h.refund_ratio_90d };
    }));
    const day = db.simRun.id.find(1)?.day ?? 0;
    const skuStats = new Map<string, { business: number; sku: number; claims: number; units: number }>();
    const m = mirrorOf(this.conn);
    for (const e of refunds) {
      const r = m.refunds.get(e.eventId);
      const pur = r ? m.purchases.get(r.purchaseId) : undefined;
      if (!pur) continue;
      const k = `${pur.business}:${pur.item}`;
      if (!skuStats.has(k)) skuStats.set(k, { business: pur.business, sku: pur.item, claims: 0, units: 0 });
    }
    for (const pur of m.purchases.values()) {
      if (pur.day < day - 30) continue;
      const s = skuStats.get(`${pur.business}:${pur.item}`);
      if (s) { s.units++; if (pur.status === 'refund_requested' || pur.status === 'refunded') s.claims++; }
    }
    const prior = [...db.fraudPattern.iter()].filter((x) => x.id !== p.id && (x.status === 'confirmed' || x.status === 'dismissed')).slice(-5)
      .map((x) => ({ pattern: label.pattern(x.id), verdict: x.status, why: x.narrative.slice(0, 200) }));
    const caseJson = {
      pattern: { id: ref, kind: p.kind, detector: p.detectorId, version: p.detectorVersion, first_day: p.firstDay, last_day: p.lastDay, features: JSON.parse(p.features) as unknown },
      events: refunds.slice(0, 60).map((e) => ({ id: label.refund(e.eventId), table: 'refund', day: e.day, agent: label.agent(e.agentId), business: label.business(e.businessId), amount: e.amount / 100, reason_text: e.text, why: e.why })),
      agents,
      business_context: [...skuStats.values()].map((s) => ({ business: label.business(s.business), sku: `SKU-${s.sku}`, item: catalogItem(s.sku)?.name, claims_last_30d: s.claims, units_sold_last_30d: s.units })),
      prior_reviews: prior,
    };
    const fallback = { verdict: 'needs_review', narrative: 'The Pattern Analyst output could not be read, so the pattern needs a person.', agents: [] as { id: string; role: string }[] };
    await call('setPatternStatus', this.conn.reducers.setPatternStatus({ patternId: p.id, status: 'reviewing', runId: '', runUrl: '' }));
    const r = await this.runSeat('pattern_analyst', ref, caseJson, fallback, (v) => ['confirm', 'dismiss', 'needs_review'].includes(String(v.verdict)) && typeof v.narrative === 'string');
    const v = r.value as typeof fallback & { signals_not_used?: string };
    // The analyst must say region and business alone were not evidence; if it did not, do not let it confirm.
    let verdict = v.verdict;
    if (verdict === 'confirm' && !/region/i.test(String(v.signals_not_used ?? ''))) verdict = 'needs_review';
    await call('confirmPattern', this.conn.reducers.confirmPattern({
      patternId: p.id, verdict, runId: r.handle.runId, runUrl: r.handle.runUrl, narrative: String(v.narrative ?? ''), rolesJson: JSON.stringify(Array.isArray(v.agents) ? v.agents : []),
    }));
    log(`${ref}: Pattern Analyst says ${verdict} (${r.handle.path})`);
  }
}
