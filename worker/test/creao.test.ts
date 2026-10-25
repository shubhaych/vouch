import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureResponse } from '../src/fixtures';

// T2.6: unparseable agent output fails closed. And the adapter speaks both documented API paths
// (checked against a stand-in server shaped like CREAO's docs; not a live CREAO call).
let server: Server;
const seen: { method: string; url: string; auth: string; body: string }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/agents') return res.end(JSON.stringify({ agents: [{ agent_id: 'ag_ev', name: 'Vouch Evidence Analyst' }, { agent_id: 'ag_ri', name: 'Vouch Refund Investigator' }, { agent_id: 'ag_pa', name: 'Vouch Pattern Analyst' }] }));
      if (req.url === '/v1/runs' && req.method === 'POST') return res.end(JSON.stringify({ run_id: 'run_1', status: 'pending', agent_id: 'ag_ev', conversation_id: 'conv_1' }));
      if (req.url === '/v1/runs/run_1') return res.end(JSON.stringify({ status: 'completed', result: { text: 'Here you go:\n```json\n{"unable_to_verify": false, "summary": "ok"}\n```' } }));
      if (req.url?.startsWith('/apps/app_ri/runs') && req.method === 'POST') return res.end(JSON.stringify({ id: 'r_app', status: 'pending', appId: 'app_ri' }));
      if (req.url === '/runs/r_app') return res.end(JSON.stringify({ status: 'completed', result: { text: 'not json at all' } }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
});
afterAll(() => server.close());

async function adapter(env: Record<string, string>) {
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, { CREAO_ACCOUNT_BASE: `http://localhost:${port}/v1`, CREAO_APP_BASE: `http://localhost:${port}/apps`, CREAO_RUNS_BASE: `http://localhost:${port}/runs`, ...env });
  const { config } = await import('../src/env');
  config.creao.mode = 'live';
  config.creao.apiKey = env.CREAO_API_KEY ?? '';
  // Start from no ids or app keys, so the developer's real .env cannot leak into these tests.
  for (const m of [config.creao.agentIds, config.creao.appIds, config.creao.appKeys]) for (const k of Object.keys(m)) (m as Record<string, string>)[k] = '';
  return import('../src/creao');
}

describe('CREAO adapter', () => {
  it('account path: finds agents by name, starts with agent_id + input.case, polls result.text', async () => {
    const c = await adapter({ CREAO_API_KEY: 'cr_sk_test' });
    expect(c.apiPath()).toBe('account');
    const ids = await c.resolveAgents();
    expect(ids.evidence_analyst).toBe('ag_ev');
    const h = await c.startRun('evidence_analyst', { claim_id: 'C-1' }, 'C-1');
    const start = seen.find((s) => s.url === '/v1/runs')!;
    expect(JSON.parse(start.body)).toMatchObject({ agent_id: 'ag_ev', input: { case: JSON.stringify({ claim_id: 'C-1' }) } });
    expect(start.auth).toBe('Bearer cr_sk_test');
    const r = await c.pollRun(h, {});
    expect(r.status).toBe('completed');
    const v = c.parseVerdict(r.text, { unable_to_verify: true, summary: '' }, (x) => typeof x.unable_to_verify === 'boolean');
    expect(v).toEqual({ value: { unable_to_verify: false, summary: 'ok' }, ok: true });
  });

  it('app path: inputs.case on /apps/{appId}/runs; unparseable output fails closed to the fallback', async () => {
    const c = await adapter({ CREAO_API_KEY: 'capi_test' });
    const { config } = await import('../src/env');
    config.creao.appIds.refund_investigator = 'app_ri';
    expect(c.apiPath()).toBe('app');
    const h = await c.startRun('refund_investigator', { claim_id: 'C-2' }, 'C-2');
    const start = seen.find((s) => s.url === '/apps/app_ri/runs')!;
    expect(JSON.parse(start.body)).toMatchObject({ inputs: { case: JSON.stringify({ claim_id: 'C-2' }) } });
    const r = await c.pollRun(h, {});
    const fallback = { action: 'more_evidence' };
    expect(c.parseVerdict(r.text, fallback, (x) => ['accept', 'decline', 'more_evidence'].includes(String(x.action)))).toEqual({ value: fallback, ok: false });
    expect(c.parseVerdict('{"action":"approve"}', fallback, (x) => ['accept', 'decline', 'more_evidence'].includes(String(x.action))).ok).toBe(false);
    expect(c.parseVerdict(null, fallback, () => true).value).toBe(fallback);
  });

  it('per-seat apps need no account key: each seat sends its own capi_ key; a core seat with no app fails loudly', async () => {
    const c = await adapter({ CREAO_API_KEY: '' });
    const { config } = await import('../src/env');
    for (const s of ['evidence_analyst', 'refund_investigator', 'pattern_analyst'] as const) { config.creao.appIds[s] = `app_${s}`; config.creao.appKeys[s] = `capi_${s}`; }
    config.creao.appIds.refund_investigator = 'app_ri';
    expect(c.apiPath()).toBe('app');
    expect(c.seatPath('evidence_analyst')).toBe('app');
    expect(c.seatPath('listing_matcher')).toBe('none');
    expect(c.seatAvailable('listing_matcher')).toBe(false);
    const ids = await c.resolveAgents();
    expect(ids).toMatchObject({ evidence_analyst: 'app_evidence_analyst', refund_investigator: 'app_ri' });
    expect(seen.some((s) => s.url === '/v1/agents' && s.auth === 'Bearer ')).toBe(false);
    const n = seen.length;
    await c.startRun('refund_investigator', { claim_id: 'C-3' }, 'C-3');
    expect(seen[n]).toMatchObject({ url: '/apps/app_ri/runs', auth: 'Bearer capi_refund_investigator' });
    config.creao.appKeys.pattern_analyst = '';
    await expect(c.resolveAgents()).rejects.toThrow(/CREAO_PATTERN_ANALYST_APP_ID and CREAO_PATTERN_ANALYST_KEY/);
  });

  it('a seat with an app runs there even when an account key is also set', async () => {
    const c = await adapter({ CREAO_API_KEY: 'cr_sk_test' });
    const { config } = await import('../src/env');
    config.creao.appIds.refund_investigator = 'app_ri';
    config.creao.appKeys.refund_investigator = 'capi_ri';
    expect(c.seatPath('refund_investigator')).toBe('app');
    expect(c.seatPath('evidence_analyst')).toBe('account');
  });

  it('webhooks are deduplicated on the delivery id', async () => {
    const c = await adapter({ CREAO_API_KEY: 'cr_sk_test' });
    let n = 0;
    c.onWebhookCompletion('run_w', () => n++);
    expect(c.handleWebhook('d-1', { runId: 'run_w', status: 'completed', result: { text: '{}' } })).toBe(200);
    expect(c.handleWebhook('d-1', { runId: 'run_w', status: 'completed', result: { text: '{}' } })).toBe(200);
    expect(n).toBe(1);
  });
});

