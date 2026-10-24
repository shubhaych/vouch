// T0.5 (human-run, spends credits: one run per agent). Starts one run of each
// saved CREAO agent with the spec's Appendix A test case, polls to a result,
// and prints it. --record saves the responses as recorded fixtures, which then
// replace the hand-written ones in worker/fixtures/.
//   CREAO_MODE=live npx tsx scripts/hello-creao.ts [--record] [--seat evidence_analyst]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, REPO_ROOT, type Seat } from '../worker/src/env';
import { apiPath, resolveAgents, startRun, waitForRun } from '../worker/src/creao';

config.creao.mode = 'live';
const record = process.argv.includes('--record');
const only = process.argv.includes('--seat') ? process.argv[process.argv.indexOf('--seat') + 1] : null;

const CASES: Record<Seat, unknown> = {
  evidence_analyst: { claim_id: 'C-TEST1', order: { item: 'Ceramic mug', category: 'home', amount: 24, purchased_day: 3, delivered_day: 6 }, claim: { reason_code: 'defective', reason_text: 'Arrived with a chip on the rim' }, reference: { description: 'White ceramic mug, 350 ml, blue band near the rim', listing_image_urls: [] }, policy: { window_days: 30, requires_video_over: 100, notes: '' }, challenge: { fingers: 2 }, frames: [], deterministic_checks: { fresh: true, duration_s: 11, frame_reuse: [] } },
  refund_investigator: { claim_id: 'C-TEST2', amount_requested: 249, controller_threshold: 500, order: { item: 'Noise-cancelling headphones', category: 'electronics', amount: 249, purchased_day: 10, delivered_day: 14, claim_day: 18 }, claim: { reason_code: 'defective', reason_text: 'Left ear cup cracked out of the box' }, policy: { window_days: 30, restocking_fee_pct: 0, store_credit_allowed: true, notes: 'Physical damage from misuse is not covered' }, evidence: { item_matches_reference: { value: 'true', confidence: 0.9 }, claimed_defect_visible: { value: 'true', confidence: 0.85, frames: [3, 4] }, defect_consistent_with_claim: { value: 'true', damage_type: 'manufacturing' }, challenge: { expected: 3, seen: 3, passed: true }, capture_flags: [], unable_to_verify: false }, deterministic_checks: { fresh: true, duration_s: 14, frame_reuse: [], within_window: true }, history: { agent_id: 'A-00421', score: 684, band: 'neutral', account_age_days: 120, purchases_completed: 38, businesses: 6, refunds_requested_90d: 2, refunds_accepted_total: 3, refunds_declined_total: 0, refund_ratio_90d: 0.08, recent_credit_events: [{ id: 'CE-1042', day: 12, kind: 'refund_accepted', delta: 12 }] }, credential: { presented: true, verified: true, failed_step: null, issuer: 'B-019', claims: { completed_purchases_gte: 10, refund_ratio_band: 'low', no_confirmed_fraud_180d: true } }, patterns: [] },
  refund_reviewer: { claimId: 'C-TEST3', businessId: 'B-002', tierLabel: 'Instant refund', recommendation: { tier: 'T1', action: 'refund_full', refundNowCents: 8900, refundOnReturnCents: 0, returnRequired: false, reasons: ['Both spoken claims are shown on camera.'], evidenceRequests: [] }, score: { pLegit: 0.88, evidenceSupport: 0.91, coverage: 1, integrity: 0.97 }, claimSummary: { claimsFrom: 'transcript', claims: [{ id: 'c1', kind: 'defect', text: 'the left earbud does not charge', tSaid: 4.2 }] }, findings: [{ id: '1', kind: 'supports', spokenClaimId: 'c1', observation: 'The case light stays off while the right earbud lights up between 00:06 and 00:09.', tStart: 6, tEnd: 9, confidence: 0.86, method: 'probe:luminance', auditStatus: 'passed' }], integrity: { flags: [], challenge: { expected: 2, status: 'passed' } }, history: { orders: 38, refundsYear: 3, ratio: 0.9, anomaly: 0.1 }, limits: [] },
  customer_liaison: { claimId: 'C-TEST3', tierLabel: 'Instant refund', recommendation: { tier: 'T1', action: 'refund_full', refundNowCents: 8900, evidenceRequests: [] }, review: { agrees: true, businessSummary: 'The footage shows the earbud failing to charge; history is clean.', concerns: [] } },
  pattern_analyst: { pattern: { id: 'FR-028', kind: 'coordinated', detector: 'coordinated', version: 1, first_day: 1, last_day: 9, features: { agents: 7, regions: 6, businesses: 4, claim_window_hours: 31, text_similarity: 0.86 } }, events: [{ id: 'R-5521', table: 'refund', day: 8, agent: 'A-01877', business: 'B-002', item: 'Wireless earbuds', sku: 'EB-200', amount: 89, reason_text: 'Received the wireless earbuds and the button was faulty right away, it does not work at all. Please refund.', why: 'claim within 31h of 6 similar claims' }], agents: [{ id: 'A-01877', score: 640, account_age_days: 22, purchases_completed: 3, refund_ratio_90d: 0.67 }], business_context: [{ business: 'B-002', sku: 'EB-200', claims_last_30d: 4, units_sold_last_30d: 300 }], prior_reviews: [] },
};

console.log(`CREAO API path: ${apiPath()}`);
const ids = await resolveAgents();
for (const seat of Object.keys(CASES) as Seat[]) {
  if (only && seat !== only) continue;
  const t0 = Date.now();
  const h = await startRun(seat, CASES[seat], `hello-${seat}`);
  console.log(`\n${seat} (${ids[seat]}): run ${h.runId} started; polling every ${config.creao.pollMs / 1000}s`);
  const r = await waitForRun(h, CASES[seat], (s) => console.log(`  ${s}`));
  console.log(`  ${r.status} after ${Math.round((Date.now() - t0) / 1000)} s\n  ${r.text?.slice(0, 1200)}`);
  if (record && r.status === 'completed' && r.text) {
    const name = { evidence_analyst: 'consistent', refund_investigator: 'accept', pattern_analyst: 'confirm', refund_reviewer: 'agree', customer_liaison: 'message' }[seat];
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const file = resolve(REPO_ROOT, `worker/fixtures/${seat}.recorded.${name}.json`);
      writeFileSync(file, JSON.stringify({ _fixture: `recorded from run ${h.runId} on ${new Date().toISOString()}`, ...JSON.parse(m[0]) }, null, 2));
      console.log(`  saved ${file}`);
    }
  }
}
process.exit(0);
