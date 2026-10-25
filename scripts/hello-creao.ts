// T0.5 (human-run, spends credits: one run per agent). Starts one run of each
// saved CREAO agent with the spec's Appendix A test case, polls to a result,
// and prints it. --record saves the responses as recorded fixtures, which then
// replace the hand-written ones in worker/fixtures/.
//   CREAO_MODE=live npx tsx scripts/hello-creao.ts [--record] [--seat evidence_analyst]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, REPO_ROOT, type Seat } from '../worker/src/env';
import { apiPath, fillFromChat, parseVerdict, resolveAgents, seatPath, startRun, waitForRun } from '../worker/src/creao';

// The checks the worker applies to each answer (orchestrator.ts, pulse.ts, review/creao-review.ts); failing one shows as "result unparseable".
const VALID: Record<Seat, (v: Record<string, unknown>) => boolean> = {
  evidence_analyst: (v) => typeof v.unable_to_verify === 'boolean' && typeof v.summary === 'string',
  refund_investigator: (v) => ['accept', 'decline', 'more_evidence'].includes(String(v.action)) && Array.isArray(v.reasons),
  pattern_analyst: (v) => ['confirm', 'dismiss', 'needs_review'].includes(String(v.verdict)) && typeof v.narrative === 'string',
  refund_reviewer: (v) => typeof v.agrees === 'boolean' && typeof v.businessSummary === 'string',
  customer_liaison: (v) => typeof v.customerMessage === 'string',
  listing_matcher: (v) => typeof v.same_as_ordered === 'string' && typeof v.eligibility === 'object' && v.eligibility !== null,
  returns_monitor: (v) => typeof v.narrative === 'string' && Array.isArray(v.anomalies),
  policy_checker: (v) => typeof v.outcome === 'string' && Array.isArray(v.rules),
  risk_scorecard: (v) => typeof v.caution === 'string' && Array.isArray(v.indicators),
  score_reviewer: (v) => ['gain', 'loss', 'same'].includes(String(v.direction)),
};
const results: string[] = [];

config.creao.mode = 'live';
const record = process.argv.includes('--record');
const only = process.argv.includes('--seat') ? process.argv[process.argv.indexOf('--seat') + 1] : null;