describe('fixtures follow each prompt\'s hard rules', () => {
  const inv = (extra: object) => fixtureResponse('refund_investigator', { claim_id: 'C-9', amount_requested: 249, controller_threshold: 500, evidence: { unable_to_verify: false, challenge: { passed: true }, capture_flags: [] }, deterministic_checks: { frame_reuse: [], within_window: true }, ...extra }) as { action: string; amount: number };
  it('accepts a clean claim with the requested amount; never accepts on reuse, offline, unverifiable or a failed challenge', () => {
    expect(inv({})).toMatchObject({ action: 'accept', amount: 249 });
    expect(inv({ deterministic_checks: { frame_reuse: [{ frame: 1 }], within_window: true } }).action).toBe('more_evidence');
    expect(inv({ evidence: { offline: true } }).action).toBe('more_evidence');
    expect(inv({ evidence: { unable_to_verify: true } }).action).toBe('more_evidence');
    expect(inv({ evidence: { challenge: { passed: false } } }).action).toBe('more_evidence');
    expect(inv({ deterministic_checks: { frame_reuse: [], within_window: true, still_image: true } }).action).toBe('more_evidence'); // QA-003
  });
  it('QA-004 the history reason states the real numbers; a high refund ratio lowers confidence but never declines', () => {
    type R = { action: string; confidence: number; reasons: { text: string; cites: string }[] };
    const hist = (bought: number, asked: number) => ({ history: { purchases_completed: bought, refunds_requested_90d: asked, refund_ratio_90d: Math.round((asked / bought) * 100) / 100 } });
    // The baseline is whatever the accept fixture says (a recorded run wins over the hand-written file).
    const baseline = (inv({}) as unknown as R).confidence;
    const repeat = inv(hist(10, 6)) as unknown as R;
    const h = repeat.reasons.find((r) => r.cites === 'history:refund_ratio_90d')!;
    expect(repeat.action).toBe('accept');
    expect(h.text).toContain('6 of the last 10');
    expect(h.text).not.toMatch(/in line with typical/);
    expect(repeat.confidence).toBeLessThan(baseline);
    const normal = inv(hist(20, 1)) as unknown as R;
    expect(normal.reasons.find((r) => r.cites === 'history:refund_ratio_90d')!.text).toContain('1 of the last 20');
    expect(normal.confidence).toBe(baseline);
  });
  it('T5.5 the Investigator cites a verified credential, and ignores one that failed', () => {
    const cited = (r: { reasons: { cites: string }[] }) => r.reasons.map((x) => x.cites);
    const ok = inv({ credential: { presented: true, verified: true, failed_step: null, issuer: 'B-019', claims: { refund_ratio_band: 'low' } } }) as unknown as { reasons: { cites: string }[] };
    expect(cited(ok)).toContain('credential:B-019');
    const failed = inv({ credential: { presented: true, verified: false, failed_step: 4, issuer: 'B-019', claims: {} } }) as unknown as { reasons: { cites: string }[] };
    expect(cited(failed)).not.toContain('credential:B-019');
  });
  it('the Evidence Analyst fixture is unable to verify mostly blank videos', () => {
    const r = fixtureResponse('evidence_analyst', { claim_id: 'C-1', challenge: { fingers: 3 }, frames: [1, 2, 3, 4, 5, 6], deterministic_checks: { blank_frames: 6 } }) as { unable_to_verify: boolean };
    expect(r.unable_to_verify).toBe(true);
  });
});

