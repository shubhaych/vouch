// Vouch Credentials: a private reputation that travels without the raw
// history. Real Ed25519 signatures (Node crypto) over salted SHA-256 digests
// of bands and thresholds; the holder reveals only what a verifier asks for,
// with the salts, and signs the verifier's fresh nonce so a presentation
// cannot be replayed. Issuer identity is simulated (we generated the keys);
// the registry is the `credential` table in SpacetimeDB.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DbConnection } from '../module_bindings/index';
import type { Credential, Verification } from '../module_bindings/types';
import { BUSINESS_A, BUSINESS_B } from '@vouch/module/world';
import { config, log } from './env';
import { call } from './stdb';
import { label } from './history';
import type { CredentialCheck } from './orchestrator';
import { mirrorOf } from './mirror';

interface KeyPair { publicKey: string; privateKey: string }
interface Holder extends KeyPair { did: string; salts: Record<string, Record<string, string>>; values: Record<string, Record<string, string | number | boolean>> }

const HOLDERS_PATH = resolve(config.keysDir, 'holders.json');
const VALIDITY_DAYS = 180;
// The sim runs a day every 2 s, so 180 days pass in 6 minutes: issuers renew a
// credential this many days before it expires, the way a real issuer refreshes one.
const RENEW_MARGIN_DAYS = 30;

/**
 * Renewal replaces an expiring credential. A revoked one stays revoked until the issuer
 * reinstates it: re-issuing behind a revocation would undo the issuer's decision.
 */
export function needsRenewal<C extends { id: string; issuer: number; holder: string; issuedDay: number; expiresDay: number; revoked: boolean }>(
  creds: Iterable<C>, holderDid: string, issuer: number, today: number,
): boolean {
  const newest = [...creds].filter((c) => c.holder === holderDid && c.issuer === issuer).sort((a, b) => b.issuedDay - a.issuedDay)[0];
  if (!newest) return true;
  if (newest.revoked) return false;
  return !freshCredential([newest], holderDid, issuer, today);
}

/** Refund-to-purchase bands. 15% sits at the low end of typical online return rates, so one or two extra claims do not flip a good record. */
export const ratioBand = (ratio: number) => (ratio < 0.15 ? 'low' : ratio < 0.35 ? 'medium' : 'high');

/** The holder's newest credential from `issuer` that is neither revoked nor about to expire. */
export function freshCredential<C extends { id: string; issuer: number; holder: string; issuedDay: number; expiresDay: number; revoked: boolean }>(
  creds: Iterable<C>, holderDid: string, issuer: number, today: number, margin = RENEW_MARGIN_DAYS,
): C | undefined {
  return [...creds]
    .filter((c) => c.holder === holderDid && c.issuer === issuer && !c.revoked && c.expiresDay > today + margin)
    .sort((a, b) => b.issuedDay - a.issuedDay)[0];
}

/** What each verifying business asks to see. B-002 is Business B in the demo story. */
export const VERIFIER_POLICY: Record<number, { reveal: string[]; predicate: (c: Record<string, string | number | boolean>) => boolean; text: string }> = {
  [BUSINESS_B]: {
    reveal: ['completed_purchases_gte', 'refund_ratio_band', 'no_confirmed_fraud_180d'],
    predicate: (c) => Number(c.completed_purchases_gte) >= 10 && c.refund_ratio_band === 'low' && c.no_confirmed_fraud_180d === true,
    text: '10 or more purchases, low refund ratio, no confirmed fraud',
  },
  [BUSINESS_A]: {
    reveal: ['score_band', 'no_confirmed_fraud_180d'],
    predicate: (c) => c.score_band !== 'red' && c.no_confirmed_fraud_180d === true,
    text: 'score band not red, no confirmed fraud',
  },
};

const readJson = <T>(p: string, d: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : d);
const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 }); };
const newPair = (): KeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
};
const pub = (b64: string): KeyObject => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
const priv = (b64: string): KeyObject => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const digestOf = (salt: string, name: string, value: string | number | boolean) => sha256(`${salt}|${name}|${String(value)}`);

