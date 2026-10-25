import { schema, table, t } from 'spacetimedb/server';
import {
  financeAccount, financeAgentRun, financeAudit, financeBridge, financeClose, financeCluster, financeCompany, financeCompanyState, financeEntry,
  financeExposureLog, financeExposureProposal, financeLine, financeObligation, financePeriod, financePrecedent, financeProduct, financeQueue,
  financeRequest, financeReserve, financeReturnPlan, financeScore, financeSimClaim, financeSimEvent, financeSimState, financeSimTruth,
  financeStatsHourly, financeTickSchedule, financeVouchLedger, financeVouchSignal,
} from './finance-schema';

// One schema() call for the whole module. The economy's tables match the row
// types in simdb.ts column for column, because the same engine (sim.ts) runs
// here and in memory for the detector evaluator.
//
// Visibility: public tables carry pseudonymous ids, amounts, statuses and
// aggregates. Who is honest and who is in a ring (agent_truth), what a
// simulated agent plans to claim (refund_intent), which identity is which
// shopper (shopper_link) and the seat codes stay private to reducers.

const role = table({ name: 'role', public: true }, {
  who: t.identity().primaryKey(),
  role: t.string(), // worker | poster | business | controller
  label: t.string(),
  businessId: t.u16(), // the store a business seat is acting for (switcher on /business)
});

const seatCode = table({ name: 'seat_code' }, {
  role: t.string().primaryKey(), // business | controller
  code: t.string(),
});

const counter = table({ name: 'counter' }, {
  key: t.string().primaryKey(), // live_agent | pattern | credential_status | lab_job
  value: t.u64(),
});

const simRun = table({ name: 'sim_run', public: true }, {
  id: t.u8().primaryKey(),
  seed: t.u64(),
  day: t.u32(),
  cursor: t.u32(),
  agentsPerTick: t.u32(),
  tickMicros: t.u64(),
  running: t.bool(),
  rngState: t.u64(),
  population: t.u32(),
  seeded: t.bool(),
  maxDay: t.u32(),
  eventSeq: t.u64(),
  startDay: t.u32(),
  rings: t.u32(),
});

export const simTick = table({ name: 'sim_tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const agent = table({ name: 'agent', public: true }, {
  id: t.u32().primaryKey(),
  region: t.u16().index(),
  lat: t.f64(),
  lng: t.f64(),
  homeRegionName: t.string(),
  cash: t.i64(),
  score: t.u16(),
  band: t.string(),
  purchases: t.u32(),
  refunds: t.u32(),
  refundsAccepted: t.u32(),
  isLive: t.bool(),
  lastActiveDay: t.u32(),
  keptWindowStart: t.u32(),
  keptInWindow: t.u8(),
  serialPenaltyDay: t.i32(),
});

const agentTruth = table({ name: 'agent_truth' }, {
  agentId: t.u32().primaryKey(),
  kind: t.string(), // honest | opportunist | serial | ring | live | showcase
  ringId: t.u32().index(),
});

const shopperLink = table({ name: 'shopper_link' }, {
  who: t.identity().primaryKey(),
  agentId: t.u32().index(),
  name: t.string(),
});

const business = table({ name: 'business', public: true }, {
  id: t.u16().primaryKey(),
  name: t.string(),
  region: t.u16(),
  lat: t.f64(),
  lng: t.f64(),
  category: t.string(),
  balance: t.i64(),
  inventory: t.u32(),
  policy: t.string(), // Policy JSON (world.ts)
  issuerPublicKey: t.string(), // Ed25519, base64 SPKI; the private key lives only in the worker
  sales: t.u32(),
  refundsPaid: t.u32(),
});

const purchase = table({ name: 'purchase', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  buyer: t.u32().index(),
  business: t.u16().index(),
  item: t.u16(),
  category: t.string(),
  amount: t.u32(), // cents
  day: t.u32(),
  deliverDay: t.u32().index(),
  windowEndDay: t.u32().index(),
  status: t.string(), // ordered | delivered | kept | refund_requested | refunded
  source: t.string(), // sim | live | showcase
});

