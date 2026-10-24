import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { spacetimedb } from './schema';
import { requireRole } from './desk';

const DAY_MICROS = 86_400n * 1_000_000n;

/** Written by the Desk Lead once a Credit Analyst run completes. No run, no record. */
export const upsertVouchRecord = spacetimedb.reducer(
  { subjectId: t.string(), kind: t.string(), tier: t.u8(), reasonsJson: t.string(), notFoundJson: t.string(), runId: t.string(), runUrl: t.string(), expiresInDays: t.u32() },
  (ctx, a) => {
    requireRole(ctx, 'router');
    if (a.tier > 3) throw new Error('tier must be 0..3');
    if (!a.runId) throw new Error('a Vouch Record needs the CREAO run that produced it');
    const expiresAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(a.expiresInDays) * DAY_MICROS);
    const rec = { subjectId: a.subjectId, tier: a.tier, reasonsJson: a.reasonsJson, notFoundJson: a.notFoundJson, runId: a.runId, runUrl: a.runUrl, issuedAt: ctx.timestamp, expiresAt, provenance: 'live' };
    if (ctx.db.vouchRecord.subjectId.find(a.subjectId)) ctx.db.vouchRecord.subjectId.update(rec);
    else ctx.db.vouchRecord.insert(rec);

    const s = ctx.db.subject.id.find(a.subjectId);
    if (s) ctx.db.subject.id.update({ ...s, tier: a.tier, updatedAt: ctx.timestamp });
    else ctx.db.subject.insert({ id: a.subjectId, kind: a.kind, tier: a.tier, reasonCodes: [], principalId: '', mandateJson: '', provenance: 'live', updatedAt: ctx.timestamp });
  });

/** A bad post-payment review posts an incident; the tier drops to 1 at once. */
export const reportIncident = spacetimedb.reducer(
  { subjectId: t.string(), claimId: t.u64(), reasonCode: t.string(), evidenceHash: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'router');
    ctx.db.incident.insert({ id: 0n, subjectId: a.subjectId, claimId: a.claimId, reasonCode: a.reasonCode, evidenceHash: a.evidenceHash, at: ctx.timestamp });
    const rec = ctx.db.vouchRecord.subjectId.find(a.subjectId);
    if (rec && rec.tier > 1) ctx.db.vouchRecord.subjectId.update({ ...rec, tier: 1 });
    const s = ctx.db.subject.id.find(a.subjectId);
    if (s && s.tier > 1) ctx.db.subject.id.update({ ...s, tier: 1, reasonCodes: [...s.reasonCodes, 'INCIDENT_ON_RECORD'], updatedAt: ctx.timestamp });
  });
