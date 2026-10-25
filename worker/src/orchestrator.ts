// The Desk Lead: worker code, not an agent, so the org chart stays honest.
// It watches SpacetimeDB and hands work between the three saved CREAO agents:
//   claim frames_ready → Evidence Analyst → [Listing Matcher → Policy Checker → Risk Scorecard] (optional) → Refund Investigator → propose()
//   fraud_pattern detected → Pattern Analyst → confirmPattern()
// Agents only return JSON; the worker validates it and writes through reducers.
// Fail closed: the kill switch is checked before every run, unparseable
// output becomes unable_to_verify / more_evidence / needs_review.
import type { DbConnection } from '../module_bindings/index';
import type { Claim, FraudPattern } from '../module_bindings/types';
import { catalogItem } from '@vouch/module/world';
import { config, log, type Seat } from './env';
import type { CaseIdentity, IdentityDesk } from './identity';
import { call } from './stdb';
import { fillFromChat, parseVerdict, seatAvailable, startRun, waitForRun, type RunHandle } from './creao';
import { searchListings } from './brightdata';
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

export interface PolicyCheckJson {
  outcome?: 'eligible' | 'conditional' | 'needs_person' | 'not_eligible' | string;
  rules?: { rule: string; result: string; detail: string; cites: string }[];
  refund_shape?: { max_amount?: number; restocking_fee_pct?: number; store_credit_only?: boolean };
  exception_note?: string; summary?: string; [k: string]: unknown;
}
const RULES = new Set(['window', 'reason', 'video_required', 'category_note', 'restocking_fee', 'item_identity', 'condition']);

/** Only the deterministic window and reason checks can make a claim not eligible; everything else is a person's call. */
export function guardPolicyCheck(v: PolicyCheckJson, ctx: { withinWindow: boolean; reasonAllowed: boolean; amountRequested: number }): PolicyCheckJson {
  let outcome = ['eligible', 'conditional', 'needs_person', 'not_eligible'].includes(String(v.outcome)) ? String(v.outcome) : 'needs_person';
  if (outcome === 'not_eligible' && ctx.withinWindow && ctx.reasonAllowed) outcome = 'needs_person';
  if (outcome === 'eligible' && (!ctx.withinWindow || !ctx.reasonAllowed)) outcome = 'needs_person';
  const rules = (Array.isArray(v.rules) ? v.rules : []).filter((r) => r && RULES.has(String(r.rule)) && ['pass', 'fail', 'unclear', 'not_applicable'].includes(String(r.result))).slice(0, 12);
  const shape = v.refund_shape ?? {};
  const max = typeof shape.max_amount === 'number' ? Math.min(ctx.amountRequested, Math.max(0, shape.max_amount)) : ctx.amountRequested;
  return { ...v, outcome, rules, refund_shape: { ...shape, max_amount: max } };
}

export interface ScorecardJson {
  caution?: 'low' | 'medium' | 'high' | 'unknown' | string;
  indicators?: { name: string; value: unknown; reading: string; weight: number; why: string; cites: string }[];
  strongest_support?: string; strongest_caution?: string; innocent_explanation_considered?: string; signals_not_used?: string; summary?: string; [k: string]: unknown;
}
const INDICATORS = new Set(['account_age', 'purchases_completed', 'refund_ratio_90d', 'refunds_declined', 'score_band', 'credential', 'confirmed_pattern', 'detected_pattern', 'identity', 'item_spike', 'defective_batch_context', 'frame_reuse', 'challenge', 'still_image', 'capture_flags', 'evidence_unverifiable', 'amount_vs_history']);

/** The scorecard is context: unknown indicators are dropped, and a "high" caution that did not disclaim region and business is lowered to medium. */
export function guardScorecard(v: ScorecardJson): ScorecardJson {
  let caution = ['low', 'medium', 'high', 'unknown'].includes(String(v.caution)) ? String(v.caution) : 'unknown';
  if (caution === 'high' && !/region/i.test(String(v.signals_not_used ?? ''))) caution = 'medium';
  const indicators = (Array.isArray(v.indicators) ? v.indicators : []).filter((i) => i && INDICATORS.has(String(i.name)) && ['supports', 'neutral', 'caution'].includes(String(i.reading))).slice(0, 16)
    .map((i) => ({ ...i, weight: Math.min(1, Math.max(0, Number(i.weight) || 0)), why: String(i.why ?? '').slice(0, 300) }));
  return { ...v, caution, indicators };
}