const refundIntent = table({ name: 'refund_intent' }, {
  purchaseId: t.u64().primaryKey(),
  claimDay: t.u32().index(),
  reasonCode: t.string(),
  reasonText: t.string(),
  falseClaim: t.bool(),
});

const refund = table({ name: 'refund', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  purchaseId: t.u64().index(),
  agentId: t.u32().index(),
  businessId: t.u16().index(),
  amount: t.u32(),
  day: t.u32(),
  reasonCode: t.string(),
  reasonText: t.string(),
  status: t.string(), // requested | investigating | recommended | awaiting_controller | more_evidence | accepted | declined | withdrawn
  decidedDay: t.u32(),
  source: t.string().index(),
  decideDay: t.u32().index(),
  resolveDay: t.u32().index(),
  path: t.string(), // fast | investigation
});

const creditEvent = table({ name: 'credit_event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  agentId: t.u32().index(),
  day: t.u32(),
  kind: t.string(),
  delta: t.i32(),
  before: t.u16(),
  after: t.u16(),
  causeTable: t.string(), // purchase | refund | fraud_pattern | agent
  causeId: t.u64(),
});

const eventFeed = table({ name: 'event_feed', public: true }, {
  slot: t.u16().primaryKey(), // seq mod 512: a ring buffer, so browsers hold at most 512 rows
  seq: t.u64(),
  day: t.u32(),
  kind: t.string(),
  agentId: t.u32(),
  businessId: t.u16(),
  amount: t.u32(),
  refId: t.u64(),
  line: t.string(),
});

const regionStat = table({ name: 'region_stat', public: true }, {
  regionId: t.u16().primaryKey(),
  name: t.string(),
  lat: t.f64(),
  lng: t.f64(),
  agents: t.u32(),
  purchases: t.u32(),
  salesCents: t.u64(),
  refundsRequested: t.u32(),
  accepted: t.u32(),
  declined: t.u32(),
  pending: t.u32(),
  lossCents: t.u64(), // accepted claims that were false, measured against private truth
  honestDeclines: t.u32(), // genuine claims sent to more evidence or declined
  fraudFlags: t.u32(),
  scoreHist: t.array(t.u32()),
});

/**
 * Persistent day buckets for merchant money flow. Updated in recordPurchase /
 * settleRefund (accepted only). businessId 0 is the all-merchants rollup.
 * Do not derive charts from event_feed — that is a 512-row ring.
 */
const merchantFlowDay = table({ name: 'merchant_flow_day', public: true }, {
  key: t.string().primaryKey(), // `${businessId}:${day}`
  businessId: t.u16().index(),
  day: t.u32().index(),
  purchaseCents: t.u64(),
  refundPaidCents: t.u64(), // accepted / paid only — requested is not money out
  purchases: t.u32(),
  refundsPaid: t.u32(),
});

const fraudPattern = table({ name: 'fraud_pattern', public: true }, {
  id: t.u32().primaryKey(), // shown as FR-028
  kind: t.string(), // false_defect | refund_frequency | coordinated
  status: t.string(), // detected | reviewing | confirmed | dismissed | needs_review | awaiting_review
  detectorId: t.string(),
  detectorVersion: t.u32(),
  firstDay: t.u32(),
  lastDay: t.u32(),
  agentIds: t.array(t.u32()),
  businessIds: t.array(t.u16()),
  features: t.string(), // JSON
  runId: t.string(),
  runUrl: t.string(),
  narrative: t.string(),
  rolesJson: t.string(), // Pattern Analyst's per-agent roles
  signature: t.string().unique(), // detector + version + sorted agents: never flag the same thing twice
  flaggedDay: t.u32(),
  reviewedDay: t.u32(),
});

/** Everything Replay needs, denormalised so the browser subscribes to one small table per pattern. */
const patternEvent = table({ name: 'pattern_event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  patternId: t.u32().index(),
  eventTable: t.string(), // purchase | refund
  eventId: t.u64(),
  kind: t.string(), // purchase | delivery | refund
  agentId: t.u32(),
  businessId: t.u16(),
  amount: t.u32(),
  day: t.u32(),
  text: t.string(), // claim text for refunds, item name for purchases
  why: t.string(),
});

