import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole, roleOf, worldOf, type Ctx } from './ctx';
import { enqueueLabJob } from './lab';
import { agentLabel, businessLabel, dollars, patternLabel, refundLabel, settleRefund } from './sim';
import type { RefundRow } from './simdb';

// Segregation of duties, enforced in the database. The worker proposes (it
// relays the Refund Investigator's recommendation), a person decides, a
// separate poster identity writes the journal. Whoever proposes cannot
// decide; whoever decides cannot post; entries must balance; accepting
// more than $500 needs the controller.

export const MATERIALITY_CENTS = 50_000;
const OPEN = ['investigating', 'recommended', 'awaiting_controller', 'more_evidence'];

export function proposeImpl(
  ctx: Ctx,
  a: { refundId: bigint; action: string; amount: number; method: string; confidence: number; reasonsJson: string; runId: string; runUrl: string },
) {
  requireRole(ctx, 'worker');
  const r = ctx.db.refund.id.find(a.refundId);
  if (!r || !OPEN.includes(r.status)) throw new Error('no open refund to propose on');
  if (!['accept', 'decline', 'more_evidence'].includes(a.action)) throw new Error('action must be accept, decline or more_evidence');
  if (a.amount > r.amount) throw new Error('a recommendation can never exceed the amount requested');
  JSON.parse(a.reasonsJson);
  for (const d of ctx.db.decision.refundId.filter(a.refundId)) {
    if (d.status === 'proposed' || d.status === 'sent_to_controller') ctx.db.decision.id.update({ ...d, status: 'superseded' });
  }
  const d = ctx.db.decision.insert({
    id: 0n, refundId: a.refundId, action: a.action, amount: a.amount, method: a.method, confidence: a.confidence, reasonsJson: a.reasonsJson,
    runId: a.runId, runUrl: a.runUrl, status: 'proposed', finalAction: '', finalAmount: 0, proposedBy: ctx.sender, decidedBy: undefined,
    postedBy: undefined, note: '', at: ctx.timestamp,
  });
  ctx.db.refund.id.update({ ...r, status: 'recommended' });
  for (const c of ctx.db.claim.refundId.filter(a.refundId)) ctx.db.claim.id.update({ ...c, status: c.status === 'review_only' ? c.status : 'recommended' });
  return d;
}

export const propose = spacetimedb.reducer(
  { refundId: t.u64(), action: t.string(), amount: t.u32(), method: t.string(), confidence: t.f64(), reasonsJson: t.string(), runId: t.string(), runUrl: t.string() },
  (ctx, a) => {
    proposeImpl(ctx, a);
  },
);

function openProposal(ctx: Ctx, refundId: bigint) {
  let best: ReturnType<typeof ctx.db.decision.insert> | undefined;
  for (const d of ctx.db.decision.refundId.filter(refundId)) {
    if ((d.status === 'proposed' || d.status === 'sent_to_controller') && (!best || d.id > best.id)) best = d;
  }
  return best;
}

