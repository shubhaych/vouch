// CRS identity and contact-risk screening (Fraud Finder + TransUnion TruValidate basic).
// CRS answers "do these identity and contact details need more verification?", never
// "should this refund be approved". Only the four documented sandbox personas are ever
// sent: unrecognised data can be forwarded to a paid downstream provider.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, log } from './env';

export const PERSONA_IDS = ['P01', 'P12', 'P13', 'P16'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
export const isPersonaId = (x: unknown): x is PersonaId => PERSONA_IDS.includes(x as PersonaId);

// Persona details come from the CRS Postman collection and live in a git-ignored file
// (worker/.keys/crs-personas.json), so no SSN or birth date is ever committed.
export interface Persona {
  email: string; firstName: string; lastName: string; phoneNumber?: string; ipAddress?: string;
  ssn: string; dob: string; street1: string; city: string; state: string; zip: string;
}

export type Route = 'refund_investigator' | 'merchant_identity_review' | 'additional_verification';
export interface IdentityScreening {
  personaId: PersonaId;
  source: 'fixture' | 'sandbox';
  contactRiskScore: number | null;
  contactRiskBand: 'low' | 'review' | 'unavailable';
  identityStatus: 'match' | 'discrepancy' | 'additional_verification' | 'unavailable';
  messages: { code: string; text: string }[];
  route: Route;
  // Plain-language rules that produced the route, for the merchant and the demo.
  reasons: string[];
  errors: string[];
  checkedAt: string;
}

const REVIEW_SCORE = 70;
const ADDITIONAL_VERIFICATION_CODES = new Set(['2401']);

// --- Normalisation (pure, shared by fixture and sandbox paths) ------------------

export function readScore(body: unknown): number | null {
  const s = (body as { risk?: { score?: unknown } } | null)?.risk?.score;
  const n = typeof s === 'string' ? Number(s) : s;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// A missing idManagerVerification is "unavailable", never a clean match.
export function readMessages(body: unknown): { code: string; text: string }[] | null {
  const products = (body as { addOnProducts?: unknown } | null)?.addOnProducts;
  if (!Array.isArray(products)) return null;
  for (const p of products) {
    const ver = (p as { idManagerVerification?: { messages?: unknown } })?.idManagerVerification;
    if (!ver || !Array.isArray(ver.messages)) continue;
    return ver.messages.map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      const code = String(r.code ?? r.messageCode ?? r.id ?? '');
      const text = String(r.text ?? r.message ?? r.description ?? '');
      return { code, text };
    });
  }
  return null;
}

export function normalize(personaId: PersonaId, source: IdentityScreening['source'], fraud: unknown, identity: unknown, errors: string[] = []): IdentityScreening {
  const score = readScore(fraud);
  const messages = readMessages(identity);
  const contactRiskBand = score === null ? 'unavailable' : score >= REVIEW_SCORE ? 'review' : 'low';
  const identityStatus = messages === null ? 'unavailable'
    : messages.some((m) => ADDITIONAL_VERIFICATION_CODES.has(m.code)) ? 'additional_verification'
    : messages.length > 0 ? 'discrepancy' : 'match';
  // A failed check routes to a person for more proof; it is never treated as a red flag.
  const route: Route = identityStatus === 'unavailable' || contactRiskBand === 'unavailable' || identityStatus === 'additional_verification'
    ? 'additional_verification'
    : identityStatus === 'discrepancy' || contactRiskBand === 'review' ? 'merchant_identity_review' : 'refund_investigator';
  const reasons: string[] = [];
  if (contactRiskBand === 'unavailable') reasons.push('Fraud Finder returned no score, so more proof is requested (never treated as risk)');
  else reasons.push(`Contact risk ${score} is ${contactRiskBand === 'review' ? `at or above ${REVIEW_SCORE}, so a person reviews it` : `below ${REVIEW_SCORE}`}`);
  if (identityStatus === 'unavailable') reasons.push('TruValidate returned no verification, so more proof is requested (never treated as a match)');
  else if (identityStatus === 'additional_verification') reasons.push(`Message ${[...ADDITIONAL_VERIFICATION_CODES].join('/')} (fraud alert on file) asks for step-up verification`);
  else if (identityStatus === 'discrepancy') reasons.push(`${messages!.length} identity discrepanc${messages!.length === 1 ? 'y' : 'ies'} returned, so a person reviews it`);
  else reasons.push('No identity discrepancies returned');
  return { personaId, source, contactRiskScore: score, contactRiskBand, identityStatus, messages: messages ?? [], route, reasons, errors, checkedAt: new Date().toISOString() };
}