const CASES: Record<Seat, unknown> = {
  evidence_analyst: { claim_id: 'C-TEST1', order: { item: 'Ceramic mug', category: 'home', amount: 24, purchased_day: 3, delivered_day: 6 }, claim: { reason_code: 'defective', reason_text: 'Arrived with a chip on the rim' }, reference: { description: 'White ceramic mug, 350 ml, blue band near the rim', listing_image_urls: [] }, policy: { window_days: 30, requires_video_over: 100, notes: '' }, challenge: { fingers: 2 }, frames: [], deterministic_checks: { fresh: true, duration_s: 11, frame_reuse: [] } },
  refund_investigator: { claim_id: 'C-TEST2', amount_requested: 249, controller_threshold: 500, order: { item: 'Wireless headphones', category: 'electronics', amount: 249, purchased_day: 10, delivered_day: 14, claim_day: 18 }, claim: { reason_code: 'defective', reason_text: 'Left ear cup cracked out of the box' }, policy: { window_days: 30, restocking_fee_pct: 0, store_credit_allowed: true, notes: 'Physical damage from misuse is not covered' }, evidence: { item_matches_reference: { value: 'true', confidence: 0.9 }, claimed_defect_visible: { value: 'true', confidence: 0.85, frames: [3, 4] }, defect_consistent_with_claim: { value: 'true', damage_type: 'manufacturing' }, challenge: { expected: 3, seen: 3, passed: true }, capture_flags: [], unable_to_verify: false }, deterministic_checks: { fresh: true, duration_s: 14, frame_reuse: [], within_window: true }, history: { agent_id: 'A-00421', score: 684, band: 'neutral', account_age_days: 120, purchases_completed: 38, businesses: 6, refunds_requested_90d: 2, refunds_accepted_total: 3, refunds_declined_total: 0, refund_ratio_90d: 0.08, recent_credit_events: [{ id: 'CE-1042', day: 12, kind: 'refund_accepted', delta: 12 }] }, credential: { presented: true, verified: true, failed_step: null, issuer: 'B-019', claims: { completed_purchases_gte: 10, refund_ratio_band: 'low', no_confirmed_fraud_180d: true } }, patterns: [] },
  refund_reviewer: { claimId: 'C-TEST3', retailerId: 'B-002', tierLabel: 'Instant refund', claimSummary: { reasonCode: 'defective', reasonText: 'The left earbud does not charge', claimsFrom: 'transcript', spokenClaims: [{ id: 'c1', kind: 'defect', text: 'the left earbud does not charge', tSaid: 4.2 }] }, findings: [{ id: 1, claimId: 'c1', kind: 'supports', observation: 'The case light stays off while the right earbud lights up between 00:06 and 00:09.', tStart: 6, tEnd: 9, confidence: 0.86, method: 'probe:luminance', artifactIds: [11, 12], auditStatus: 'passed' }], rejectedFindings: [], integrity: { score: 0.97, flags: [] }, history: { tenureDays: 120, orders: 38, refunds365: 3, smoothedRefundRate: 0.08, categoryBaseline: 0.08, excessRatio: 1, verifiedIdentity: 'unknown' }, score: { eSupport: 0.91, coverage: 1, integrity: 0.97, pLegit: 0.88, logit: 2.0 }, recommendation: { tier: 'T1', refundNow: 8900, refundOnReturn: 0, returnRequired: false, replacementOffered: false, reasons: [{ text: 'The claimed charging fault is shown on camera.', cites: 'finding:1' }] }, limits: [] },
  customer_liaison: { claimId: 'C-TEST3', tierLabel: 'Instant refund', claimSummary: { reasonCode: 'defective', reasonText: 'The left earbud does not charge', claimsFrom: 'transcript', spokenClaims: [{ id: 'c1', kind: 'defect', text: 'the left earbud does not charge', tSaid: 4.2 }] }, recommendation: { tier: 'T1', refundNow: 8900, refundOnReturn: 0, returnRequired: false, replacementOffered: false, reasons: [{ text: 'The claimed charging fault is shown on camera.', cites: 'finding:1' }] }, limits: [], review: { agrees: true, businessSummary: 'The footage shows the earbud failing to charge; history is clean.', concerns: [] } },
  listing_matcher: { claim_id: 'C-TEST6', order: { item: 'Wireless headphones', sku: 'SKU-0', category: 'electronics', amount: 249, description: 'Black over-ear wireless headphones without noise cancelling, silver hinges, logo on each cup', parts: ['ear cup', 'hinge', 'headband', 'charging port'] }, claim: { reason_code: 'defective', reason_text: 'Left ear cup cracked out of the box' }, evidence: { unable_to_verify: false, item_matches_reference: { value: 'true', confidence: 0.9 }, defect_consistent_with_claim: { value: 'true', damage_type: 'manufacturing' }, frames: [{ index: 0, t: 0, observation: 'Matte black over-ear headphones on a desk, silver hinge visible.' }, { index: 3, t: 4.1, observation: 'Close-up of the left ear cup; a crack runs from the hinge.' }], frame_urls: [] }, scraped_listings: { source: 'fixture', query: 'Wireless headphones', fetched_at: '2026-10-24T00:00:00Z', cached: false, error: null, items: [{ title: 'Wireless headphones', price: 249, currency: 'USD', seller: 'Example Store', url: 'https://example-shop.test/sku-0', image: '', rating: 4.4, reviews: 318, snippet: 'Black over-ear wireless headphones without noise cancelling, silver hinges, logo on each cup' }, { title: 'Wireless earbuds', price: 89, currency: 'USD', seller: 'Example Marketplace', url: 'https://example-shop.test/sku-1', image: '', rating: 4.2, reviews: 120, snippet: 'White in-ear buds in a pill-shaped charging case' }] }, policy: { window_days: 30, notes: 'Physical damage from misuse is not covered', store_credit_allowed: true }, deterministic_checks: { within_window: true, days_since_delivery: 4 } },
  returns_monitor: { trigger: 'manual', simulated_day: 120, window: { seconds: 60, returns: 42, per_second: 0.7, baseline_per_second: 0.21, spike_factor: 3 }, items: [{ sku: 'SKU-1', name: 'Wireless earbuds', count: 18, per_second: 0.3, baseline_per_second: 0.05, spike: true, real_world: { source: 'fixture', fetched_at: '2026-10-24T00:00:00Z', cached: false, error: null, signals: [{ title: 'Wireless earbuds review: what owners say after 3 months', snippet: 'A minority mention a case that stopped charging and a smooth return.', url: 'https://example-reviews.test/wireless-earbuds', source: 'example-reviews.test' }] } }, { sku: 'SKU-0', name: 'Wireless headphones', count: 6, per_second: 0.1, baseline_per_second: 0.09, spike: false, real_world: null }], businesses: [{ id: 'B-002', name: 'Circuit Yard', count: 20 }, { id: 'B-019', name: 'Lakeshore Audio', count: 9 }], cohorts: [{ band: 'neutral', count: 30 }, { band: 'trusted', count: 8 }, { band: 'watch', count: 4 }], prior_notes: [] },
  policy_checker: { claim_id: 'C-TEST8', order: { item: 'Wireless headphones', sku: 'SKU-0', category: 'electronics', amount: 249, purchased_day: 10, delivered_day: 14, claim_day: 18 }, claim: { reason_code: 'defective', reason_text: 'Left ear cup cracked out of the box', amount_requested: 249 }, policy: { window_days: 30, restocking_fee_pct: 0, store_credit_allowed: true, needs_video_over: 100, notes: 'Physical damage from misuse is not covered' }, checks: { within_window: true, days_since_delivery: 4, window_ends_day: 44, reason_allowed: true, over_video_threshold: true, has_video: true, fresh: true, duration_ok: true, resolution_ok: true }, listing_match: { same_as_ordered: 'true', confidence: 0.85, eligibility: { verdict: 'eligible' }, differences: [] } },
  risk_scorecard: { claim_id: 'C-TEST9', amount_requested: 249, history: { agent_id: 'A-00421', score: 684, band: 'neutral', account_age_days: 120, purchases_completed: 38, businesses: 6, refunds_requested_90d: 2, refunds_accepted_total: 3, refunds_declined_total: 0, refund_ratio_90d: 0.08, recent_credit_events: [] }, credential: { presented: true, verified: true, failed_step: null, issuer: 'B-019', claims: { completed_purchases_gte: 10, refund_ratio_band: 'low', no_confirmed_fraud_180d: true } }, patterns: [], identity: { status: 'not_run', reason: 'CRS is not configured' }, item_context: { sku: 'SKU-0', name: 'Wireless headphones', pulse: { count: 2, perSecond: 0.03, baselinePerSecond: 0.02, spike: false }, business_context: { claims_last_30d: 3, units_sold_last_30d: 120 } }, video_checks: { fresh: true, frame_reuse_count: 0, still_image: false, challenge_passed: true, capture_flags: [], unable_to_verify: false }, evidence_summary: 'A crack is visible on the left cup in two frames; the item matches the listing.' },
  score_reviewer: { task: 'vouch_score_review', refund: 'R-TEST10', decision: 'accepted', amount: 249, score_before: 684, evidence_summary: 'The footage shows the left ear cup cracked; the audit passed.', history: { refunds_accepted_total: 3, refunds_declined_total: 0 }, bounds: { gain: [1, 15], loss: [-60, -1] } },
  pattern_analyst: { pattern: { id: 'FR-028', kind: 'coordinated', detector: 'coordinated', version: 1, first_day: 1, last_day: 9, features: { agents: 7, regions: 6, businesses: 4, claim_window_hours: 31, text_similarity: 0.86 } }, events: [{ id: 'R-5521', table: 'refund', day: 8, agent: 'A-01877', business: 'B-002', item: 'Wireless earbuds', sku: 'EB-200', amount: 89, reason_text: 'Received the wireless earbuds and the button was faulty right away, it does not work at all. Please refund.', why: 'claim within 31h of 6 similar claims' }], agents: [{ id: 'A-01877', score: 640, account_age_days: 22, purchases_completed: 3, refund_ratio_90d: 0.67 }], business_context: [{ business: 'B-002', sku: 'EB-200', claims_last_30d: 4, units_sold_last_30d: 300 }], prior_reviews: [] },
};