const claim = table({ name: 'claim', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  refundId: t.u64().index(),
  agentId: t.u32(),
  nonce: t.string(),
  fingerCount: t.u8(),
  videoUrl: t.string(),
  frameUrls: t.array(t.string()),
  frameHashes: t.array(t.string()),
  checksJson: t.string(), // deterministic checks: freshness, duration, reuse, policy fit
  status: t.string(), // awaiting_video | frames_ready | investigating | recommended | offline | more_evidence | decided | review_only
  kind: t.string(), // live | simulated
  createdAt: t.timestamp(),
});

const evidence = table({ name: 'evidence', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  claimId: t.u64().index(),
  seat: t.string(), // evidence_analyst | refund_investigator | system
  runId: t.string(),
  runUrl: t.string(),
  json: t.string(),
  provenance: t.string(), // live | fixture | replay
  at: t.timestamp(),
});

const agentRun = table({ name: 'agent_run', public: true }, {
  runId: t.string().primaryKey(),
  seat: t.string(), // evidence_analyst | refund_investigator | pattern_analyst
  caseRef: t.string(), // C-12 | FR-028
  status: t.string(), // running | completed | failed | cancelled
  runUrl: t.string(),
  conversationId: t.string(),
  mode: t.string(), // live | fixture
  stepsJson: t.string(),
  startedAt: t.timestamp(),
  finishedAt: t.option(t.timestamp()),
});

const control = table({ name: 'control', public: true }, {
  key: t.string().primaryKey(), // creao_enabled | demo_mode | lab_enabled
  value: t.string(),
  updatedAt: t.timestamp(),
});

const decision = table({ name: 'decision', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  refundId: t.u64().index(),
  action: t.string(), // the Investigator's recommendation: accept | decline | more_evidence
  amount: t.u32(),
  method: t.string(),
  confidence: t.f64(),
  reasonsJson: t.string(),
  runId: t.string(),
  runUrl: t.string(),
  status: t.string(), // proposed | sent_to_controller | decided | posted
  finalAction: t.string(), // what the person chose
  finalAmount: t.u32(),
  proposedBy: t.identity(),
  decidedBy: t.option(t.identity()),
  postedBy: t.option(t.identity()),
  note: t.string(),
  at: t.timestamp(),
});

const journalEntry = table({ name: 'journal_entry', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  decisionId: t.u64().index(),
  memo: t.string(),
  postedBy: t.identity(),
  at: t.timestamp(),
});

const journalLine = table({ name: 'journal_line', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  entryId: t.u64().index(),
  account: t.string(),
  cents: t.i64(), // positive debit, negative credit
});

const credential = table({ name: 'credential', public: true }, {
  id: t.string().primaryKey(), // VC-7f3a
  issuer: t.u16(),
  holder: t.string(), // did:vouch:agent:<pubkey hash>; never the raw history
  issuedDay: t.u32(),
  expiresDay: t.u32(),
  statusIndex: t.u32(),
  revoked: t.bool(),
  digests: t.array(t.string()),
  sig: t.string(),
});

const verification = table({ name: 'verification', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  credentialId: t.string(),
  verifier: t.u16(),
  refundId: t.u64(),
  tamper: t.bool(),
  status: t.string(), // requested | done
  stepsJson: t.string(),
  passed: t.bool(),
  failedStep: t.u8(),
  revealedJson: t.string(),
  at: t.timestamp(),
});

const labJob = table({ name: 'lab_job', public: true }, {
  id: t.u32().primaryKey(),
  trigger: t.string(), // event | schedule | user | agent
  goal: t.string(),
  detectorId: t.string(),
  status: t.string(), // queued | running | succeeded | failed | promote_requested | promoted | rejected | cancelled
  seed: t.u64(), // the simulation run it belongs to (6 jobs per run at most)
  mode: t.string(), // live | replay
  candidateDir: t.string(),
  summary: t.string(),
  scoresJson: t.string(),
  createdAt: t.timestamp(),
  finishedAt: t.option(t.timestamp()),
});

