import { schema, table, t } from 'spacetimedb/server';

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

const patternEvent = table({ name: 'pattern_event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  patternId: t.u32().index(),
  eventTable: t.string(), // purchase | refund
  eventId: t.u64(),
  day: t.u32(),
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

export const spacetimedb = schema({
  role, seatCode, counter, simRun, simTick, agent, agentTruth, shopperLink, business, purchase, refundIntent, refund,
  creditEvent, eventFeed, regionStat, fraudPattern, patternEvent, claim, evidence, agentRun, control, decision,
  journalEntry, journalLine, credential, verification, labJob, labEvent, metrics, latencyPing, benchResult,
});
export default spacetimedb;
