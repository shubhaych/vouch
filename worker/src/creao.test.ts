import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMemoryHub } from './hub';

let server: Server;
const calls: { url: string; auth: string | undefined; body: unknown }[] = [];

before(async () => {
  // Stand-in shaped like the documented API: POST .../runs returns { id, status }.
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    calls.push({ url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'run_1', status: req.method === 'GET' ? 'completed' : 'running' }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.CREAO_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/apps`;
  process.env.CREAO_CREDIT_ANALYST_APP_ID = 'app_ca';
  process.env.CREAO_CREDIT_ANALYST_KEY = 'capi_test';
});
after(() => server.close());

// creao.ts reads CREAO_API_BASE at import time, so import after the stand-in is up.
const load = () => import('./creao');

test('startRun posts inputs and webhookUrl with the seat key, and records the run', async () => {
  const { startRun } = await load();
  const { hub, runs } = createMemoryHub(true);
  const ref = await startRun(hub, 'credit_analyst', 'subj_1', { subject: 'subj_1' }, 'https://example.com/creao/webhook');
  assert.equal(ref?.runId, 'run_1');
  assert.equal(calls.at(-1)?.url, '/api/v1/apps/app_ca/runs');
  assert.equal(calls.at(-1)?.auth, 'Bearer capi_test');
  assert.deepEqual(calls.at(-1)?.body, { inputs: { subject: 'subj_1' }, webhookUrl: 'https://example.com/creao/webhook' });
  assert.equal(runs.get('run_1')?.seat, 'credit_analyst');
});

test('kill switch: with agents off no run starts and nothing is sent', async () => {
  const { startRun } = await load();
  const { hub } = createMemoryHub(false);
  const before = calls.length;
  assert.equal(await startRun(hub, 'credit_analyst', 'subj_2', {}, 'https://example.com/w'), null);
  assert.equal(calls.length, before);
});

test('webhook retries with the same delivery id are handled once', async () => {
  const { onWebhook } = await load();
  const { hub, runs } = createMemoryHub(true);
  runs.set('run_9', { seat: 'refund_desk', caseRef: 'c', runId: 'run_9', status: 'running', startedAt: new Date() });
  await onWebhook(hub, 'd1', { runId: 'run_9', status: 'completed', result: { text: '{"verdict":"supported"}' } });
  runs.get('run_9')!.status = 'sentinel';
  await onWebhook(hub, 'd1', { runId: 'run_9', status: 'completed', result: { text: 'retry' } });
  assert.equal(runs.get('run_9')!.status, 'sentinel', 'the repeat must not overwrite');
});

test('parseVerdict fails closed to the fallback', async () => {
  const { parseVerdict } = await load();
  const fallback = { verdict: 'unable_to_verify' };
  assert.deepEqual(parseVerdict(null, fallback), fallback);
  assert.deepEqual(parseVerdict('not json at all', fallback), fallback);
  assert.deepEqual(parseVerdict('sure! {"verdict":"supported"} done', fallback), { verdict: 'supported' });
});
