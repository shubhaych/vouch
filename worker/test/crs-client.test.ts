import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/env';
import { expireCrsToken, health, personaFor, PERSONA_IDS, resetCrsClient, sandboxReady, screenWithMeta, setCrsMeter, tokenUntil, type CrsCallRecord } from '../src/crs';

// The CRS client against a stand-in server shaped like the sandbox (docs/CRS.md): login, refresh,
// the two screening products and the health endpoint. Not a live CRS call.
let server: Server;
let base = '';
const seen: { method: string; url: string; auth: string; body: Record<string, unknown> | null }[] = [];
let loginStatus = 200;
let expiresIn = 3600;
let rejectNextToken = false;

const PERSONA = {
  email: 'margaret@example.test', firstName: 'MARGARET', lastName: 'OKAFOR', phoneNumber: '5550100', ipAddress: '10.0.0.1',
  ssn: '000000001', dob: '1970-01-01', street1: '1 TEST ST', city: 'TESTVILLE', state: 'CA', zip: '90000',
};

beforeAll(async () => {
  let n = 0;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? ''), body });
      res.setHeader('content-type', 'application/json');
      const send = (status: number, j: unknown) => { res.statusCode = status; res.end(JSON.stringify(j)); };
      if (req.url === '/users/login') return loginStatus === 200 ? send(200, { token: `tok-${++n}`, expires: expiresIn, refreshToken: `ref-${n}` }) : send(loginStatus, { error: 'bad credentials' });
      if (req.url === '/users/refresh-token') return send(200, { token: `tok-r${++n}`, expires: 3600 });
      if (rejectNextToken) { rejectNextToken = false; return send(401, { error: 'expired' }); }
      if (req.url === '/sys/health') return send(200, { status: 'UP' });
      if (req.url === '/fraud-finder/fraud-finder') return send(200, { risk: { score: 11 } });
      if (req.url === '/transunion/identity-manager-verification/basic') return send(200, { addOnProducts: [{ idManagerVerification: { messages: [] } }] });
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'vouch-crs-'));
  writeFileSync(join(dir, 'personas.json'), JSON.stringify({ P01: PERSONA, P12: PERSONA, P13: PERSONA, P16: PERSONA }));
  process.env.CRS_PERSONAS_PATH = join(dir, 'personas.json');
  Object.assign(config.crs, { mode: 'sandbox', baseUrl: base, username: 'sandbox-user', password: 'sandbox-pass', configured: true });
});
afterAll(() => {
  server.close();
  delete process.env.CRS_PERSONAS_PATH;
  setCrsMeter(null);
});

const meter: CrsCallRecord[] = [];
beforeEach(() => {
  seen.length = 0; meter.length = 0; loginStatus = 200; expiresIn = 3600; rejectNextToken = false;
  resetCrsClient();
  setCrsMeter((m) => meter.push(m));
});