export interface ListingMatchJson {
  matched_listing?: { index?: number; title?: string; seller?: string; price?: number | null; url?: string } | null;
  same_as_ordered?: 'true' | 'false' | 'uncertain' | string;
  confidence?: number;
  differences?: string[];
  eligibility?: { within_window?: boolean; policy_rule?: string; condition_consistent?: string; verdict?: 'eligible' | 'needs_person' | 'ineligible' | string; reasons?: { text: string; cites: string }[] };
  summary?: string;
  [k: string]: unknown;
}

/**
 * The Listing Matcher can send a claim to a person, but it can only call it
 * ineligible for a hard reason: outside the window, or clearly a different
 * item. Unverifiable frames or no listings never make a claim eligible either.
 */
export function guardListingMatch(v: ListingMatchJson, ctx: { withinWindow: boolean; unableToVerify: boolean; listings: number }): ListingMatchJson {
  const e = { ...(v.eligibility ?? {}) };
  const same = ['true', 'false', 'uncertain'].includes(String(v.same_as_ordered)) ? String(v.same_as_ordered) : 'uncertain';
  const conf = typeof v.confidence === 'number' ? Math.min(1, Math.max(0, v.confidence)) : 0;
  let verdict = ['eligible', 'needs_person', 'ineligible'].includes(String(e.verdict)) ? String(e.verdict) : 'needs_person';
  const hardReason = ctx.withinWindow === false || (same === 'false' && conf >= 0.8);
  if (verdict === 'ineligible' && !hardReason) verdict = 'needs_person';
  if (verdict === 'eligible' && (ctx.unableToVerify || ctx.listings === 0 || same !== 'true')) verdict = 'needs_person';
  return { ...v, same_as_ordered: same, confidence: conf, eligibility: { ...e, within_window: ctx.withinWindow, verdict, reasons: Array.isArray(e.reasons) ? e.reasons.slice(0, 8) : [] } };
}

/**
 * A claim needs the Desk Lead when its frames are ready. At start-up it also needs
 * one when a crash left it "investigating" with no proposal (QA-006): live runs take
 * minutes, so a restart mid-run would otherwise strand it. runClaim reuses an
 * Evidence Analyst result that was already recorded.
 */
export function claimNeedsWork(c: { status: string }, atStartup: boolean): boolean {
  return c.status === 'frames_ready' || (atStartup && c.status === 'investigating');
}

export class Orchestrator {
  private busy = new Set<string>();
  private runsToday = 0;
  private today = new Date().toDateString();
  private reviewsThisRun = new Map<string, number>(); // seed → reviews

  /** Showcase claims are replayed from stored runs (no credits) unless the showcase runner marks one as live. */
  readonly liveShowcaseClaims = new Set<bigint>();
  /** When the video reviewer is on, it owns every claim with a video; the Desk Lead keeps the simulated and video-less ones. */
  handledByReviewer: ((c: Claim) => boolean) | null = null;
  /** The latest returns-pulse line for an item, from the PulseRunner, for the Risk Scorecard's item context. */
  pulseFor: ((sku: number) => { count: number; perSecond: number; baselinePerSecond: number; spike: boolean } | null) | null = null;
  /** CRS identity step-up (worker/src/identity.ts); null leaves identity "not run". */
  identity: IdentityDesk | null = null;

  constructor(private conn: DbConnection, private checkCredential: CredentialChecker) {}

  start() {
    const db = this.conn.db;
    db.claim.onInsert((_c, row) => this.onClaim(row));
    db.claim.onUpdate((_c, _old, row) => this.onClaim(row));
    db.fraudPattern.onInsert((_c, row) => this.onPattern(row));
    db.fraudPattern.onUpdate((_c, _old, row) => this.onPattern(row));
    // Pick up work that arrived while the worker was down, and claims a crash left half-investigated.
    for (const c of db.claim.iter()) this.onClaim(c, true);
    for (const p of db.fraudPattern.iter()) this.onPattern(p);
    log(`orchestrator started (CREAO_MODE=${config.creao.mode}, ${config.creao.dailyRunLimit} runs/day)`);
  }

  private agentsOn() {
    return this.conn.db.control.key.find('creao_enabled')?.value === 'true';
  }

  /** One daily CREAO budget for every seat, shared with the video reviewer. */
  takeBudget(): boolean {
    const d = new Date().toDateString();
    if (d !== this.today) { this.today = d; this.runsToday = 0; }
    if (config.creao.mode === 'live' && this.runsToday >= config.creao.dailyRunLimit) return false;
    this.runsToday++;
    return true;
  }