const labEvent = table({ name: 'lab_event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  jobId: t.u32().index(),
  kind: t.string(), // plan | tool_call | tool_result | diff | metrics | verdict | promoted | log
  text: t.string(),
  json: t.string(),
  at: t.timestamp(),
});

const metrics = table({ name: 'metrics', public: true }, {
  id: t.u8().primaryKey(),
  eventsTotal: t.u64(),
  eventsLastTick: t.u32(),
  stepsTotal: t.u64(),
  stepsLastTick: t.u32(),
  lastTickAt: t.timestamp(),
  lastTickMicros: t.u64(), // wall time the last tick took inside the module
  ticksObserved: t.u64(),
  rowCounts: t.string(), // JSON, refreshed every 25 ticks
});

const latencyPing = table({ name: 'latency_ping', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  who: t.identity(),
  clientSentMs: t.f64(),
  serverAt: t.timestamp(),
});

const benchResult = table({ name: 'bench_result', public: true }, {
  id: t.u32().primaryKey().autoInc(),
  agents: t.u32(),
  days: t.u32(),
  stepsPerSec: t.f64(),
  daysPerMin: t.f64(),
  machine: t.string(),
  ranAt: t.string(),
});

// ---- the video reviewer (worker-written; see review.ts for who may write what)

const analysisJob = table({ name: 'analysis_job', public: true }, {
  id: t.u64().primaryKey(), // claim × 100 + attempt, chosen by the worker
  claimId: t.u64().index(),
  status: t.string(), // running | done | lanes_only | failed
  mode: t.string(), // live (Droid ran) | lanes_only (no Droid) | replay
  startedAt: t.timestamp(),
  finishedAt: t.option(t.timestamp()),
  costNote: t.string(),
  droidSessions: t.u8(),
});

const analysisStep = table({ name: 'analysis_step', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  jobId: t.u64().index(),
  key: t.string(), // ingest | transcript | frames | integrity | droid_case | proof | audit | score | review | decision
  status: t.string(), // pending | running | done | failed | skipped
  startedAt: t.option(t.timestamp()),
  finishedAt: t.option(t.timestamp()),
  summary: t.string(),
  liveNote: t.string(), // the latest line Droid streamed, shown on the phone tracker
});

const artifact = table({ name: 'artifact', public: true }, {
  id: t.u64().primaryKey(), // job × 1000 + n
  jobId: t.u64().index(),
  kind: t.string(), // frame | mosaic | crop | clip | transcript | measurement | chart | script | video | audio | log
  path: t.string(), // relative to cases/<claimId>/
  url: t.string(), // signed, expiring
  tStart: t.f64(),
  tEnd: t.f64(),
  label: t.string(),
  sha256: t.string(),
});

const finding = table({ name: 'finding', public: true }, {
  id: t.u64().primaryKey(), // job × 1000 + n
  jobId: t.u64().index(),
  kind: t.string(), // supports | contradicts | neutral | integrity
  spokenClaimId: t.string(), // the spoken claim (c1, c2…) or '' for integrity
  observation: t.string(),
  tStart: t.f64(),
  tEnd: t.f64(),
  confidence: t.f64(),
  artifactIds: t.array(t.u64()),
  method: t.string(), // looked | probe:luminance | probe:audio | ocr | …
  auditStatus: t.string(), // pending | passed | rejected
  auditNote: t.string(),
});

const report = table({ name: 'report', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  claimId: t.u64().index(),
  jobId: t.u64(),
  json: t.string(), // Report (module/src/review-types.ts)
  markdownPath: t.string(),
  proofReelUrl: t.string(),
  auditPassed: t.bool(),
  at: t.timestamp(),
});

const claimScore = table({ name: 'claim_score', public: true }, {
  claimId: t.u64().primaryKey(),
  jobId: t.u64(),
  eSupport: t.f64(),
  coverage: t.f64(),
  integrity: t.f64(),
  pLegit: t.f64(),
  anomaly: t.f64(),
  excessRefundRatio: t.f64(),
  featuresJson: t.string(),
  formulaVersion: t.string(),
});

