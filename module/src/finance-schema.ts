import { table, t } from 'spacetimedb/server';

// The Refund Finance Desk's tables. Every one is prefixed finance_ and keyed by
// company: the Desk reads the main refund flow, nothing in the main flow reads
// these. Money is integer cents (u32/u64, i64 where a difference can be
// negative); rates are basis points. Private tables (no public: true) hold the
// simulation's hidden truth: only reducers, and the in-module scorer, read them.

export const financeCompany = table({ name: 'finance_company', public: true }, {
  id: t.u16().primaryKey(),
  slug: t.string().unique(),
  name: t.string(),
  category: t.string(),
  size: t.u8(),
  tagline: t.string(),
  featured: t.bool(),
  status: t.string(), // active
});

export const financeProduct = table({ name: 'finance_product', public: true }, {
  sku: t.string().primaryKey(),
  companyId: t.u16().index(),
  name: t.string(),
  description: t.string(),
  priceCents: t.u32(),
  category: t.string(),
  active: t.bool(),
});

export const financeAccount = table({ name: 'finance_account', public: true }, {
  code: t.string().primaryKey(),
  name: t.string(),
  type: t.string(),
  note: t.string(),
});

/** A month of one company's book. Locked periods refuse every write (finance-ledger.ts). */
export const financePeriod = table({ name: 'finance_period', public: true }, {
  key: t.string().primaryKey(), // "<companyId>:<YYYY-MM>"
  companyId: t.u16().index(),
  period: t.string(),
  status: t.string(), // open | locked
  lockedBy: t.option(t.identity()),
  lockedAt: t.option(t.timestamp()),
  autoPostedCents: t.u64(),
});

/** A payment or adjustment someone asked for. The requester is never the preparer or the approver. */
export const financeRequest = table({ name: 'finance_request', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  kind: t.string(), // a posting rule from ledger.ts
  cents: t.u64(),
  period: t.string(),
  memo: t.string(),
  sourceRef: t.string().index(), // order:1000001 | claim:C-12 | sim:123 | cluster:4
  decisionRef: t.string(),
  formulaVersion: t.string(),
  evidenceIds: t.string(),
  processorRef: t.string(),
  requestedBy: t.identity(),
  requesterRole: t.string(),
  status: t.string(), // open | prepared | refused
  at: t.timestamp(),
});

/** Posted entries are append-only: a correction is a new entry. */
export const financeEntry = table({ name: 'finance_entry', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  period: t.string(),
  kind: t.string(),
  memo: t.string(),
  sourceRef: t.string().index(),
  requestId: t.u64(),
  status: t.string(), // posted | pending_approval | rejected
  cents: t.u64(),
  requestedBy: t.identity(),
  preparedBy: t.identity(),
  preparerRole: t.string(),
  approvedBy: t.option(t.identity()),
  decisionRef: t.string(),
  formulaVersion: t.string(),
  evidenceIds: t.string(),
  processorRef: t.string(),
  priorPeriodMemo: t.string(),
  autoPosted: t.bool(),
  at: t.timestamp(),
});

export const financeLine = table({ name: 'finance_line', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  entryId: t.u64().index(),
  companyId: t.u16().index(),
  account: t.string(),
  debit: t.u64(),
  credit: t.u64(),
});

/** A conditional second leg: open with a 30-day clock, closed as released, partial or lapsed. */
export const financeObligation = table({ name: 'finance_obligation', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  orderRef: t.string(),
  claimRef: t.string().index(),
  decisionRef: t.string(),
  tier: t.string(),
  category: t.string(),
  sku: t.string(),
  leg1Cents: t.u32(),
  leg2Cents: t.u32(),
  costCents: t.u32(),
  status: t.string().index(), // open | released | partial | lapsed
  openedHour: t.u32(),
  dueHour: t.u32().index(),
  closedHour: t.u32(),
  outcomeNote: t.string(),
  accruedCents: t.u32(), // the latest month-end accrual of this leg (0 if never accrued)
  accruedPeriod: t.string(),
  requestedBy: t.identity(), // who authorized the refund (leg 2 is released on their request, never the preparer's)
});

/** Every refusal of a control, naming the rule. Nothing deletes from here. */
export const financeAudit = table({ name: 'finance_audit', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  rule: t.string(),
  actorRole: t.string(),
  who: t.identity(),
  target: t.string(),
  detail: t.string(),
  refused: t.bool(),
  at: t.timestamp(),
});

/** The controller's queue: approvals, unexplained gaps, pause confirmations, questions from an investigator. */
export const financeQueue = table({ name: 'finance_queue', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  kind: t.string(), // approve_entry | unexplained | pause_confirm | question | writeoff
  title: t.string(),
  detailJson: t.string(),
  targetRef: t.string(),
  status: t.string(), // open | approved | rejected | answered | expired
  answer: t.string(),
  reason: t.string(),
  requestedBy: t.identity(),
  decidedBy: t.option(t.identity()),
  precedentId: t.u64(),
  at: t.timestamp(),
  decidedAt: t.option(t.timestamp()),
});