// --- Fixture mode: hand-written vendor bodies shaped like the sandbox's ---------

const FIXTURE: Record<PersonaId, { score: number; messages: { code: string; text: string }[] }> = {
  P01: { score: 11, messages: [] },
  P12: { score: 85, messages: [{ code: '2201', text: 'SSN issued to another name' }, { code: '2101', text: 'Address mismatch' }] },
  P13: { score: 88, messages: [{ code: '2202', text: 'SSN issue date inconsistent with date of birth' }] },
  P16: { score: 50, messages: [{ code: '2401', text: 'Fraud alert on file; additional verification required' }] },
};

export function fixtureScreening(id: PersonaId): IdentityScreening {
  const f = FIXTURE[id];
  return normalize(id, 'fixture', { risk: { score: f.score } }, { addOnProducts: [{ idManagerVerification: { messages: f.messages } }] });
}

// --- Sandbox client -------------------------------------------------------------

const PERSONAS_PATH = resolve(config.keysDir, 'crs-personas.json');
const TIMEOUT_MS = 15_000;
const CACHE_MS = 10 * 60_000; // sandbox personas answer the same way every time

let token: { value: string; until: number } | null = null;
const cache = new Map<PersonaId, IdentityScreening>();

// Repeated failed logins disable the sandbox account (CRS113 Access Denied, then CRS114 Account Disabled) and only the
// CRS team can re-enable it. So one rejected login is remembered on disk, keyed by a hash of the credentials, and those
// credentials are not tried again, even after a restart; changing CRS_USERNAME or CRS_PASSWORD clears it.
const loginFailedPath = () => resolve(config.keysDir, 'crs-login-failed');
const credentialHash = () => createHash('sha256').update(`${config.crs.username}\0${config.crs.password}`).digest('hex');

/** Why CRS rejected the current credentials, when it has; null otherwise. */
export function rejectedLogin(): string | null {
  const f = loginFailedPath();
  if (!existsSync(f)) return null;
  const [hash, ...why] = readFileSync(f, 'utf8').split('\n');
  return hash === credentialHash() ? why.join(' ').trim() || 'login rejected' : null;
}

export function sandboxReady(): string | null {
  if (!config.crs.username || !config.crs.password) return 'CRS_USERNAME and CRS_PASSWORD are not set';
  const rejected = rejectedLogin();
  if (rejected) return `CRS rejected these credentials (${rejected}); not retrying so the account is not disabled. Fix CRS_USERNAME / CRS_PASSWORD, or delete ${loginFailedPath()} once CRS confirms them.`;
  if (!existsSync(PERSONAS_PATH)) return `persona details missing: create ${PERSONAS_PATH} from the CRS Postman collection`;
  // Placeholders would reach CRS as unrecognised data, which it may forward to a paid provider.
  if (/<[^>]*>/.test(readFileSync(PERSONAS_PATH, 'utf8'))) return `${PERSONAS_PATH} still has <placeholder> values: fill them in from the CRS Postman collection`;
  return null;
}

function loadPersona(id: PersonaId): Persona {
  const all = JSON.parse(readFileSync(PERSONAS_PATH, 'utf8')) as Partial<Record<PersonaId, Persona>>;
  const p = all[id];
  if (!p) throw new Error(`persona ${id} is not in crs-personas.json`);
  return p;
}

