import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonical, digestOf, freshCredential, needsRenewal, ratioBand, sha256, signedPart, verifyPresentation, type Presentation } from '../src/credentials';

// T5.4: five steps pass; Tamper fails step 4; Revoke fails step 3; expired fails step 3; a forged signature fails step 2.
const der = (k: { export(o: object): Buffer }, type: string) => k.export({ type, format: 'der' }).toString('base64');
const issuer = generateKeyPairSync('ed25519');
const holder = generateKeyPairSync('ed25519');
const holderPub = der(holder.publicKey, 'spki');
const did = `did:vouch:agent:${sha256(holderPub).slice(0, 16)}`;
const values = { completed_purchases_gte: 25, refund_ratio_band: 'low', no_confirmed_fraud_180d: true, score_band: 'neutral' } as const;
const salts = Object.fromEntries(Object.keys(values).map((k) => [k, randomBytes(8).toString('hex')]));
const digests = Object.entries(values).map(([k, v]) => digestOf(salts[k]!, k, v)).sort();
const base = { id: 'VC-test', issuer: 19, holder: did, issuedDay: 120, expiresDay: 300, statusIndex: 1042, revoked: false, digests };
const credential = { ...base, sig: sign(null, Buffer.from(canonical(signedPart(base))), issuer.privateKey).toString('base64') };
const policy = (c: Record<string, unknown>) => Number(c.completed_purchases_gte) >= 10 && c.refund_ratio_band === 'low' && c.no_confirmed_fraud_180d === true;
const present = (nonce: string, edit?: (p: Presentation) => void): Presentation => {
  const p: Presentation = {
    credentialId: 'VC-test', nonce, holderKey: holderPub, holderSig: sign(null, Buffer.from(nonce), holder.privateKey).toString('base64'),
    revealed: (['completed_purchases_gte', 'refund_ratio_band', 'no_confirmed_fraud_180d'] as const).map((name) => ({ name, value: values[name], salt: salts[name]! })),
  };
  edit?.(p);
  return p;
};
const issuerPub = der(issuer.publicKey, 'spki');

describe('Vouch Credential verification', () => {
  it('passes all five steps for an honest presentation', () => {
    const r = verifyPresentation(credential, present('n1'), issuerPub, 150, policy, 'n1');
    expect(r.passed).toBe(true);
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true, true]);
  });
  it('Tamper: an edited revealed value fails step 4', () => {
    const r = verifyPresentation(credential, present('n2', (p) => { p.revealed[1]!.value = 'none'; }), issuerPub, 150, policy, 'n2');
    expect(r.failedStep).toBe(4);
  });
  it('Revoke and expiry fail step 3', () => {
    expect(verifyPresentation({ ...credential, revoked: true }, present('n3'), issuerPub, 150, policy, 'n3').failedStep).toBe(3);
    expect(verifyPresentation(credential, present('n4'), issuerPub, 301, policy, 'n4').failedStep).toBe(3);
  });
  it('a changed credential byte or an unknown issuer fails step 2; a replayed presentation fails step 4', () => {
    expect(verifyPresentation({ ...credential, expiresDay: 999 }, present('n5'), issuerPub, 150, policy, 'n5').failedStep).toBe(2);
    const other = der(generateKeyPairSync('ed25519').publicKey, 'spki');
    expect(verifyPresentation(credential, present('n6'), other, 150, policy, 'n6').failedStep).toBe(2);
    expect(verifyPresentation(credential, present('old-nonce'), issuerPub, 150, policy, 'fresh-nonce').failedStep).toBe(4);
  });
  it('QA-002 a holder needs a new credential once the last one expired, was revoked, or expires within the renewal margin', () => {
    const c = (o: Partial<typeof base>) => ({ ...base, ...o });
    expect(freshCredential([c({})], did, 19, 150)?.id).toBe('VC-test');
    expect(freshCredential([c({ expiresDay: 300 })], did, 19, 301)).toBeUndefined(); // expired
    expect(freshCredential([c({ expiresDay: 300 })], did, 19, 290)).toBeUndefined(); // inside the 30-day renewal margin
    expect(freshCredential([c({ revoked: true })], did, 19, 150)).toBeUndefined();
    expect(freshCredential([c({ issuer: 2 })], did, 19, 150)).toBeUndefined(); // another issuer
    expect(freshCredential([c({ expiresDay: 200 }), c({ id: 'VC-new', issuedDay: 180, expiresDay: 360 })], did, 19, 190)?.id).toBe('VC-new');
  });
  it('QA-002 a showcase re-run (4 refunds on 40 purchases) keeps a low refund-ratio band', () => {
    expect(ratioBand(4 / 40)).toBe('low');
    expect(ratioBand(6 / 40)).toBe('medium');
    expect(ratioBand(0.5)).toBe('high');
  });
  it('QA-013 renewal replaces an expiring credential but never one the issuer revoked', () => {
    const c = (o: Partial<typeof base>) => ({ ...base, ...o });
    expect(needsRenewal([], did, 19, 150)).toBe(true);
    expect(needsRenewal([c({})], did, 19, 150)).toBe(false);
    expect(needsRenewal([c({})], did, 19, 290)).toBe(true); // expiring
    expect(needsRenewal([c({ revoked: true })], did, 19, 150)).toBe(false); // revoked stays revoked
    expect(needsRenewal([c({ revoked: true, expiresDay: 200 })], did, 19, 290)).toBe(false);
  });
});
