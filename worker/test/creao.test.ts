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
      if (req.url === '/apps/app_ri/runs/r_app') return res.end(JSON.stringify({ status: 'completed', result: { text: 'not json at all' } }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
});
afterAll(() => server.close());

async function adapter(env: Record<string, string>) {
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, { CREAO_ACCOUNT_BASE: `http://localhost:${port}/v1`, CREAO_APP_BASE: `http://localhost:${port}/apps`, ...env });
  const { config } = await import('../src/env');
  config.creao.mode = 'live';
  config.creao.apiKey = env.CREAO_API_KEY ?? '';
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
    const { config } = await import('../src/env');
    config.creao.appIds.refund_investigator = 'app_ri';
    const c = await adapter({ CREAO_API_KEY: 'capi_test' });
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