/** A controller's answer, kept so the next similar case cites it instead of asking again. */
export const financePrecedent = table({ name: 'finance_precedent', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  key: t.string().index(), // e.g. writeoff:small_diffs
  decision: t.string(),
  reason: t.string(),
  by: t.identity(),
  queueId: t.u64(),
  citedCount: t.u32(),
  at: t.timestamp(),
});

export const financeReserve = table({ name: 'finance_reserve', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  period: t.string(),
  openCount: t.u32(),
  openLeg2Cents: t.u64(),
  accruedCents: t.u64(),
  avgRateBp: t.u32(),
  resolvedAccruedCents: t.u64(), // the part of the accrual whose obligations have since resolved
  actualCents: t.u64(), // what those resolved obligations really paid on leg 2
  trueUpCents: t.i64(), // actual - resolvedAccrued: positive means the reserve was short
  ratesJson: t.string(),
  at: t.timestamp(),
});

/** One company-month's close: the three totals, the funnel and whether it may lock. */
export const financeClose = table({ name: 'finance_close', public: true }, {
  key: t.string().primaryKey(), // "<companyId>:<YYYY-MM>"
  companyId: t.u16().index(),
  period: t.string(),
  ledgerCents: t.i64(),
  processorCents: t.i64(),
  bankCents: t.i64(),
  events: t.u32(),
  matched: t.u32(),
  exceptions: t.u32(),
  closedByPlaybook: t.u32(),
  toInvestigator: t.u32(),
  toController: t.u32(),
  unexplainedCents: t.i64(),
  status: t.string(), // draft | ready | blocked | locked
  source: t.string(), // book (DuckDB, featured company) | lite (in-module)
  memo: t.string(),
  at: t.timestamp(),
});

/** The variance bridge: the gap between ledger, processor and bank, split by cause. Must foot to zero. */
export const financeBridge = table({ name: 'finance_bridge', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  period: t.string(),
  cause: t.string(),
  cents: t.i64(),
  orders: t.u32(),
  winner: t.string(),
  why: t.string(),
  explained: t.bool(),
  clusterId: t.u64(),
});

export const financeCluster = table({ name: 'finance_cluster', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  period: t.string(),
  cls: t.string(),
  status: t.string(), // playbook | proposed | explained | unexplained | controller | resolved
  cents: t.i64(),
  orders: t.u32(),
  winner: t.string(),
  reason: t.string(),
  playbook: t.string(),
  proposalJson: t.string(),
  explanation: t.string(),
  sampleRefs: t.string(),
  at: t.timestamp(),
});

// ---------------------------------------------------------------- the 100-company portfolio simulation

export const financeSimState = table({ name: 'finance_sim_state', public: true }, {
  id: t.u8().primaryKey(),
  running: t.bool(),
  hoursPerTick: t.u8(),
  seed: t.u64(),
  simHour: t.u32(),
  rngState: t.u64(),
  ticks: t.u64(),
  seeded: t.bool(),
  epochMs: t.u64(),
  lastTickMs: t.u64(),
  rowsLastTick: t.u32(),
  msLastTick: t.u32(),
});