/** Canonical JSON: sorted keys, no whitespace, so every byte is covered by the signature. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(typeof v === 'bigint' ? Number(v) : v);
}

export const signedPart = (c: Pick<Credential, 'id' | 'issuer' | 'holder' | 'issuedDay' | 'expiresDay' | 'statusIndex' | 'digests'>) => ({
  id: c.id, type: 'VouchShoppingRecord', issuer: label.business(c.issuer), holder: c.holder, issuedDay: c.issuedDay, expiresDay: c.expiresDay, statusIndex: c.statusIndex, digests: c.digests,
});

export interface Presentation { credentialId: string; revealed: { name: string; value: string | number | boolean; salt: string }[]; nonce: string; holderKey: string; holderSig: string }
export interface Step { n: number; title: string; ok: boolean; detail: string; bytes: string }

/** The five checks every verifier runs, in order; the first failure stops the rest. Pure: used by the worker and by tests. */
export function verifyPresentation(
  c: Credential, p: Presentation, issuerPublicKey: string, today: number, policy: (claims: Record<string, string | number | boolean>) => boolean, nonce: string,
): { steps: Step[]; passed: boolean; failedStep: number } {
  const steps: Step[] = [];
  const done = (n: number) => ({ steps, passed: n === 0, failedStep: n });
  const body = canonical(signedPart(c));
  steps.push({ n: 1, title: 'Credential received', ok: true, detail: `${c.id} from ${label.business(c.issuer)} for ${c.holder.slice(0, 26)}…`, bytes: body.slice(0, 120) });
  let sigOk = false;
  try { sigOk = !!issuerPublicKey && verify(null, Buffer.from(body), pub(issuerPublicKey), Buffer.from(c.sig, 'base64')); } catch { sigOk = false; }
  steps.push({ n: 2, title: 'Issuer signature verified', ok: sigOk, detail: sigOk ? `Ed25519 signature by ${label.business(c.issuer)}'s registered key` : 'signature does not match the registered issuer key', bytes: c.sig.slice(0, 64) });
  if (!sigOk) return done(2);
  const live = !c.revoked && c.expiresDay >= today;
  steps.push({ n: 3, title: 'Expiration and revocation checked', ok: live, detail: c.revoked ? 'revoked by the issuer' : c.expiresDay < today ? `expired on day ${c.expiresDay} (today is day ${today})` : `valid until day ${c.expiresDay}, status index ${c.statusIndex} not revoked`, bytes: `revoked=${c.revoked} expiresDay=${c.expiresDay} today=${today}` });
  if (!live) return done(3);
  const claims: Record<string, string | number | boolean> = {};
  let claimsOk = p.nonce === nonce;
  let why = claimsOk ? '' : 'presentation is for a different nonce (replay)';
  for (const r of p.revealed) {
    const d = digestOf(r.salt, r.name, r.value);
    if (!c.digests.includes(d)) { claimsOk = false; why = `"${r.name}" does not match any signed digest (edited or never issued)`; }
    claims[r.name] = r.value;
  }
  let holderOk = false;
  try { holderOk = verify(null, Buffer.from(nonce), pub(p.holderKey), Buffer.from(p.holderSig, 'base64')) && c.holder === `did:vouch:agent:${sha256(p.holderKey).slice(0, 16)}`; } catch { holderOk = false; }
  if (!holderOk && claimsOk) { claimsOk = false; why = "the holder's signature over the nonce does not verify"; }
  steps.push({ n: 4, title: 'Relevant claims verified', ok: claimsOk, detail: claimsOk ? `${p.revealed.length} revealed claims match signed digests; holder signed nonce ${nonce.slice(0, 8)}…` : why, bytes: p.revealed.map((r) => `sha256(${r.salt.slice(0, 6)}…|${r.name}|${r.value})`).join(' ') });
  if (!claimsOk) return done(4);
  const policyOk = policy(claims);
  steps.push({ n: 5, title: 'Business applies its policy', ok: policyOk, detail: policyOk ? 'policy met' : 'policy not met by the revealed claims', bytes: JSON.stringify(claims) });
  return done(policyOk ? 0 : 5);
}

export class Credentials {
  private issuers: Record<string, KeyPair> = {};
  private holders: Record<string, Holder> = {};
  private handled = new Set<bigint>();
  private issuing = false;

  constructor(private conn: DbConnection) {}