export function decideImpl(ctx: Ctx, refundId: bigint, action: string, amount: number, note: string) {
  const seat = requireRole(ctx, 'business', 'controller');
  const r = ctx.db.refund.id.find(refundId);
  if (!r || !OPEN.includes(r.status)) throw new Error('this refund is not open');
  if (seat.role === 'business' && seat.businessId !== r.businessId) throw new Error(`switch to ${businessLabel(r.businessId)} to decide this refund`);
  if (!['accept', 'decline', 'more_evidence'].includes(action)) throw new Error('action must be accept, decline or more_evidence');
  const d = openProposal(ctx, refundId);
  if (d && d.proposedBy.isEqual(ctx.sender)) throw new Error('the proposer cannot decide its own proposal');
  // No recommendation means the investigators are offline: a person may only ask for more evidence.
  if (!d && action !== 'more_evidence') throw new Error('Investigator offline: request more evidence');
  const w = worldOf(ctx);
  const claimStatus = (s: string) => {
    for (const c of ctx.db.claim.refundId.filter(refundId)) ctx.db.claim.id.update({ ...c, status: c.status === 'review_only' ? c.status : s });
  };

  if (action === 'more_evidence') {
    ctx.db.refund.id.update({ ...r, status: 'more_evidence' });
    claimStatus('more_evidence');
    if (d) ctx.db.decision.id.update({ ...d, status: 'decided', finalAction: action, finalAmount: 0, decidedBy: ctx.sender, note });
    w.feed('decision', r.agentId, r.businessId, 0, r.id, `[Decision] ${businessLabel(r.businessId)} asked ${agentLabel(r.agentId)} for more evidence on ${refundLabel(r.id)}`);
    w.commit();
    return;
  }

  const pay = action === 'accept' ? Math.min(amount || d!.amount || r.amount, r.amount) : 0;
  if (action === 'accept' && pay > MATERIALITY_CENTS && seat.role !== 'controller') {
    ctx.db.decision.id.update({ ...d!, status: 'sent_to_controller', note });
    ctx.db.refund.id.update({ ...r, status: 'awaiting_controller' });
    w.feed('decision', r.agentId, r.businessId, pay, r.id, `[Decision] ${refundLabel(r.id)} ${dollars(pay)} sent to the controller (above $500)`);
    w.commit();
    return;
  }

  settleRefund(w, r as RefundRow, action === 'accept' ? 'accepted' : 'declined', pay, action === 'accept' ? 'evidence' : 'person');
  ctx.db.decision.id.update({ ...d!, status: 'decided', finalAction: action, finalAmount: pay, decidedBy: ctx.sender, note });
  claimStatus('decided');
  w.feed('decision', r.agentId, r.businessId, pay, r.id,
    `[Decision] ${businessLabel(r.businessId)} ${action === 'accept' ? `accepted ${refundLabel(r.id)} ${dollars(pay)}` : `declined ${refundLabel(r.id)}`}${d!.action !== action ? ' (overrode the Investigator)' : ''}`);
  w.commit();

  // Event trigger for the Droid Lab: a person overrode a recommendation on an agent a detector flagged.
  if (d!.action !== action) {
    for (const p of ctx.db.fraudPattern.iter()) {
      if (p.agentIds.includes(r.agentId)) {
        enqueueLabJob(ctx, 'event', `Detector ${p.detectorId} flagged ${agentLabel(r.agentId)} in ${patternLabel(p.id)} and a person overrode the recommendation. Reduce false positives without losing recall.`, p.detectorId);
        break;
      }
    }
  }
}

/** accept | decline | more_evidence. The business seat decides; above $500 the controller does. */
export const decide = spacetimedb.reducer(
  { refundId: t.u64(), action: t.string(), amount: t.u32(), note: t.string() },
  (ctx, a) => decideImpl(ctx, a.refundId, a.action, a.amount, a.note),
);

const Line = t.object('Line', { account: t.string(), cents: t.i64() });

export function postImpl(ctx: Ctx, decisionId: bigint, memo: string, lines: { account: string; cents: bigint }[]) {
  if (roleOf(ctx)?.role !== 'poster') throw new Error('only the ledger poster may post');
  const d = ctx.db.decision.id.find(decisionId);
  if (!d || d.status !== 'decided' || d.finalAction !== 'accept') throw new Error('only an accepted decision can be posted');
  if (d.proposedBy.isEqual(ctx.sender) || d.decidedBy?.isEqual(ctx.sender)) throw new Error('the poster cannot also propose or decide');
  if (lines.length < 2) throw new Error('an entry needs at least two lines');
  const sum = lines.reduce((s, l) => s + l.cents, 0n);
  if (sum !== 0n) throw new Error(`entry does not balance: ${sum} cents`); // the double-entry invariant
  const debits = lines.reduce((s, l) => s + (l.cents > 0n ? l.cents : 0n), 0n);
  if (debits !== BigInt(d.finalAmount)) throw new Error('entry total must equal the accepted amount');
  const e = ctx.db.journalEntry.insert({ id: 0n, decisionId, memo, postedBy: ctx.sender, at: ctx.timestamp });
  for (const l of lines) ctx.db.journalLine.insert({ id: 0n, entryId: e.id, account: l.account, cents: l.cents });
  ctx.db.decision.id.update({ ...d, status: 'posted', postedBy: ctx.sender });
  return e;
}

export const post = spacetimedb.reducer({ decisionId: t.u64(), memo: t.string(), lines: t.array(Line) }, (ctx, a) => {
  postImpl(ctx, a.decisionId, a.memo, a.lines);
});
