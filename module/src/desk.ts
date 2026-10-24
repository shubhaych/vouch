import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';

// Segregation of duties, enforced in the database. Whoever proposes cannot
// decide; whoever decides cannot post; entries must balance; approvals above
// materiality need the controller. One identity holds one role.

// Editable policy value lives in merchant_policy.policyJson; this constant is
// the floor used until the worker reads the merchant's setting.
const MATERIALITY_CENTS = 50_000n;

const GRANTABLE = ['router', 'proposer', 'approver', 'poster'];

export const roleOf = (ctx: { db: any; sender: any }) =>
  ctx.db.role.who.find(ctx.sender)?.role as string | undefined;

export const requireRole = (ctx: { db: any; sender: any }, ...allowed: string[]) => {
  const r = roleOf(ctx);
  if (!r || !allowed.includes(r)) throw new Error(`requires role: ${allowed.join(' or ')}`);
  return r;
};

export const propose = spacetimedb.reducer(
  { caseRef: t.string(), kind: t.string(), amountCents: t.i64(), rule: t.string(), evidenceHash: t.string(), runUrl: t.string(), reason: t.string() },
  (ctx, a) => {
    if (roleOf(ctx) !== 'proposer') throw new Error('only a proposer agent may propose');
    ctx.db.decision.insert({
      id: 0n, caseRef: a.caseRef, kind: a.kind, amountCents: a.amountCents, status: 'proposed',
      proposedBy: ctx.sender, approvedBy: undefined, postedBy: undefined,
      rule: a.rule, evidenceHash: a.evidenceHash, runUrl: a.runUrl, reason: a.reason, note: '', at: ctx.timestamp,
    });
  });

export const decide = spacetimedb.reducer(
  { decisionId: t.u64(), approve: t.bool(), note: t.string() },
  (ctx, { decisionId, approve, note }) => {
    const r = roleOf(ctx);
    if (r !== 'approver' && r !== 'controller') throw new Error('only an approver or the controller may decide');
    const d = ctx.db.decision.id.find(decisionId);
    if (!d || d.status !== 'proposed') throw new Error('no open proposal');
    if (d.proposedBy.isEqual(ctx.sender)) throw new Error('the proposer cannot approve its own proposal');
    if (approve && d.amountCents > MATERIALITY_CENTS && r !== 'controller') throw new Error('above materiality: the controller must approve');
    ctx.db.decision.id.update({ ...d, status: approve ? 'approved' : 'rejected', approvedBy: ctx.sender, note });
  });

export const post = spacetimedb.reducer(
  { decisionId: t.u64(), memo: t.string(), lines: t.array(t.object('Line', { account: t.string(), cents: t.i64() })) },
  (ctx, { decisionId, memo, lines }) => {
    if (roleOf(ctx) !== 'poster') throw new Error('only the ledger poster may post');
    const d = ctx.db.decision.id.find(decisionId);
    if (!d || d.status !== 'approved') throw new Error('only an approved decision can be posted');
    if (d.proposedBy.isEqual(ctx.sender) || d.approvedBy?.isEqual(ctx.sender)) throw new Error('the poster cannot also propose or approve');
    if (lines.length < 2) throw new Error('an entry needs at least two lines');
    const sum = lines.reduce((s, l) => s + l.cents, 0n);
    if (sum !== 0n) throw new Error(`entry does not balance: ${sum} cents`); // double-entry invariant
    const e = ctx.db.journalEntry.insert({ id: 0n, decisionId, memo, postedBy: ctx.sender, at: ctx.timestamp });
    for (const l of lines) ctx.db.journalLine.insert({ id: 0n, entryId: e.id, account: l.account, cents: l.cents });
    ctx.db.decision.id.update({ ...d, status: 'posted', postedBy: ctx.sender });
  });

// The first caller becomes the controller; the controller grants the other roles.
export const claimController = spacetimedb.reducer({ label: t.string() }, (ctx, { label }) => {
  for (const r of ctx.db.role.iter()) if (r.role === 'controller') throw new Error('a controller already exists');
  ctx.db.role.insert({ who: ctx.sender, role: 'controller', label });
});

export const grantRole = spacetimedb.reducer({ who: t.identity(), role: t.string(), label: t.string() }, (ctx, a) => {
  if (roleOf(ctx) !== 'controller') throw new Error('only the controller grants roles');
  if (!GRANTABLE.includes(a.role)) throw new Error('unknown role');
  if (ctx.db.role.who.find(a.who)) throw new Error('identity already has a role'); // one identity, one role
  ctx.db.role.insert({ who: a.who, role: a.role, label: a.label });
});