  private onClaim(c: Claim, atStartup = false) {
    if (!claimNeedsWork(c, atStartup)) return;
    if (c.kind === 'showcase' && !this.liveShowcaseClaims.has(c.id)) return;
    if (this.handledByReviewer?.(c)) return;
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
    const first: Partial<Record<Seat, string>> = { evidence_analyst: 'frames sent', pattern_analyst: 'events and histories sent', listing_matcher: 'frames and scraped listings sent', policy_checker: 'policy and checks sent', risk_scorecard: 'history, patterns and item context sent' };
    step(first[seat] ?? 'evidence and history sent');
    const result = await waitForRun(handle, caseJson, step);
    const parsed = parseVerdict(result.text, fallback, valid, (v) => fillFromChat(seat, v, result.chat));
    step(result.status !== 'completed' ? `run ${result.status}` : parsed.ok ? 'result received' : 'result unparseable: failed closed');
    await call('finishRun', this.conn.reducers.finishRun({ runId: handle.runId, status: result.status === 'completed' ? 'completed' : 'failed', runUrl: handle.runUrl }));
    return { ...parsed, handle };
  }

  /**
   * Runs an optional seat for a claim, reusing a recorded result after a restart, skipping when the saved agent is
   * missing or the budget is spent, and recording the guarded JSON as evidence under the seat's name.
   */
  private async optionalSeat<T extends object>(c: Claim, seat: Seat, caseRef: string, buildCase: () => unknown, fallback: T, valid: (v: Record<string, unknown>) => boolean, guard: (v: T) => T): Promise<T | { skipped: true; reason: string }> {
    const existing = [...this.conn.db.evidence.iter()].find((e) => e.claimId === c.id && e.seat === seat);
    if (existing) return JSON.parse(existing.json) as T;
    if (!seatAvailable(seat)) return { skipped: true, reason: `no saved CREAO agent "${seat.replace('_', ' ')}"` };
    if (!this.takeBudget()) return { skipped: true, reason: `daily CREAO run limit (${config.creao.dailyRunLimit}) reached` };
    const r = await this.runSeat<T>(seat, caseRef, buildCase(), fallback, valid);
    const value = guard(r.value);
    await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat, runId: r.handle.runId, runUrl: r.handle.runUrl, json: JSON.stringify(value), provenance: r.handle.path === 'fixture' ? 'fixture' : 'live' }));
    log(`${caseRef}: ${seat.replace('_', ' ')} done (${r.handle.path})`);
    return value;
  }

  /** Claims against units sold for one SKU at one business in the last 30 days: the "defective batch" context. */
  private skuContext(business: number, sku: number, day: number) {
    const m = mirrorOf(this.conn);
    let units = 0; let claims = 0;
    for (const pur of m.purchases.values()) {
      if (pur.business !== business || pur.item !== sku || pur.day < day - 30) continue;
      units++;
      if (pur.status === 'refund_requested' || pur.status === 'refunded') claims++;
    }
    return { claims_last_30d: claims, units_sold_last_30d: units };
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
        deterministic_checks: { fresh: checks.fresh ?? true, duration_s: checks.duration_s ?? null, frame_reuse: checks.frame_reuse ?? [], blank_frames: checks.blank_frames ?? 0, frame_motion: checks.frame_motion ?? null, still_image: checks.still_image ?? false },
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

    // 1b. Listing Matcher (optional seat): the worker scrapes listings that look like the ordered item (Bright Data,
    // cached), the agent says whether the frames show that item and whether the return is eligible under the policy.
    let listingMatch: ListingMatchJson | { skipped: true; reason: string };
    const existingMatch = [...db.evidence.iter()].find((e) => e.claimId === c.id && e.seat === 'listing_matcher');
    if (existingMatch) {
      listingMatch = JSON.parse(existingMatch.json) as ListingMatchJson;
    } else if (!seatAvailable('listing_matcher')) {
      listingMatch = { skipped: true, reason: 'no saved CREAO agent "Vouch Listing Matcher"' };
    } else if (evidence.no_video) {
      listingMatch = { skipped: true, reason: 'no video to compare with a listing' };
    } else if (!this.takeBudget()) {
      listingMatch = { skipped: true, reason: `daily CREAO run limit (${config.creao.dailyRunLimit}) reached` };
    } else {
      const scraped = await searchListings(item?.name ?? 'item');
      const matchCase = {
        claim_id: caseRef,
        order: { item: item?.name ?? 'item', sku: `SKU-${purchase.item}`, category: purchase.category, amount: purchase.amount / 100, description: item?.description ?? '', parts: item?.parts ?? [] },
        claim: { reason_code: refund.reasonCode, reason_text: refund.reasonText },
        evidence: {
          unable_to_verify: evidence.unable_to_verify ?? false, item_matches_reference: evidence.item_matches_reference ?? null, defect_consistent_with_claim: evidence.defect_consistent_with_claim ?? null,
          frames: ((evidence.frames as { index: number; t?: number; observation?: string }[] | undefined) ?? []).map((f) => ({ index: f.index, t: f.t, observation: f.observation ?? '' })),
          frame_urls: c.frameUrls,
        },
        scraped_listings: { source: scraped.source === 'brightdata' ? 'bright_data_serp' : 'fixture', query: scraped.query, fetched_at: scraped.fetchedAt, cached: scraped.cached, error: scraped.error, items: scraped.items },
        policy: { window_days: policy.windowDays, notes: policy.notes, store_credit_allowed: policy.storeCreditAllowed },
        deterministic_checks: { within_window: withinWindow, days_since_delivery: Math.max(0, refund.day - purchase.deliverDay) },
      };
      const matchFallback: ListingMatchJson = { same_as_ordered: 'uncertain', confidence: 0, eligibility: { verdict: 'needs_person', reasons: [{ text: 'The Listing Matcher output could not be read, so the item question goes to a person.', cites: 'check:unparseable' }] }, summary: 'Unreadable Listing Matcher output.' };
      const lm = await this.runSeat<ListingMatchJson>('listing_matcher', caseRef, matchCase, matchFallback, (v) => typeof v.same_as_ordered === 'string' && typeof v.eligibility === 'object' && v.eligibility !== null);
      const guarded = guardListingMatch(lm.value, { withinWindow, unableToVerify: evidence.unable_to_verify === true, listings: scraped.items.length });
      // Fill the matched listing's details from what was scraped when the agent only gave its index.
      const idx = guarded.matched_listing?.index;
      const hit = typeof idx === 'number' ? scraped.items[idx] : undefined;
      if (hit && !guarded.matched_listing?.title) guarded.matched_listing = { index: idx, title: hit.title, seller: hit.seller, price: hit.price, url: hit.url };
      listingMatch = { ...guarded, scraped_listings: matchCase.scraped_listings };
      await call('recordEvidence', this.conn.reducers.recordEvidence({ claimId: c.id, seat: 'listing_matcher', runId: lm.handle.runId, runUrl: lm.handle.runUrl, json: JSON.stringify(listingMatch), provenance: lm.handle.path === 'fixture' ? 'fixture' : 'live' }));
      log(`${caseRef}: Listing Matcher says ${String((listingMatch as ListingMatchJson).same_as_ordered)} / ${String((listingMatch as ListingMatchJson).eligibility?.verdict)} over ${scraped.items.length} ${scraped.source} listing(s)`);
      if (!this.agentsOn()) return this.offline(c, 'creao_enabled was turned off mid-investigation');
    }
    const credential = await this.checkCredential(refund.agentId, refund.id, refund.businessId).catch(() => null);
    const patterns = [...db.fraudPattern.iter()].filter((p) => p.agentIds.includes(refund.agentId)).map((p) => ({
      id: label.pattern(p.id), status: p.status, role: ((JSON.parse(p.rolesJson || '[]') as { id: string; role: string }[]).find((x) => x.id === label.agent(refund.agentId))?.role) ?? 'unknown',
    }));
    const history = await historySummary(this.conn, refund.agentId);
    const reasonAllowed = checks.reason_allowed !== false;
    // 1b. CRS identity step-up for thin histories, missing credentials and claims over the store limit (docs/CRS.md).
    const identity: CaseIdentity = this.identity
      ? await this.identity.stepUp({
        claimId: c.id, refund, kind: c.kind, autoApproveLimitCents: (policy as { autoApproveLimitCents?: number }).autoApproveLimitCents ?? CONTROLLER_THRESHOLD_CENTS,
        history, credentialVerified: !!credential?.verified,
      })
      : { status: 'not_run', reason: 'The identity desk is not running.' };

    // 1c. Policy Checker (optional seat): the policy, rule by rule, over the deterministic checks and the listing match.
    const policyCheck = await this.optionalSeat<PolicyCheckJson>(c, 'policy_checker', caseRef, () => ({
      claim_id: caseRef,
      order: { item: item?.name ?? 'item', sku: `SKU-${purchase.item}`, category: purchase.category, amount: purchase.amount / 100, purchased_day: purchase.day, delivered_day: purchase.deliverDay, claim_day: refund.day },
      claim: { reason_code: refund.reasonCode, reason_text: refund.reasonText, amount_requested: refund.amount / 100 },
      policy: { window_days: policy.windowDays, restocking_fee_pct: policy.restockingFeePct, store_credit_allowed: policy.storeCreditAllowed, needs_video_over: policy.needsVideoOverCents / 100, notes: policy.notes },
      checks: {
        within_window: withinWindow, days_since_delivery: Math.max(0, refund.day - purchase.deliverDay), window_ends_day: purchase.windowEndDay || purchase.deliverDay + policy.windowDays,
        reason_allowed: reasonAllowed, over_video_threshold: refund.amount > policy.needsVideoOverCents, has_video: c.frameUrls.length > 0,
        fresh: checks.fresh ?? null, duration_ok: checks.duration_ok ?? null, resolution_ok: checks.resolution_ok ?? null,
      },
      listing_match: listingMatch,
    }), { outcome: 'needs_person', rules: [], summary: 'The Policy Checker output could not be read, so a person reads the policy.' },
    (v) => typeof v.outcome === 'string' && Array.isArray(v.rules), (v) => guardPolicyCheck(v, { withinWindow, reasonAllowed, amountRequested: refund.amount / 100 }));
    if (!this.agentsOn()) return this.offline(c, 'creao_enabled was turned off mid-investigation');

    // 1d. Risk Scorecard (optional seat): every behavioural, identity and item indicator read as supports, neutral or caution.
    const skuContext = this.skuContext(purchase.business, purchase.item, day);
    const scorecard = await this.optionalSeat<ScorecardJson>(c, 'risk_scorecard', caseRef, () => ({
      claim_id: caseRef,
      amount_requested: refund.amount / 100,
      history,
      credential: credential ?? { presented: false, verified: false, failed_step: null, issuer: null, claims: {} },
      patterns,
      identity,
      item_context: { sku: `SKU-${purchase.item}`, name: item?.name ?? 'item', pulse: this.pulseFor?.(purchase.item) ?? null, business_context: skuContext },
      video_checks: {
        fresh: checks.fresh ?? null, frame_reuse_count: ((checks.frame_reuse as unknown[] | undefined) ?? []).length, still_image: checks.still_image ?? false,
        challenge_passed: evidence.challenge?.passed ?? null, capture_flags: evidence.capture_flags ?? [], unable_to_verify: evidence.unable_to_verify ?? false,
      },
      evidence_summary: String(evidence.summary ?? ''),
    }), { caution: 'unknown', indicators: [], summary: 'The Risk Scorecard output could not be read; the Investigator weighs the history itself.' },
    (v) => typeof v.caution === 'string' && Array.isArray(v.indicators), guardScorecard);
    if (!this.agentsOn()) return this.offline(c, 'creao_enabled was turned off mid-investigation');
    if (!this.takeBudget()) return this.offline(c, `daily CREAO run limit (${config.creao.dailyRunLimit}) reached`);

    // 2. Refund Investigator
    const invCase = {
      claim_id: caseRef,
      amount_requested: refund.amount / 100,
      controller_threshold: CONTROLLER_THRESHOLD_CENTS / 100,
      order: { item: item?.name ?? 'item', category: purchase.category, amount: purchase.amount / 100, purchased_day: purchase.day, delivered_day: purchase.deliverDay, claim_day: refund.day },
      claim: { reason_code: refund.reasonCode, reason_text: refund.reasonText },
      policy: { window_days: policy.windowDays, restocking_fee_pct: policy.restockingFeePct, store_credit_allowed: policy.storeCreditAllowed, notes: policy.notes },
      evidence,
      deterministic_checks: { fresh: checks.fresh ?? true, duration_s: checks.duration_s ?? null, frame_reuse: checks.frame_reuse ?? [], still_image: checks.still_image ?? false, within_window: withinWindow },
      listing_match: listingMatch,
      policy_check: policyCheck,
      risk_scorecard: scorecard,
      history,
      credential: credential ?? { presented: false, verified: false, failed_step: null, issuer: null, claims: {} },
      patterns,
      identity,
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
