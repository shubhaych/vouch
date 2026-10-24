// Loop 2 unhappy paths that need the worker itself to misbehave:
//   1. the kill switch flipped while the Evidence Analyst run is in flight;
//   2. the worker restarted while a claim is being investigated.
// QA only: reports, never fixes. Restarts the local worker with scripts/worker-restart.sh.
//   npx tsx qa/unhappy.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from '../scripts/_env';

loadEnv();
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const dbName = process.env.STDB_DB || 'vouch';
const worker = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
const businessCode = process.env.DEMO_BUSINESS_CODE || 'vouch-business';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(): Promise<DbConnection> {
  return new Promise((res, rej) => {
    DbConnection.builder().withUri(uri).withDatabaseName(dbName).onConnect((conn) => {
      conn.subscriptionBuilder().onApplied(() => res(conn)).subscribe([
        'SELECT * FROM my_agent', "SELECT * FROM purchase WHERE source = 'live'", "SELECT * FROM refund WHERE source = 'live'",
        'SELECT * FROM claim', 'SELECT * FROM decision', 'SELECT * FROM agent_run', 'SELECT * FROM control', 'SELECT * FROM role',
      ]);
    }).onConnectError((_c, e) => rej(e)).build();
  });
}
async function wait<T>(f: () => T | undefined, ms: number): Promise<T | undefined> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = f(); if (v) return v; await sleep(100); }
  return undefined;
}
async function newClaim(conn: DbConnection) {
  await conn.reducers.joinAsShopper({ name: 'qa-unhappy' });
  const me = (await wait(() => [...conn.db.myAgent.iter()][0], 10_000))!;
  const before = new Set([...conn.db.purchase.iter()].map((p) => p.id));
  await conn.reducers.buy({ businessId: 2, sku: 1 });
  const p = (await wait(() => [...conn.db.purchase.iter()].find((x) => x.buyer === me.agentId && !before.has(x.id)), 10_000))!;
  await conn.reducers.fastForward({ purchaseId: p.id });
  await conn.reducers.requestRefund({ purchaseId: p.id, reasonCode: 'defective', reasonText: 'Cracked on arrival.' });
  const refund = (await wait(() => [...conn.db.refund.iter()].find((r) => r.purchaseId === p.id), 10_000))!;
  const claim = (await wait(() => [...conn.db.claim.iter()].find((c) => c.refundId === refund.id), 10_000))!;
  return { claim, refund };
}
async function upload(claimId: bigint, nonce: string, file: string) {
  const form = new FormData();
  form.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), file.split('/').pop());
  return fetch(`${worker}/upload/${claimId}?nonce=${nonce}`, { method: 'POST', body: form }).then((r) => r.status);
}
function freshClip(): string {
  mkdirSync('qa/results', { recursive: true });
  const out = `qa/results/clip-${Date.now()}.mp4`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `life=s=320x240:mold=10:r=15:ratio=0.1:seed=${Math.floor(Math.random() * 1e9)}`, '-t', '6', '-pix_fmt', 'yuv420p', out]);
  return out;
}

const results: { id: string; expected: string; actual: string; match: boolean }[] = [];
const conn = await open();
const biz = await open();
await biz.reducers.takeBusinessSeat({ code: businessCode });

// 1. Kill switch flipped mid-run.
{
  const { claim, refund } = await newClaim(conn);
  const status = upload(claim.id, claim.nonce, freshClip());
  const run = await wait(() => [...conn.db.agentRun.iter()].find((r) => r.caseRef === `C-${claim.id}`), 30_000);
  const flipAt = new Date().toISOString().slice(11, 23);
  await biz.reducers.setControl({ key: 'creao_enabled', value: 'false' });
  console.log(`C-${claim.id}: run ${run?.seat} seen; switch off sent at ${flipAt}`);
  await status;
  const final = await wait(() => {
    const c = [...conn.db.claim.iter()].find((x) => x.id === claim.id);
    const d = [...conn.db.decision.iter()].find((x) => x.refundId === refund.id);
    return c?.status === 'offline' || d ? { status: c?.status, decision: d?.action } : undefined;
  }, 30_000);
  await biz.reducers.setControl({ key: 'creao_enabled', value: 'true' });
  results.push({ id: 'KILL-MID-RUN', expected: 'claim goes offline; no proposal', actual: `run seen=${!!run}; claim ${final?.status ?? '?'}; proposal ${final?.decision ?? 'none'}`, match: final?.status === 'offline' && !final.decision });
}

// 2. Worker restarted while the claim is investigating. Fixture runs finish in
// under a second, so a restart cannot land mid-run by timing. Instead: stop the
// worker, put a claim in the exact state a crash mid-run leaves (status
// "investigating", no proposal) with the worker's own identity, start the worker.
if (!process.argv.includes('--kill-only')) {
  execFileSync('bash', ['-c', 'fuser -k 8787/tcp || true']);
  await sleep(1500);
  const { claim, refund } = await newClaim(conn);
  const token = readFileSync('worker/.keys/stdb-worker-token', 'utf8').trim();
  const w = await new Promise<DbConnection>((res, rej) => {
    DbConnection.builder().withUri(uri).withDatabaseName(dbName).withToken(token).onConnect((c) => res(c)).onConnectError((_c, e) => rej(e)).build();
  });
  await w.reducers.setClaimStatus({ claimId: claim.id, status: 'investigating' });
  w.disconnect();
  execFileSync('bash', ['scripts/worker-restart.sh']);
  for (let i = 0; i < 60; i++) { if (await fetch(`${worker}/health`).then((r) => r.ok).catch(() => false)) break; await sleep(1000); }
  const d = await wait(() => [...conn.db.decision.iter()].find((x) => x.refundId === refund.id), 45_000);
  const c = [...conn.db.claim.iter()].find((x) => x.id === claim.id);
  results.push({ id: 'WORKER-RESTART', expected: 'a claim left investigating by a crash is resumed after the worker comes back', actual: `C-${claim.id} after restart: status ${c?.status}; proposal ${d?.action ?? 'none after 45 s'}`, match: !!d });
}

mkdirSync('qa/results', { recursive: true });
writeFileSync('qa/results/unhappy.json', JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
for (const r of results) console.log(`${r.match ? 'PASS' : 'FAIL'} ${r.id}: ${r.actual}`);
process.exit(0);