  async start() {
    this.issuers = readJson(config.issuerKeysPath, {} as Record<string, KeyPair>);
    this.holders = readJson(HOLDERS_PATH, {} as Record<string, Holder>);
    let changed = false;
    for (const b of this.conn.db.business.iter()) if (!this.issuers[b.id]) { this.issuers[b.id] = newPair(); changed = true; }
    if (changed) writeJson(config.issuerKeysPath, this.issuers);
    await this.registerKeys();
    this.conn.db.business.onUpdate((_c, _o, b) => { if (!b.issuerPublicKey) void this.registerKeys(); });
    this.conn.db.business.onInsert((_c, b) => { if (!b.issuerPublicKey) setTimeout(() => void this.registerKeys(), 500); });
    this.conn.db.verification.onInsert((_c, v) => void this.onVerification(v));
    for (const v of this.conn.db.verification.iter()) void this.onVerification(v);
    log('credentials ready (Ed25519 issuer keys for 60 businesses)');
  }

  private async registerKeys() {
    for (const b of this.conn.db.business.iter()) {
      const k = this.issuers[b.id];
      if (k && b.issuerPublicKey !== k.publicKey) await call('setIssuerKey', this.conn.reducers.setIssuerKey({ businessId: b.id, publicKey: k.publicKey }));
    }
  }

  holderFor(agentId: number): Holder {
    let h = this.holders[agentId];
    if (!h) {
      const kp = newPair();
      h = { ...kp, did: `did:vouch:agent:${sha256(kp.publicKey).slice(0, 16)}`, salts: {}, values: {} };
      this.holders[agentId] = h;
      writeJson(HOLDERS_PATH, this.holders);
    }
    return h;
  }

  agentForHolder(did: string): number | null {
    for (const [id, h] of Object.entries(this.holders)) if (h.did === did) return Number(id);
    return null;
  }

  /** Issues a credential from `issuer` to the agent, built from bands and thresholds of its record. Never raw history. */
  async issue(agentId: number, issuer: number, overrides: { issuedDay?: number; expiresDay?: number } = {}): Promise<string | null> {
    if (this.issuing) return null;
    this.issuing = true;
    try {
      const db = this.conn.db;
      const m = mirrorOf(this.conn);
      const a = m.agents.get(agentId);
      const key = this.issuers[issuer];
      const day = db.simRun.id.find(1)?.day ?? 0;
      if (!a || !key || !db.business.id.find(issuer)?.issuerPublicKey) return null;
      const purchases = m.purchasesOf(agentId);
      const refunds = m.refundsOf(agentId);
      const ratio = purchases.length ? refunds.length / purchases.length : 0;
      const confirmed = [...db.fraudPattern.iter()].some((p) => p.status === 'confirmed' && p.agentIds.includes(agentId) && p.reviewedDay >= day - 180);
      const done = purchases.filter((p) => p.status === 'kept' || p.status === 'refunded').length;
      const values: Record<string, string | number | boolean> = {
        completed_purchases_gte: done >= 25 ? 25 : done >= 10 ? 10 : done >= 3 ? 3 : 0,
        refund_ratio_band: ratioBand(ratio),
        no_confirmed_fraud_180d: !confirmed,
        score_band: a.band,
      };
      const holder = this.holderFor(agentId);
      const id = `VC-${randomBytes(2).toString('hex')}`;
      const salts = Object.fromEntries(Object.keys(values).map((k) => [k, randomBytes(8).toString('hex')]));
      const digests = Object.entries(values).map(([k, v]) => digestOf(salts[k]!, k, v)).sort();
      const statusIndex = 1000 + Math.floor(Math.random() * 9000);
      const issuedDay = overrides.issuedDay ?? day;
      const expiresDay = overrides.expiresDay ?? issuedDay + VALIDITY_DAYS;
      const body = canonical(signedPart({ id, issuer, holder: holder.did, issuedDay, expiresDay, statusIndex, digests }));
      const sig = sign(null, Buffer.from(body), priv(key.privateKey)).toString('base64');
      holder.salts[id] = salts;
      holder.values[id] = values;
      writeJson(HOLDERS_PATH, this.holders);
      await call('issueCredential', this.conn.reducers.issueCredential({ id, issuer, holder: holder.did, issuedDay, expiresDay, statusIndex, digests, sig }));
      log(`issued ${id} from ${label.business(issuer)} to ${label.agent(agentId)}: ${JSON.stringify(values)}`);
      return id;
    } finally {
      this.issuing = false;
    }
  }