console.log(`CREAO API path: ${apiPath()}`);
// A missing core seat is reported, not fatal here: this script tests whichever agents are configured.
const ids = await resolveAgents().catch((e: Error) => { console.log(`note: ${e.message}`); return {} as Record<Seat, string>; });
for (const seat of Object.keys(CASES) as Seat[]) {
  if (only && seat !== only) continue;
  if (seatPath(seat) === 'none') { console.log(`\n${seat}: skipped (no CREAO_${seat.toUpperCase()}_APP_ID / _KEY)`); continue; }
  const t0 = Date.now();
  const h = await startRun(seat, CASES[seat], `hello-${seat}`).catch((e: Error) => { console.log(`\n${seat}: START FAILED: ${e.message}`); return null; });
  if (!h) { results.push(`FAILED   ${seat}: could not start`); continue; }
  console.log(`\n${seat} (${h.path}:${ids[seat] ?? config.creao.appIds[seat]}): run ${h.runId} started; polling every ${config.creao.pollMs / 1000}s`);
  const r = await waitForRun(h, CASES[seat], (s) => console.log(`  ${s}`));
  console.log(`  ${r.status} after ${Math.round((Date.now() - t0) / 1000)} s\n  ${r.text?.slice(0, 1200) ?? JSON.stringify(r.raw).slice(0, 300)}`);
  const ok = r.status === 'completed' && parseVerdict(r.text, {}, VALID[seat], (v) => fillFromChat(seat, v, r.chat)).ok;
  results.push(`${ok ? 'VALID  ' : r.status === 'completed' ? 'INVALID' : 'FAILED '}  ${seat}: ${r.status}${r.status === 'completed' && !ok ? ', answer does not match the shape the worker parses' : ''}`);
  if (record && r.status === 'completed' && r.text) {
    const name = { evidence_analyst: 'consistent', refund_investigator: 'accept', pattern_analyst: 'confirm', refund_reviewer: 'agree', customer_liaison: 'message', listing_matcher: 'match', returns_monitor: 'note', policy_checker: 'result', risk_scorecard: 'card', score_reviewer: 'verdict' }[seat];
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const file = resolve(REPO_ROOT, `worker/fixtures/${seat}.recorded.${name}.json`);
      writeFileSync(file, JSON.stringify({ _fixture: `recorded from run ${h.runId} on ${new Date().toISOString()}`, ...JSON.parse(m[0]) }, null, 2));
      console.log(`  saved ${file}`);
    }
  }
}
console.log(`\n${results.join('\n')}`);
process.exit(0);
