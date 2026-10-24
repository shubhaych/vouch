import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { requireRole } from './ctx';
import { BUSINESS_A, BUSINESS_B } from './world';

// Vouch Credentials: a public, tamper-evident registry of signed digests.
// The signing and verifying happen in the worker with Node's crypto; the
// database stores digests, signatures, expiry and revocation, never history.

export const setIssuerKey = spacetimedb.reducer({ businessId: t.u16(), publicKey: t.string() }, (ctx, a) => {
  requireRole(ctx, 'worker');
  const b = ctx.db.business.id.find(a.businessId);
  if (!b) throw new Error('no such business');
  ctx.db.business.id.update({ ...b, issuerPublicKey: a.publicKey });
});

export const issueCredential = spacetimedb.reducer(
  { id: t.string(), issuer: t.u16(), holder: t.string(), issuedDay: t.u32(), expiresDay: t.u32(), statusIndex: t.u32(), digests: t.array(t.string()), sig: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    if (!ctx.db.business.id.find(a.issuer)?.issuerPublicKey) throw new Error('issuer has no registered key');
    if (ctx.db.credential.id.find(a.id)) throw new Error('credential id exists');
    ctx.db.credential.insert({ ...a, revoked: false });
  },
);

/** Only the issuing business (or the controller) may revoke; every verifier sees it live. */
export const revokeCredential = spacetimedb.reducer({ id: t.string(), revoked: t.bool() }, (ctx, a) => {
  const seat = requireRole(ctx, 'business', 'controller', 'worker');
  const c = ctx.db.credential.id.find(a.id);
  if (!c) throw new Error('no such credential');
  if (seat.role === 'business' && seat.businessId !== c.issuer) throw new Error('only the issuing business may revoke');
  ctx.db.credential.id.update({ ...c, revoked: a.revoked });
});

/** A business asks for a credential check on a refund; the worker builds the presentation and verifies it. */
export const requestVerification = spacetimedb.reducer({ credentialId: t.string(), refundId: t.u64(), tamper: t.bool(), verifier: t.u16() }, (ctx, a) => {
  const seat = requireRole(ctx, 'business', 'controller', 'worker');
  if (!ctx.db.credential.id.find(a.credentialId)) throw new Error('no such credential');
  // A business seat always verifies as itself; the worker verifies on behalf of the refund's business.
  const verifier = seat.role === 'worker' ? a.verifier || BUSINESS_B : seat.businessId || BUSINESS_A;
  ctx.db.verification.insert({
    id: 0n, credentialId: a.credentialId, verifier, refundId: a.refundId, tamper: a.tamper, status: 'requested', stepsJson: '[]',
    passed: false, failedStep: 0, revealedJson: '{}', at: ctx.timestamp,
  });
});

export const recordVerification = spacetimedb.reducer(
  { verificationId: t.u64(), stepsJson: t.string(), passed: t.bool(), failedStep: t.u8(), revealedJson: t.string() },
  (ctx, a) => {
    requireRole(ctx, 'worker');
    const v = ctx.db.verification.id.find(a.verificationId);
    if (!v) throw new Error('no such verification');
    JSON.parse(a.stepsJson);
    ctx.db.verification.id.update({ ...v, status: 'done', stepsJson: a.stepsJson, passed: a.passed, failedStep: a.failedStep, revealedJson: a.revealedJson });
  },
);