/**
 * A purchase of one of the 100 partner companies' products. The purchase itself runs through a
 * main-world store of the same category, so the claim, video review and phone flow are unchanged;
 * this row says which partner product it really was, and is the reviewer's ground truth for it.
 */
const partnerOrder = table({ name: 'partner_order', public: true }, {
  purchaseId: t.u64().primaryKey(),
  companyId: t.u16(),
  companyName: t.string(),
  sku: t.string(),
  name: t.string(),
  description: t.string(),
  priceCents: t.u32(),
});

/**
 * How a real claim changed the shopper's Vouch score, judged after the decision by the CREAO Score
 * Reviewer and bounded by code. One row per refund; the business side shows it with its reason.
 */
const scoreReview = table({ name: 'score_review', public: true }, {
  refundId: t.u64().primaryKey(),
  agentId: t.u32().index(),
  direction: t.string(), // gain | loss | same
  delta: t.i32(),
  before: t.u16(),
  after: t.u16(),
  reason: t.string(),
  decision: t.string(), // accepted | declined
  runId: t.string(),
  provenance: t.string(), // live | fixture | rule
  at: t.timestamp(),
});

const recommendation = table({ name: 'recommendation', public: true }, {
  claimId: t.u64().primaryKey(),
  jobId: t.u64(),
  tier: t.string(), // T1..T5
  refundNow: t.u32(),
  refundOnReturn: t.u32(),
  returnRequired: t.bool(),
  reasonsJson: t.string(),
  creaoReview: t.string(), // the Refund Reviewer's JSON, or '' when offline
  creaoRunId: t.string(),
  autoDecided: t.bool(),
  at: t.timestamp(),
});

// ---- the returns pulse and the Returns Monitor's notes (worker-written; see pulse.ts)

const returnsPulse = table({ name: 'returns_pulse', public: true }, {
  id: t.u8().primaryKey(), // 1: the latest window
  windowSeconds: t.u16(),
  returns: t.u32(), // refund rows that arrived in the window (wall clock)
  perSecond: t.f64(),
  baselinePerSecond: t.f64(), // the ten minutes before the window
  itemsJson: t.string(), // [{ sku, name, count, perSecond, baselinePerSecond, spike }]
  businessesJson: t.string(), // [{ id, name, count }]
  cohortsJson: t.string(), // [{ band, count }] by the shopper's credit band
  spikes: t.u16(),
  computedAt: t.timestamp(),
});

const monitorNote = table({ name: 'monitor_note', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  runId: t.string(),
  runUrl: t.string(),
  trigger: t.string(), // schedule | spike | manual
  json: t.string(), // the Returns Monitor's JSON plus the scraped context it was given
  provenance: t.string(), // live | fixture
  at: t.timestamp(),
});

export const spacetimedb = schema({
  role, seatCode, counter, simRun, simTick, agent, agentTruth, shopperLink, business, purchase, refundIntent, refund,
  creditEvent, eventFeed, regionStat, merchantFlowDay, fraudPattern, patternEvent, claim, evidence, agentRun, control, decision,
  journalEntry, journalLine, credential, verification, labJob, labEvent, metrics, latencyPing, benchResult,
  analysisJob, analysisStep, artifact, finding, report, claimScore, recommendation, partnerOrder, scoreReview, returnsPulse, monitorNote,
  // The Refund Finance Desk (finance-schema.ts). Nothing above reads these.
  financeCompany, financeProduct, financeAccount, financePeriod, financeRequest, financeEntry, financeLine, financeObligation,
  financeAudit, financeQueue, financePrecedent, financeReserve, financeClose, financeBridge, financeCluster,
  financeSimState, financeTickSchedule, financeStatsHourly, financeCompanyState, financeSimClaim, financeSimTruth, financeReturnPlan,
  financeSimEvent, financeVouchLedger, financeVouchSignal, financeExposureLog, financeExposureProposal, financeAgentRun, financeScore,
});
export default spacetimedb;
