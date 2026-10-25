// CRS identity and contact-risk screening (Fraud Finder + TransUnion TruValidate basic).
// CRS answers "do these identity and contact details need more verification?", never
// "should this refund be approved". Only the four documented sandbox personas are ever
// sent: unrecognised data can be forwarded to a paid downstream provider.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, log } from './env';

export const PERSONA_IDS = ['P01', 'P12', 'P13', 'P16'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
export const isPersonaId = (x: unknown): x is PersonaId => PERSONA_IDS.includes(x as PersonaId);

/**
 * Simulated shoppers never get identity data of their own: each one is mapped onto a scripted
 * sandbox persona, deterministically, with the mix the /identity/batch demo uses (most shoppers
 * clean, a few needing a person or step-up). Same agent, same persona, every time.
 */
export const PERSONA_MIX: Record<PersonaId, number> = { P01: 900, P12: 40, P13: 30, P16: 30 };
export function personaFor(agentId: number, mix: Record<PersonaId, number> = PERSONA_MIX): PersonaId {
  let h = (agentId * 2654435761) >>> 0; // Knuth's multiplicative hash, so neighbouring ids spread out
  h ^= h >>> 16;
  const total = PERSONA_IDS.reduce((a, id) => a + mix[id], 0);
  let pick = h % total;
  for (const id of PERSONA_IDS) {
    if (pick < mix[id]) return id;
    pick -= mix[id];
  }
  return 'P01';
}

/** One metered request to CRS: product, HTTP status (0 = no answer) and latency. Never the payload. */
export type CrsProduct = 'login' | 'refresh' | 'fraud_finder' | 'truvalidate_basic' | 'health';
export interface CrsCallRecord { product: CrsProduct; status: number; latencyMs: number }
let meter: ((m: CrsCallRecord) => void) | null = null;
/** The worker records every CRS request in SpacetimeDB's crs_call table through this hook. */
export function setCrsMeter(fn: ((m: CrsCallRecord) => void) | null) { meter = fn; }
const PRODUCT_BY_PATH: Record<string, CrsProduct> = {
  '/users/login': 'login', '/users/refresh-token': 'refresh', '/fraud-finder/fraud-finder': 'fraud_finder',
  '/transunion/identity-manager-verification/basic': 'truvalidate_basic', '/sys/health': 'health',
};

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

// CRS_PERSONAS_PATH lets tests point at a temp file instead of the real one in worker/.keys.
const personasPath = () => process.env.CRS_PERSONAS_PATH || resolve(config.keysDir, 'crs-personas.json');
const TIMEOUT_MS = 15_000;
const LOGIN_BACKOFF_MS = 5 * 60_000; // repeated failed logins can lock the account
const CACHE_MS = 10 * 60_000; // sandbox personas answer the same way every time

let token: { value: string; refresh: string; until: number } | null = null;
let loginBlockedUntil = 0;
const cache = new Map<PersonaId, IdentityScreening>();

export function sandboxReady(): string | null {
  if (!config.crs.username || !config.crs.password) return 'CRS_USERNAME and CRS_PASSWORD are not set';
  if (!existsSync(personasPath())) return `persona details missing: create ${personasPath()} from the CRS Postman collection`;
  // Placeholders would reach CRS as unrecognised data, which it may forward to a paid provider.
  if (/<[^>]*>/.test(readFileSync(personasPath(), 'utf8'))) return `${personasPath()} still has <placeholder> values: fill them in from the CRS Postman collection`;
  return null;
}

function loadPersona(id: PersonaId): Persona {
  const all = JSON.parse(readFileSync(personasPath(), 'utf8')) as Partial<Record<PersonaId, Persona>>;
  const p = all[id];
  if (!p) throw new Error(`persona ${id} is not in crs-personas.json`);
  return p;
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown, auth?: string): Promise<{ status: number; json: unknown }> {
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${config.crs.baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    return { status, json };
  } finally {
    const product = PRODUCT_BY_PATH[path];
    if (product) try { meter?.({ product, status, latencyMs: Date.now() - t0 }); } catch { /* metering never breaks a screening */ }
  }
}
const post = (path: string, body: unknown, auth?: string) => request('POST', path, body, auth);

/** `expires` may be an epoch (ms or s) or seconds from now; keep a minute's margin either way. */
export function tokenUntil(j: Record<string, unknown>, now = Date.now()): number {
  const e = Number(j.expires ?? j.expiresIn ?? j.expires_in);
  if (!Number.isFinite(e) || e <= 0) return now + 10 * 60_000;
  const at = e > 1e12 ? e : e > 1e9 ? e * 1000 : now + e * 1000;
  return Math.max(now + 30_000, at - 60_000);
}

function readToken(json: unknown): { value: string; refresh: string; until: number } | null {
  const j = (json ?? {}) as Record<string, unknown>;
  const value = [j.token, j.accessToken, j.access_token, j.jwt].find((v): v is string => typeof v === 'string' && v.length > 0);
  if (!value) return null;
  return { value, refresh: typeof j.refreshToken === 'string' ? j.refreshToken : '', until: tokenUntil(j) };
}

// The two products are called in parallel; they share one login instead of racing two (two failed
// logins at once is exactly what can lock the account).
let loggingIn: Promise<string> | null = null;
function login(): Promise<string> {
  if (token && token.until > Date.now()) return Promise.resolve(token.value);
  loggingIn ??= loginOnce().finally(() => { loggingIn = null; });
  return loggingIn;
}

async function loginOnce(): Promise<string> {
  // An expired token is renewed with its refresh token first: one fewer password login.
  if (token?.refresh) {
    const r = await post('/users/refresh-token', { refreshToken: token.refresh }).catch(() => null);
    const t = r && r.status < 300 ? readToken(r.json) : null;
    if (t) { token = { ...t, refresh: t.refresh || token.refresh }; return t.value; }
  }
  if (Date.now() < loginBlockedUntil) throw new Error('CRS login failed recently; waiting before trying again');
  const { status, json } = await post('/users/login', { username: config.crs.username, password: config.crs.password });
  const t = status < 300 ? readToken(json) : null;
  if (!t) {
    token = null;
    loginBlockedUntil = Date.now() + LOGIN_BACKOFF_MS;
    throw new Error(`CRS login failed (HTTP ${status})`);
  }
  token = t;
  return t.value;
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

export async function screen(id: PersonaId): Promise<IdentityScreening> {
  return config.crs.mode === 'sandbox' ? sandboxScreening(id) : fixtureScreening(id);
}

/** A screening plus what it cost: whether the cache answered (no CRS request) and how long it took. */
export async function screenWithMeta(id: PersonaId): Promise<{ screening: IdentityScreening; cached: boolean; latencyMs: number }> {
  const t0 = Date.now();
  const hit = config.crs.mode === 'sandbox' ? cache.get(id) : undefined;
  const cached = !!hit && Date.now() - Date.parse(hit.checkedAt) < CACHE_MS;
  const screening = await screen(id);
  return { screening, cached, latencyMs: Date.now() - t0 };
}

/** CRS's own health endpoint (GET /sys/health), for /system. Returns the HTTP status, 0 when unreachable. */
export async function health(): Promise<number> {
  if (config.crs.mode !== 'sandbox' || !config.crs.username) return 0;
  try {
    const auth = await login();
    return (await request('GET', '/sys/health', undefined, auth)).status;
  } catch {
    return 0;
  }
}

/** Test seam: make the current token look expired, keeping its refresh token. */
export function expireCrsToken() { if (token) token = { ...token, until: 0 }; }

/** Test seam: forget the token, the login back-off and the cache. */
export function resetCrsClient() { token = null; loginBlockedUntil = 0; loggingIn = null; cache.clear(); }