export const financeTickSchedule = table({ name: 'finance_tick_schedule' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

/** Per company per simulated hour; kept for the last 7 simulated days (the exposure signals' window). */
export const financeStatsHourly = table({ name: 'finance_stats_hourly', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  simHour: t.u32().index(),
  orders: t.u32(),
  orderCents: t.u64(),
  claims: t.u32(),
  claimCents: t.u64(),
  flags: t.u32(),
  investigations: t.u32(),
  verifiedFraud: t.u32(),
  contradicted: t.u32(),
  ringCents: t.u64(),
  crossCompanyCatches: t.u32(),
  scoreSum: t.u32(),
  scoreN: t.u32(),
  // Appended with a default so existing Maincloud hourly rows migrate in place.
  refundOutCents: t.u64().default(0n),
});

/** One row per company: rolling totals, cash, the shoppers' average Vouch score, the rung. The screens subscribe here. */
export const financeCompanyState = table({ name: 'finance_company_state', public: true }, {
  companyId: t.u16().primaryKey(),
  orders: t.u32(),
  orderCents: t.u64(),
  claims: t.u32(),
  claimCents: t.u64(),
  refundedCents: t.u64(),
  flags: t.u32(),
  investigations: t.u32(),
  verifiedFraud: t.u32(),
  falseFlags: t.u32(), // flagged, investigated and cleared (observable: the investigation said so)
  crossCompanyCatches: t.u32(),
  scoreSum: t.u64(),
  scoreN: t.u32(),
  cashCents: t.i64(),
  openObligations: t.u32(),
  openLeg2Cents: t.u64(),
  unrecoveredLeg1Cents: t.u64(),
  delayedByPause: t.u32(),
  delayHoursSum: t.u64(),
  goodsBackUnits: t.u32(),
  goodsBackCents: t.u64(),
  rung: t.string(),
  rungSinceHour: t.u32(),
  signalsJson: t.string(),
  updatedHour: t.u32(),
});

/** One simulated refund claim. Observable fields only; who is really fraudulent is in finance_sim_truth. */
export const financeSimClaim = table({ name: 'finance_sim_claim', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  agentId: t.u32(),
  sku: t.string(),
  cents: t.u32(),
  tier: t.string(),
  score: t.u16(),
  band: t.string(),
  riskBp: t.u32(),
  flagged: t.bool(),
  reasons: t.string(),
  investigated: t.bool(),
  outcome: t.string(), // paid | pending | verified_fraud | cleared | review
  contradicted: t.bool(),
  clusterHash: t.string(),
  crossCompany: t.bool(),
  simHour: t.u32().index(),
  resolveHour: t.u32().index(),
  obligationId: t.u64(),
  source: t.string(), // sim | live
});

export const financeSimTruth = table({ name: 'finance_sim_truth' }, {
  claimId: t.u64().primaryKey(),
  archetype: t.string(),
  fraud: t.bool(),
  ringId: t.u32(),
  eventId: t.u64(),
});

/** When each obligation's return arrives and in what state: decided at open, hidden until the hour comes. */
export const financeReturnPlan = table({ name: 'finance_return_plan' }, {
  obligationId: t.u64().primaryKey(),
  hour: t.u32().index(),
  outcome: t.string(), // intact | swap | missing
});

/** Scripted events: rings, sale days, defect batches, outages. ids double as the answer key for the scorer. */
export const financeSimEvent = table({ name: 'finance_sim_event' }, {
  id: t.u64().primaryKey().autoInc(),
  kind: t.string(), // ring | sale_day | defect_batch | outage
  companyIds: t.array(t.u16()),
  startHour: t.u32(),
  endHour: t.u32(),
  paramsJson: t.string(),
  plantedBy: t.string(), // script | console
  at: t.timestamp(),
});

/** The public vouching ledger: salted hashes only, never a person. */
export const financeVouchLedger = table({ name: 'finance_vouch_ledger', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  shopperHash: t.string(),
  companyId: t.u16().index(),
  outcome: t.string(), // verified | contradicted | ring_linked | cleared
  scoreDelta: t.i32(),
  evidenceHash: t.string(),
  simHour: t.u32(),
});

/** Device, address or media hashes seen in a verified fraud outcome; the detector reads them across companies. */
export const financeVouchSignal = table({ name: 'finance_vouch_signal', public: true }, {
  hash: t.string().primaryKey(),
  companyId: t.u16(),
  simHour: t.u32(),
  hits: t.u32(),
});

export const financeExposureLog = table({ name: 'finance_exposure_log', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  companyId: t.u16().index(),
  fromRung: t.string(),
  toRung: t.string(),
  by: t.string(), // code | guardian | controller
  reason: t.string(),
  signalsJson: t.string(),
  simHour: t.u32(),
  at: t.timestamp(),
});

/** Latest Guardian (CREAO) proposal per company, as the code bounded it. */
export const financeExposureProposal = table({ name: 'finance_exposure_proposal', public: true }, {
  companyId: t.u16().primaryKey(),
  proposedRung: t.string(),
  allowedJson: t.string(),
  reason: t.string(),
  customerNotice: t.string(),
  expiresInHours: t.u32(),
  runId: t.string(),
  mode: t.string(), // live | mock | replay
  accepted: t.bool(),
  simHour: t.u32(),
});

/** Every CREAO run the Desk made, with its input, output and the Verifier's verdict. */
export const financeAgentRun = table({ name: 'finance_agent_run', public: true }, {
  runId: t.string().primaryKey(),
  seat: t.string(),
  companyId: t.u16().index(),
  caseRef: t.string().index(),
  status: t.string(), // running | done | rejected | failed
  mode: t.string(), // live | mock | replay
  inputJson: t.string(),
  outputJson: t.string(),
  valid: t.bool(),
  rejectReason: t.string(),
  runUrl: t.string(),
  agentId: t.string(),
  ms: t.u32(),
  at: t.timestamp(),
});

/** The Proof screen's numbers, written only by the scorer. */
export const financeScore = table({ name: 'finance_score', public: true }, {
  key: t.string().primaryKey(),
  label: t.string(),
  value: t.string(),
  detail: t.string(),
  at: t.timestamp(),
});
