import { schema, table, t } from 'spacetimedb/server';

// One schema() call for the whole module. Reducer files import `spacetimedb`
// from here and index.ts re-exports them, so add a table here and a reducer
// in the file for its area (claims.ts, vouch.ts, desk.ts, ...).
//
// Privacy: public tables hold ids, hashes, tiers and reason codes only.
// Anything that could identify a person or carries image bytes is private.

/** A person or a shopping agent. Agents carry a principal and a mandate. */
const subject = table({ name: 'subject', public: true }, {
  id: t.string().primaryKey(), // hashed shopper id or agent id; never a raw identifier
  kind: t.string(), // person | agent
  tier: t.u8(), // 0..3, mirrors the live Vouch Record
  reasonCodes: t.array(t.string()),
  principalId: t.string(), // agents only: the human subject behind it; '' for people
  mandateJson: t.string(), // agents only: what it may buy, with caps; '' for people
  provenance: t.string(), // live | seeded | simulated
  updatedAt: t.timestamp(),
});

/** The stored, expiring Vouch Record the instant lane reads. Written by the Credit Analyst's run. */
const vouchRecord = table({ name: 'vouch_record', public: true }, {
  subjectId: t.string().primaryKey(),
  tier: t.u8(),
  reasonsJson: t.string(), // [{ text, field }] as the Credit Analyst returned them
  notFoundJson: t.string(),
  runId: t.string(), // the CREAO run that produced it; no record exists without one
  runUrl: t.string(),
  issuedAt: t.timestamp(),
  expiresAt: t.timestamp(),
  provenance: t.string(),
});

const shopOrder = table({ name: 'shop_order', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  subjectId: t.string(),
  amountCents: t.u32(),
  status: t.string(), // placed | delivered | returned
  provenance: t.string(),
  createdAt: t.timestamp(),
});

const claim = table({ name: 'claim', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  orderId: t.u64(),
  subjectId: t.string(),
  amountCents: t.u32(),
  kind: t.string(), // not_received | damaged | wrong_item | changed_mind
  status: t.string(), // new | adjudicating | decided | held
  lane: t.string(), // A | B | C | D | ''
  reasonCodes: t.array(t.string()),
  provenance: t.string(),
  createdAt: t.timestamp(),
});

/** Photo bytes are private: only reducers and the worker see them. Client downsizes to <= 400 KB. */
const photo = table({ name: 'photo', public: false }, {
  id: t.u64().primaryKey().autoInc(),
  claimId: t.u64().index(),
  source: t.string(), // vendor | courier | customer
  phash: t.string(),
  bytes: t.byteArray(),
});

/** Append-only, hash-chained. Hashes only, never personal data. */
const ledger = table({ name: 'ledger', public: true }, {
  seq: t.u64().primaryKey().autoInc(),
  subjectId: t.string(),
  kind: t.string(), // tier | incident | verdict | refund | killswitch
  payloadHash: t.string(),
  prevHash: t.string(),
  hash: t.string(),
  at: t.timestamp(),
});

const incident = table({ name: 'incident', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  subjectId: t.string(),
  claimId: t.u64(),
  reasonCode: t.string(),
  evidenceHash: t.string(),
  at: t.timestamp(),
});

/** One row per CREAO run. Powers "Open run" links and the kill-switch freshness check. */
const agentRun = table({ name: 'agent_run', public: true }, {
  runId: t.string().primaryKey(),
  seat: t.string(), // refund_desk | credit_analyst | agent_order | reconciler
  caseRef: t.string(),
  status: t.string(), // started | completed | failed | cancelled
  resultHash: t.string(),
  shareUrl: t.string(),
  startedAt: t.timestamp(),
  finishedAt: t.option(t.timestamp()),
});

/** Webhook dedupe: CREAO delivery is at-least-once, keyed by X-Creao-Delivery-Id. */
const webhookDelivery = table({ name: 'webhook_delivery', public: false }, {
  deliveryId: t.string().primaryKey(),
  at: t.timestamp(),
});

/** Key-value settings. `creao_enabled` is the kill switch. */
const config = table({ name: 'config', public: true }, {
  key: t.string().primaryKey(),
  value: t.string(),
  updatedAt: t.timestamp(),
});

/** The merchant's one editable policy object. Shape: MerchantPolicy in types.ts. */
const merchantPolicy = table({ name: 'merchant_policy', public: true }, {
  merchantId: t.string().primaryKey(),
  policyJson: t.string(),
  updatedAt: t.timestamp(),
});

/** Processor, bank and carrier events the Reconciler matches. Threadline generates them. */
const worldEvent = table({ name: 'world_event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  source: t.string(), // processor | bank | carrier | ledger
  kind: t.string(),
  ref: t.string(),
  payloadHash: t.string(),
  provenance: t.string(),
  at: t.timestamp(),
});

// Segregation of duties (see desk.ts)
const role = table({ name: 'role', public: true }, {
  who: t.identity().primaryKey(),
  role: t.string(), // router | proposer | approver | poster | controller
  label: t.string(), // e.g. desk-lead, refund-desk-agent, ledger-poster
});

const decision = table({ name: 'decision', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  caseRef: t.string(), // order, refund or subject id
  kind: t.string(), // refund_lane | ledger_adjust | tier_change
  amountCents: t.i64(),
  status: t.string(), // proposed | approved | rejected | posted
  proposedBy: t.identity(),
  approvedBy: t.option(t.identity()),
  postedBy: t.option(t.identity()),
  rule: t.string(), // rule id and version that applied
  evidenceHash: t.string(), // hash of the evidence bundle
  runUrl: t.string(), // the CREAO run that produced the proposal
  reason: t.string(),
  note: t.string(), // approver's note, including a refusal reason
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

/** Starts the nightly Reconciler window. */
export const nightly = table({ name: 'nightly' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

export const spacetimedb = schema({
  subject, vouchRecord, shopOrder, claim, photo, ledger, incident,
  agentRun, webhookDelivery, config, merchantPolicy, worldEvent,
  role, decision, journalEntry, journalLine, nightly,
});
export default spacetimedb;