describe('answers with a trimmed output (live CREAO run 278efdc9, 2026-10-25)', () => {
  // The saved agent returned the decision in result.text and its reasoning only in chatText.
  const text = '{"case":"C-TEST2 electronics $249 defective","claim_id":"C-TEST2","action":"accept","amount":249,"method":"original_payment","needs_controller":"false","confidence":0.9}';
  const chat = "I'll start by reading the agent's manifest.**Decision:** accept $249.00.\n\n```json\n{\"action\":\"accept\"}\n```\nThe crack at frames 3–4 is a manufacturing defect inside the window.";
  const valid = (x: Record<string, unknown>) => ['accept', 'decline', 'more_evidence'].includes(String(x.action)) && Array.isArray(x.reasons);
  it('fills reasons from the prose, marks them, caps confidence and drops the echoed case', async () => {
    const { fillFromChat, parseVerdict } = await import('../src/creao');
    const r = parseVerdict(text, { action: 'more_evidence' }, valid, (v) => fillFromChat('refund_investigator', v, chat));
    expect(r.ok).toBe(true);
    const v = r.value as Record<string, unknown>;
    expect(v.action).toBe('accept');
    expect(v.reasons).toEqual([{ text: 'Decision: accept $249.00. The crack at frames 3–4 is a manufacturing defect inside the window.', cites: 'agent:summary' }]);
    expect(v.reasons_from_summary).toBe(true);
    expect(v.confidence).toBe(0.8);
    expect(v.needs_controller).toBe(false);
    expect(v.case).toBeUndefined();
  });
  it('still fails closed when the decision field itself is missing or invalid', async () => {
    const { fillFromChat, parseVerdict } = await import('../src/creao');
    expect(parseVerdict('{"action":"approve"}', {}, valid, (v) => fillFromChat('refund_investigator', v, chat)).ok).toBe(false);
    expect(parseVerdict('{"amount":249}', {}, valid, (v) => fillFromChat('refund_investigator', v, chat)).ok).toBe(false);
  });
});

describe('Listing Matcher with a trimmed output (live CREAO run df488ad2, 2026-10-25)', () => {
  it('keeps the top-level verdict and turns a bare matched_listing index into an object', async () => {
    const { fillFromChat, parseVerdict } = await import('../src/creao');
    const text = '{"claim_id":"C-TEST6","matched_listing":0,"same_as_ordered":"true","confidence":0.9,"verdict":"eligible"}';
    const r = parseVerdict(text, {}, (x) => typeof x.same_as_ordered === 'string' && typeof x.eligibility === 'object' && x.eligibility !== null, (v) => fillFromChat('listing_matcher', v, '**Verdict: eligible**, listing 0 matches.'));
    expect(r.ok).toBe(true);
    const v = r.value as { matched_listing: { index: number }; eligibility: { verdict: string; reasons: { cites: string }[] } };
    expect(v.eligibility.verdict).toBe('eligible');
    expect(v.matched_listing).toEqual({ index: 0 });
    expect(v.eligibility.reasons[0]!.cites).toBe('agent:summary');
  });
});

describe('Evidence Analyst with a flattened output (live CREAO run c0e8688a, 2026-10-25)', () => {
  it('reads "true" as true, wraps plain values and builds the challenge', async () => {
    const { fillFromChat, parseVerdict } = await import('../src/creao');
    const text = '{"claim_id":"C-TEST1","item_matches_reference":"uncertain","claimed_defect_visible":"uncertain","challenge_seen":"","challenge_passed":"","unable_to_verify":"true"}';
    const r = parseVerdict(text, {}, (x) => typeof x.unable_to_verify === 'boolean' && typeof x.summary === 'string', (v) => fillFromChat('evidence_analyst', v, '**Result: unable to verify — no frames submitted.**'));
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ unable_to_verify: true, item_matches_reference: { value: 'uncertain' }, challenge: { seen: null, passed: null }, summary: 'Result: unable to verify — no frames submitted.' });
  });
});