async function post(path: string, body: unknown, auth?: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${config.crs.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  return { status: res.status, json };
}

// Fraud Finder and TruValidate run in parallel; they share one login so a bad password is one failure, not two.
let loggingIn: Promise<string> | null = null;
function login(): Promise<string> {
  if (token && token.until > Date.now()) return Promise.resolve(token.value);
  loggingIn ??= freshLogin().finally(() => { loggingIn = null; });
  return loggingIn;
}

async function freshLogin(): Promise<string> {
  const rejected = rejectedLogin();
  if (rejected) throw new Error(`CRS rejected these credentials earlier (${rejected}); not retrying`);
  const { status, json } = await post('/users/login', { username: config.crs.username, password: config.crs.password });
  const j = (json ?? {}) as Record<string, unknown>;
  const value = [j.token, j.accessToken, j.access_token, j.jwt].find((v): v is string => typeof v === 'string' && v.length > 0);
  if (status >= 300 || !value) {
    // CRS's own code (CRS113, CRS114...) says whether the account is still usable; the body never holds the password.
    const why = `HTTP ${status}${[j.code, j.errorCode, j.message, j.error].filter((v) => typeof v === 'string' && v).map((v) => `: ${String(v).slice(0, 120)}`).join('')}`;
    mkdirSync(config.keysDir, { recursive: true });
    writeFileSync(loginFailedPath(), `${credentialHash()}\n${why}\n`, { mode: 0o600 });
    log(`CRS login rejected (${why}); these credentials will not be tried again`);
    throw new Error(`CRS login failed (${why})`);
  }
  const expiresIn = Number(j.expiresIn ?? j.expires_in);
  token = { value, until: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 60 ? (expiresIn - 60) * 1000 : 10 * 60_000) };
  return value;
}

async function call(path: string, body: unknown): Promise<unknown> {
  let auth = await login();
  let r = await post(path, body, auth);
  if (r.status === 401) { token = null; auth = await login(); r = await post(path, body, auth); }
  if (r.status >= 300) throw new Error(`${path} answered HTTP ${r.status}`);
  return r.json;
}

export async function sandboxScreening(id: PersonaId): Promise<IdentityScreening> {
  const hit = cache.get(id);
  if (hit && Date.now() - Date.parse(hit.checkedAt) < CACHE_MS) return hit;
  const p = loadPersona(id);
  const errors: string[] = [];
  const [fraud, identity] = await Promise.all([
    call('/fraud-finder/fraud-finder', {
      email: p.email, firstName: p.firstName, lastName: p.lastName, phoneNumber: p.phoneNumber, ipAddress: p.ipAddress,
      address: { addressLine1: p.street1, city: p.city, state: p.state, postalCode: p.zip },
    }).catch((e: Error) => { errors.push(`Fraud Finder: ${e.message}`); return null; }),
    call('/transunion/identity-manager-verification/basic', {
      firstName: p.firstName, lastName: p.lastName, ssn: p.ssn, dob: p.dob, street1: p.street1, city: p.city, state: p.state, zip: p.zip,
    }).catch((e: Error) => { errors.push(`TruValidate: ${e.message}`); return null; }),
  ]);
  const result = normalize(id, 'sandbox', fraud, identity, errors);
  // Log the outcome only: never persona details, tokens or vendor payloads.
  log(`crs ${id}: score ${result.contactRiskScore ?? 'n/a'}, identity ${result.identityStatus}, route ${result.route}${errors.length ? ` (${errors.join('; ')})` : ''}`);
  if (errors.length === 0) cache.set(id, result);
  return result;
}

let fallbackLogged = '';
/** Sandbox when it can be used; otherwise the labelled fixture, so an unusable sandbox never stamps every claim "failed". */
export async function screen(id: PersonaId): Promise<IdentityScreening> {
  if (config.crs.mode !== 'sandbox') return fixtureScreening(id);
  const notReady = sandboxReady();
  if (!notReady) return sandboxScreening(id);
  if (fallbackLogged !== notReady) log(`CRS sandbox not usable, using fixture screenings: ${(fallbackLogged = notReady)}`);
  return fixtureScreening(id);
}