describe('CRS sandbox client', () => {
  it('logs in once, sends the persona to both products with a bearer token, and meters every request', async () => {
    const a = await screenWithMeta('P01');
    expect(a.screening).toMatchObject({ source: 'sandbox', route: 'refund_investigator', contactRiskScore: 11, identityStatus: 'match' });
    expect(a.cached).toBe(false);
    expect(seen.filter((s) => s.url === '/users/login')).toHaveLength(1);
    const ff = seen.find((s) => s.url === '/fraud-finder/fraud-finder')!;
    const tv = seen.find((s) => s.url === '/transunion/identity-manager-verification/basic')!;
    expect(ff.auth).toBe('Bearer tok-1');
    expect(ff.body).toMatchObject({ email: PERSONA.email, firstName: 'MARGARET', address: { addressLine1: PERSONA.street1, postalCode: PERSONA.zip } });
    expect(tv.body).toMatchObject({ firstName: 'MARGARET', ssn: PERSONA.ssn, dob: PERSONA.dob, zip: PERSONA.zip });
    expect(meter.map((m) => `${m.product}:${m.status}`).sort()).toEqual(['fraud_finder:200', 'login:200', 'truvalidate_basic:200']);
    // The meter carries product, status and latency only: nothing a person could be identified from.
    for (const m of meter) expect(Object.keys(m).sort()).toEqual(['latencyMs', 'product', 'status']);
  });

  it('answers the same persona from the cache for ten minutes: no second request', async () => {
    await screenWithMeta('P01');
    const before = seen.length;
    const b = await screenWithMeta('P01');
    expect(b.cached).toBe(true);
    expect(seen.length).toBe(before);
  });

  it('renews an expired token with its refresh token before logging in again', async () => {
    await screenWithMeta('P01');
    expireCrsToken();
    await screenWithMeta('P12');
    expect(seen.filter((s) => s.url === '/users/login')).toHaveLength(1);
    expect(seen.filter((s) => s.url === '/users/refresh-token')).toHaveLength(1);
    expect(meter.some((m) => m.product === 'refresh')).toBe(true);
  });

  it('logs in again once when a product answers 401', async () => {
    await screenWithMeta('P01');
    rejectNextToken = true;
    const r = await screenWithMeta('P12');
    expect(r.screening.errors).toEqual([]);
    expect(seen.filter((s) => s.url === '/users/login')).toHaveLength(2);
  });

  it('a failed login waits five minutes instead of retrying (repeated failures can lock the account)', async () => {
    loginStatus = 401;
    const r = await screenWithMeta('P13');
    expect(r.screening.route).toBe('additional_verification'); // a failed call asks for more proof, never flags the shopper
    expect(r.screening.errors.join(' ')).toMatch(/login failed/);
    loginStatus = 200;
    const again = await screenWithMeta('P16');
    expect(again.screening.errors.join(' ')).toMatch(/waiting before trying again/);
    expect(seen.filter((s) => s.url === '/users/login')).toHaveLength(1);
  });

  it('checks CRS health with GET /sys/health', async () => {
    expect(await health()).toBe(200);
    expect(seen.find((s) => s.url === '/sys/health')?.method).toBe('GET');
    expect(meter.find((m) => m.product === 'health')?.status).toBe(200);
  });

  it('refuses to run with placeholder persona data (it could reach a paid provider)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vouch-crs-ph-'));
    writeFileSync(join(dir, 'p.json'), JSON.stringify({ P01: { ...PERSONA, ssn: '<ssn>' } }));
    const keep = process.env.CRS_PERSONAS_PATH;
    process.env.CRS_PERSONAS_PATH = join(dir, 'p.json');
    expect(sandboxReady()).toMatch(/placeholder/);
    process.env.CRS_PERSONAS_PATH = keep;
    expect(sandboxReady()).toBeNull();
  });
});

describe('persona mapping and token expiry', () => {
  it('maps every shopper onto one of the four scripted personas, the same one every time, mostly clean', () => {
    const counts: Record<string, number> = {};
    for (let id = 1; id <= 10_000; id++) {
      const p = personaFor(id);
      expect(PERSONA_IDS).toContain(p);
      expect(personaFor(id)).toBe(p);
      counts[p] = (counts[p] ?? 0) + 1;
    }
    expect(counts.P01! / 10_000).toBeGreaterThan(0.85);
    for (const p of ['P12', 'P13', 'P16']) expect(counts[p]).toBeGreaterThan(100);
  });

  it('reads expires as seconds from now or as an epoch in seconds or milliseconds', () => {
    const now = 1_800_000_000_000;
    expect(tokenUntil({ expires: 3600 }, now)).toBe(now + 3_540_000);
    expect(tokenUntil({ expires: (now + 7_200_000) / 1000 }, now)).toBe(now + 7_140_000);
    expect(tokenUntil({ expires: now + 7_200_000 }, now)).toBe(now + 7_140_000);
    expect(tokenUntil({}, now)).toBe(now + 600_000);
  });
});