  /** Issues a new credential from `issuer` when the agent has none, or its newest one is expiring. Never replaces a revoked one. */
  async ensureFresh(agentId: number, issuer: number): Promise<void> {
    const today = this.conn.db.simRun.id.find(1)?.day ?? 0;
    if (needsRenewal(this.conn.db.credential.iter(), this.holderFor(agentId).did, issuer, today)) await this.issue(agentId, issuer);
  }

  /** The holder's side: reveal what the verifier asks for, sign its nonce. `tamper` flips one revealed value (the demo's Tamper button). */
  present(c: Credential, verifier: number, nonce: string, tamper: boolean): Presentation | null {
    const agentId = this.agentForHolder(c.holder);
    if (agentId === null) return null;
    const h = this.holders[agentId]!;
    const salts = h.salts[c.id];
    const values = h.values[c.id];
    if (!salts || !values) return null;
    const names = (VERIFIER_POLICY[verifier] ?? VERIFIER_POLICY[BUSINESS_B]!).reveal;
    const revealed = names.filter((n) => n in values).map((name) => ({ name, value: values[name]!, salt: salts[name]! }));
    if (tamper && revealed[0]) {
      const r = revealed.find((x) => x.name === 'refund_ratio_band') ?? revealed[0];
      r.value = typeof r.value === 'boolean' ? !r.value : typeof r.value === 'number' ? r.value + 15 : r.value === 'low' ? 'none' : 'low';
    }
    return { credentialId: c.id, revealed, nonce, holderKey: h.publicKey, holderSig: sign(null, Buffer.from(nonce), priv(h.privateKey)).toString('base64') };
  }

  private async onVerification(v: Verification) {
    if (v.status !== 'requested' || this.handled.has(v.id)) return;
    this.handled.add(v.id);
    const db = this.conn.db;
    const c = db.credential.id.find(v.credentialId);
    const issuerKey = c ? db.business.id.find(c.issuer)?.issuerPublicKey ?? '' : '';
    const today = db.simRun.id.find(1)?.day ?? 0;
    const nonce = randomBytes(16).toString('hex'); // the verifier's fresh challenge
    const p = c ? this.present(c, v.verifier, nonce, v.tamper) : null;
    const policy = VERIFIER_POLICY[v.verifier] ?? VERIFIER_POLICY[BUSINESS_B]!;
    const res = c && p
      ? verifyPresentation(c, p, issuerKey, today, policy.predicate, nonce)
      : { steps: [{ n: 1, title: 'Credential received', ok: false, detail: 'the holder could not produce a presentation', bytes: '' }], passed: false, failedStep: 1 };
    const revealed = p ? Object.fromEntries(p.revealed.map((r) => [r.name, r.value])) : {};
    await call('recordVerification', this.conn.reducers.recordVerification({ verificationId: v.id, stepsJson: JSON.stringify(res.steps), passed: res.passed, failedStep: res.failedStep, revealedJson: JSON.stringify({ ...revealed, policy: policy.text, issuer: c ? label.business(c.issuer) : null }) }));
  }

  /** For the Refund Investigator: verify the agent's best credential at this business and wait for the row. */
  async check(agentId: number, refundId: bigint, verifier: number): Promise<CredentialCheck | null> {
    const h = this.holders[agentId];
    if (!h) return { presented: false, verified: false, failed_step: null, issuer: null, claims: {} };
    const c = [...this.conn.db.credential.iter()].filter((x) => x.holder === h.did).sort((a, b) => b.issuedDay - a.issuedDay)[0];
    if (!c) return { presented: false, verified: false, failed_step: null, issuer: null, claims: {} };
    await call('requestVerification', this.conn.reducers.requestVerification({ credentialId: c.id, refundId, tamper: false, verifier }));
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      const v = [...this.conn.db.verification.iter()].filter((x) => x.credentialId === c.id && x.refundId === refundId && x.status === 'done').sort((a, b) => Number(b.id - a.id))[0];
      if (v) {
        const claims = JSON.parse(v.revealedJson) as Record<string, unknown>;
        return { presented: true, verified: v.passed, failed_step: v.passed ? null : v.failedStep, issuer: label.business(c.issuer), claims };
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { presented: true, verified: false, failed_step: null, issuer: label.business(c.issuer), claims: {} };
  }
}
