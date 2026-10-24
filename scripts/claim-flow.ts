// Drives one live claim end to end through the real reducers and the worker's
// upload route, the way the phone does. Used by the QA loop and as a smoke test.
//   npx tsx scripts/claim-flow.ts [video] [--sku 1] [--business 2] [--accept]
// Without a video it records a fresh moving clip, so frames never match an earlier claim
// and the still-image check does not fire.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from './_env';

loadEnv();
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const dbName = process.env.STDB_DB || 'vouch';
const worker = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
function freshClip(): string {
  mkdirSync('test-results', { recursive: true });
  const out = `test-results/claim-flow-${Date.now()}.mp4`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `life=s=640x480:mold=10:r=15:ratio=0.1:seed=${Date.now() % 1e9}`, '-t', '8', '-pix_fmt', 'yuv420p', out]);
  return out;
}
const video = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? freshClip();
const sku = Number(opt('sku', '1'));
const businessId = Number(opt('business', '2'));

function connectAs(): Promise<{ conn: DbConnection; hex: string }> {
  return new Promise((res, rej) => {
    DbConnection.builder().withUri(uri).withDatabaseName(dbName).onConnect((conn, id) => {
      const hex = id.toHexString();
      conn.subscriptionBuilder().onApplied(() => res({ conn, hex })).subscribe([
        'SELECT * FROM my_agent', 'SELECT * FROM purchase WHERE source = \'live\'', 'SELECT * FROM refund WHERE source = \'live\'', 'SELECT * FROM claim',
        'SELECT * FROM decision', 'SELECT * FROM evidence', 'SELECT * FROM journal_entry', 'SELECT * FROM role', 'SELECT * FROM agent WHERE is_live = true',
      ]);
    }).onConnectError((_c, e) => rej(e)).build();
  });
}
const wait = async <T>(what: string, f: () => T | undefined, ms = 60_000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

const { conn, hex } = await connectAs();
await conn.reducers.joinAsShopper({ name: 'claim-flow' });
const me = await wait('my agent', () => [...conn.db.myAgent.iter()][0]);
console.log(`shopper agent A-${me.agentId}`);
const before = new Set([...conn.db.purchase.iter()].map((p) => p.id));
await conn.reducers.buy({ businessId, sku });
const p = await wait('purchase', () => [...conn.db.purchase.iter()].find((x) => x.buyer === me.agentId && !before.has(x.id)));
await conn.reducers.fastForward({ purchaseId: p.id });
await conn.reducers.requestRefund({ purchaseId: p.id, reasonCode: 'defective', reasonText: 'The left cup cracked and the hinge creaks.' });
const refund = await wait('refund', () => [...conn.db.refund.iter()].find((r) => r.purchaseId === p.id));
const claim = await wait('claim', () => [...conn.db.claim.iter()].find((c) => c.refundId === refund.id));
console.log(`claim C-${claim.id}: hold up ${claim.fingerCount} fingers, nonce ${claim.nonce}`);
const form = new FormData();
form.append('video', new Blob([readFileSync(video)], { type: 'video/mp4' }), video.split('/').pop());
const t0 = Date.now();
const res = await fetch(`${worker}/upload/${claim.id}?nonce=${claim.nonce}`, { method: 'POST', body: form });
const body = (await res.json()) as { ok: boolean; error?: string; frames?: number; checks?: { frame_reuse: unknown[]; duration_s: number } };
console.log(`upload ${res.status}: ${body.ok ? `${body.frames} frames, ${body.checks?.duration_s}s, reuse ${JSON.stringify(body.checks?.frame_reuse)}` : body.error}`);
if (!body.ok) process.exit(0);
const d = await wait('recommendation', () => [...conn.db.decision.iter()].find((x) => x.refundId === refund.id), 20 * 60_000).catch(() => undefined);
const offline = [...conn.db.claim.iter()].find((c) => c.id === claim.id)?.status === 'offline';
console.log(d ? `recommendation after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${d.action} ${d.amount ? `$${(d.amount / 100).toFixed(2)}` : ''} (confidence ${d.confidence})` : offline ? 'investigator offline' : 'no recommendation');
console.log('evidence rows:', [...conn.db.evidence.iter()].filter((e) => e.claimId === claim.id).map((e) => `${e.seat}/${e.provenance}`).join(', '));
if (args.includes('--accept') && d) {
  const code = process.env.DEMO_BUSINESS_CODE || 'vouch-business';
  await conn.reducers.takeBusinessSeat({ code });
  await conn.reducers.switchBusiness({ businessId });
  const score0 = [...conn.db.agent.iter()].find((a) => a.id === me.agentId)?.score;
  await conn.reducers.decide({ refundId: refund.id, action: 'accept', amount: d.amount, note: 'claim-flow accept' });
  const je = await wait('journal entry', () => [...conn.db.journalEntry.iter()].find((j) => j.decisionId === d.id), 15_000).catch(() => undefined);
  const score1 = await wait('score change', () => { const s = [...conn.db.agent.iter()].find((a) => a.id === me.agentId)?.score; return s !== score0 ? s : undefined; }, 10_000).catch(() => score0);
  console.log(`accepted: credit ${score0} → ${score1}; journal entry ${je ? `#${je.id} posted` : 'missing'}`);
}
void hex;
conn.disconnect();
process.exit(0);
