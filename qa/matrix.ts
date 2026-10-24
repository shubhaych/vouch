// Loop 2 claim video matrix. Drives each case the way a phone does: a fresh
// shopper identity joins, buys, fast-forwards, files a claim and uploads a
// video to the worker; then reads back the checks, the agents' outputs and
// the recommendation, and (where the case says) decides as the business or
// controller. Writes qa/results/matrix-<mode>.json. QA only: never fixes.
//   npx tsx qa/matrix.ts [--only V02,V08] [--skip-stale]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from '../scripts/_env';

loadEnv();
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const dbName = process.env.STDB_DB || 'vouch';
const worker = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
const businessCode = process.env.DEMO_BUSINESS_CODE || 'vouch-business';
const controllerCode = process.env.DEMO_CONTROLLER_CODE || 'vouch-controller';
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1]!.split(',')) : null;
const skipStale = argv.includes('--skip-stale');
const V = (f: string) => `qa/videos/${f}`;

const QUERIES = [
  'SELECT * FROM my_agent', "SELECT * FROM purchase WHERE source = 'live'", "SELECT * FROM refund WHERE source = 'live'", 'SELECT * FROM claim',
  'SELECT * FROM decision', 'SELECT * FROM evidence', 'SELECT * FROM agent_run', 'SELECT * FROM journal_entry', 'SELECT * FROM role',
  'SELECT * FROM agent WHERE is_live = true', 'SELECT * FROM control', 'SELECT * FROM credit_event WHERE cause_table = \'refund\'',
];

function open(token?: string): Promise<DbConnection> {
  return new Promise((res, rej) => {
    let b = DbConnection.builder().withUri(uri).withDatabaseName(dbName);
    if (token) b = b.withToken(token);
    b.onConnect((conn) => { conn.subscriptionBuilder().onApplied(() => res(conn)).subscribe(QUERIES); })
      .onConnectError((_c, e) => rej(e)).build();
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wait<T>(what: string, f: () => T | undefined, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Shopper { conn: DbConnection; agentId: number }
async function shopper(name: string, token?: string): Promise<Shopper> {
  const conn = await open(token);
  if (![...conn.db.myAgent.iter()][0]) await conn.reducers.joinAsShopper({ name });
  const me = await wait('my agent', () => [...conn.db.myAgent.iter()][0]);
  return { conn, agentId: me.agentId };
}

async function fileClaim(s: Shopper, businessId = 2, sku = 1) {
  const db = s.conn.db;
  const before = new Set([...db.purchase.iter()].map((p) => p.id));
  await s.conn.reducers.buy({ businessId, sku });
  const p = await wait('purchase', () => [...db.purchase.iter()].find((x) => x.buyer === s.agentId && !before.has(x.id)));
  await s.conn.reducers.fastForward({ purchaseId: p.id });
  await s.conn.reducers.requestRefund({ purchaseId: p.id, reasonCode: 'defective', reasonText: 'The item arrived cracked and does not work.' });
  const refund = await wait('refund', () => [...db.refund.iter()].find((r) => r.purchaseId === p.id));
  const claim = await wait('claim', () => [...db.claim.iter()].find((c) => c.refundId === refund.id));
  return { purchase: p, refund, claim };
}

async function upload(claimId: bigint, nonce: string, file: string) {
  const form = new FormData();
  form.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), file.split('/').pop());
  const t0 = Date.now();
  const res = await fetch(`${worker}/upload/${claimId}?nonce=${encodeURIComponent(nonce)}`, { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; frames?: number; checks?: Record<string, unknown> };
  return { status: res.status, body, t0 };
}

interface Outcome {
  checks?: Record<string, unknown>;
  evidenceFlags?: { unable_to_verify?: boolean; capture_flags?: string[]; challenge?: unknown; provenance?: string; summary?: string };
  recommendation?: { action: string; amount: number; method: string; confidence: number; status: string; reasons: string[] };
  offline?: boolean; runsStarted?: number; secondsToRec?: number;
}
async function outcome(conn: DbConnection, claimId: bigint, refundId: bigint, t0: number, ms = 5 * 60_000): Promise<Outcome> {
  const db = conn.db;
  const d = await wait('recommendation', () => [...db.decision.iter()].filter((x) => x.refundId === refundId).sort((a, b) => Number(b.id - a.id))[0]
    ?? ([...db.claim.iter()].find((c) => c.id === claimId)?.status === 'offline' ? null : undefined), ms).catch(() => undefined);
  const secs = (Date.now() - t0) / 1000;
  await sleep(500);
  const claim = [...db.claim.iter()].find((c) => c.id === claimId);
  const ev = [...db.evidence.iter()].filter((e) => e.claimId === claimId);
  const ea = ev.find((e) => e.seat === 'evidence_analyst');
  const eaJson = ea ? (JSON.parse(ea.json) as Record<string, unknown>) : undefined;
  const runs = [...db.agentRun.iter()].filter((r) => r.caseRef === `C-${claimId}`);
  return {
    checks: claim?.checksJson ? (JSON.parse(claim.checksJson) as Record<string, unknown>) : undefined,
    evidenceFlags: eaJson ? { unable_to_verify: eaJson.unable_to_verify as boolean, capture_flags: eaJson.capture_flags as string[], challenge: eaJson.challenge_passed ?? eaJson.challenge, provenance: ea!.provenance, summary: String(eaJson.summary ?? '').slice(0, 160) } : undefined,
    recommendation: d ? { action: d.action, amount: d.amount, method: d.method, confidence: d.confidence, status: d.status, reasons: (JSON.parse(d.reasonsJson || '[]') as { text: string; cites: string }[]).map((r) => `${r.cites}: ${r.text}`) } : undefined,
    offline: claim?.status === 'offline', runsStarted: runs.length, secondsToRec: d ? Math.round(secs * 10) / 10 : undefined,
  };
}

const journalFor = (conn: DbConnection, refundId: bigint) => {
  const ids = new Set([...conn.db.decision.iter()].filter((d) => d.refundId === refundId).map((d) => d.id));
  return [...conn.db.journalEntry.iter()].find((j) => ids.has(j.decisionId));
};
const score = (conn: DbConnection, agentId: number) => [...conn.db.agent.iter()].find((a) => a.id === agentId)?.score;

interface Row { id: string; persona: string; video: string; expected: string; actual: string; match: boolean | 'n/a'; details: unknown }
const rows: Row[] = [];
const record = (r: Row) => { rows.push(r); console.log(`${r.match === true ? 'PASS' : r.match === false ? 'FAIL' : 'NOTE'} ${r.id}: ${r.actual}`); };
const want = (id: string) => !only || only.has(id);

// ---------------------------------------------------------------- seats
const business = await open();
await business.reducers.takeBusinessSeat({ code: businessCode });
await business.reducers.switchBusiness({ businessId: 2 });
const controller = await open();
await controller.reducers.takeBusinessSeat({ code: controllerCode });
if (business.db.control.key.find('creao_enabled')?.value !== 'true') await business.reducers.setControl({ key: 'creao_enabled', value: 'true' });

// V14 needs a claim older than 10 minutes, so it is created first and uploaded last.
let stale: { s: Shopper; claim: { id: bigint; nonce: string }; created: number } | null = null;
if (want('V14') && !skipStale) {
  const s = await shopper('qa-v14');
  const { claim } = await fileClaim(s);
  stale = { s, claim, created: Date.now() };
  console.log(`V14: claim C-${claim.id} created; uploading after 11 minutes`);
}

// ---------------------------------------------------------------- nonce
if (want('NONCE')) {
  const s = await shopper('qa-nonce');
  const { claim } = await fileClaim(s);
  const u = await upload(claim.id, 'wrong-nonce', V('S07-fresh.mp4'));
  record({ id: 'NONCE', persona: 'P4', video: 'S07 with a wrong nonce', expected: 'Rejected (403) with a clear message', actual: `${u.status}: ${u.body.error ?? JSON.stringify(u.body)}`, match: u.status === 403, details: u.body });
}

// ---------------------------------------------------------------- V02 (stand-in for V01/V02: a generated, never-uploaded clip)
let firstClaim: bigint | null = null;
if (want('V02') || want('V08') || want('V09')) {
  const s = await shopper('qa-p1');
  const { claim, refund } = await fileClaim(s);
  firstClaim = claim.id;
  const before = score(s.conn, s.agentId);
  const u = await upload(claim.id, claim.nonce, V('G01-testsrc.mp4'));
  const o = await outcome(s.conn, claim.id, refund.id, u.t0);
  let decided = '';
  if (o.recommendation?.action === 'accept') {
    await business.reducers.decide({ refundId: refund.id, action: 'accept', amount: o.recommendation.amount, note: 'QA V02 accept' });
    const je = await wait('journal entry', () => journalFor(s.conn, refund.id), 20_000).catch(() => undefined);
    const after = await wait('score change', () => { const v = score(s.conn, s.agentId); return v !== before ? v : undefined; }, 15_000).catch(() => before);
    decided = `business accepted; credit ${before} → ${after}; journal entry ${je ? `#${je.id}` : 'missing'}`;
  }
  const ok = !!o.recommendation && o.recommendation.action !== 'decline' && u.status === 200;
  if (want('V02')) record({ id: 'V02', persona: 'P1', video: 'G01-testsrc (generated stand-in)', expected: 'Accept or smaller amount; never decline', actual: `upload ${u.status}; ${o.recommendation ? `${o.recommendation.action} $${(o.recommendation.amount / 100).toFixed(2)} ${o.recommendation.method} conf ${o.recommendation.confidence}` : 'no recommendation'} after ${o.secondsToRec}s; ${decided}`, match: ok, details: { upload: u.body, ...o } });
}

// ---------------------------------------------------------------- V08 / V09: reuse on new accounts
for (const [id, file] of [['V08', 'V08-reuse-copy.mp4'], ['V09', 'V09-reencoded.mp4']] as const) {
  if (!want(id) || firstClaim === null) continue;
  const s = await shopper(`qa-p4-${id}`);
  const { claim, refund } = await fileClaim(s);
  const u = await upload(claim.id, claim.nonce, V(file));
  const o = await outcome(s.conn, claim.id, refund.id, u.t0);
  const reuse = (u.body.checks?.frame_reuse ?? o.checks?.frame_reuse ?? []) as { claimId?: string; matches_claim?: string }[];
  const names = JSON.stringify(reuse);
  const ok = reuse.length > 0 && names.includes(String(firstClaim)) && o.recommendation?.action !== 'accept';
  record({ id, persona: 'P4', video: file, expected: `Frame reuse flag naming C-${firstClaim}; never accept`, actual: `reuse ${names.slice(0, 160)}; ${o.recommendation?.action ?? 'no recommendation'}`, match: ok, details: { upload: u.body, ...o } });
}

// ---------------------------------------------------------------- V10 slideshow, V11 black
for (const [id, file, expected] of [
  ['V10', 'V10-slideshow.mp4', 'Reuse against listing images, or more evidence'],
  ['V11', 'V11-black.mp4', 'Unable to verify; more evidence (never decline)'],
] as const) {
  if (!want(id)) continue;
  const s = await shopper(`qa-${id}`);
  const { claim, refund } = await fileClaim(s);
  const u = await upload(claim.id, claim.nonce, V(file));
  const o = await outcome(s.conn, claim.id, refund.id, u.t0);
  const ok = u.status === 200 && o.recommendation?.action === 'more_evidence';
  record({ id, persona: id === 'V10' ? 'P4' : 'P1', video: file, expected, actual: `upload ${u.status}; checks blank_frames=${String(o.checks?.blank_frames ?? u.body.checks?.blank_frames)}; EA unable_to_verify=${String(o.evidenceFlags?.unable_to_verify)}; ${o.recommendation?.action ?? 'no recommendation'} ${o.recommendation ? `$${(o.recommendation.amount / 100).toFixed(2)}` : ''}`, match: ok, details: { upload: u.body, ...o } });
}

// ---------------------------------------------------------------- V12 short, V13 corrupt
for (const [id, file] of [['V12', 'V12-short.mp4'], ['V13', 'V13-corrupt.mp4']] as const) {
  if (!want(id)) continue;
  const s = await shopper(`qa-${id}`);
  const { claim } = await fileClaim(s);
  const u = await upload(claim.id, claim.nonce, V(file));
  const health = await fetch(`${worker}/health`).then((r) => r.ok).catch(() => false);
  const ok = u.status >= 400 && u.status < 500 && !!u.body.error && health;
  record({ id, persona: 'P1', video: file, expected: 'Rejected at upload with a clear message, no crash', actual: `${u.status}: ${u.body.error ?? ''}; worker healthy=${health}`, match: ok, details: u.body });
}

// ---------------------------------------------------------------- V15: kill switch off
if (want('V15')) {
  await business.reducers.setControl({ key: 'creao_enabled', value: 'false' });
  const s = await shopper('qa-v15');
  const { claim, refund } = await fileClaim(s);
  const u = await upload(claim.id, claim.nonce, V('S03-fresh.mp4'));
  await wait('offline', () => [...s.conn.db.claim.iter()].find((c) => c.id === claim.id && c.status === 'offline'), 60_000).catch(() => undefined);
  const o = await outcome(s.conn, claim.id, refund.id, u.t0, 15_000);
  const acceptErr = await business.reducers.decide({ refundId: refund.id, action: 'accept', amount: refund.amount, note: 'QA V15 accept while offline' }).then(() => 'accepted (should not be possible)', errText);
  const moreErr = await business.reducers.decide({ refundId: refund.id, action: 'more_evidence', amount: 0, note: 'QA V15 more evidence' }).then(() => 'ok', errText);
  await business.reducers.setControl({ key: 'creao_enabled', value: 'true' });
  const ok = !!o.offline && o.runsStarted === 0 && acceptErr !== 'accepted (should not be possible)' && moreErr === 'ok';
  record({ id: 'V15', persona: 'P2→fresh shopper', video: 'S03-fresh (stand-in)', expected: '"Investigator offline"; no run; business can only request more evidence', actual: `offline=${o.offline}; runs=${o.runsStarted}; accept → ${acceptErr}; more_evidence → ${moreErr}`, match: ok, details: o });
}

// ---------------------------------------------------------------- V16: above $500 goes to the controller
if (want('V16')) {
  const s = await shopper('qa-v16');
  const { claim, refund } = await fileClaim(s, 2, 21);
  const u = await upload(claim.id, claim.nonce, V('S04-fresh.mp4'));
  const o = await outcome(s.conn, claim.id, refund.id, u.t0);
  let flow = '';
  if (o.recommendation?.action === 'accept') {
    await business.reducers.decide({ refundId: refund.id, action: 'accept', amount: o.recommendation.amount, note: 'QA V16 business accept' });
    await sleep(800);
    const st1 = [...s.conn.db.refund.iter()].find((r) => r.id === refund.id)?.status;
    const ctrl = await controller.reducers.decide({ refundId: refund.id, action: 'accept', amount: o.recommendation.amount, note: 'QA V16 controller approves' }).then(() => 'ok', errText);
    await sleep(800);
    const st2 = [...s.conn.db.refund.iter()].find((r) => r.id === refund.id)?.status;
    const je = await wait('journal entry', () => journalFor(s.conn, refund.id), 20_000).catch(() => undefined);
    flow = `business accept → refund ${st1}; controller accept → ${ctrl}, refund ${st2}; journal ${je ? `#${je.id}` : 'missing'}`;
  }
  const ok = refund.amount > 50_000 && flow.includes('sent_to_controller') && flow.includes('refund accepted');
  record({ id: 'V16', persona: 'P2→fresh shopper', video: 'S04-fresh (stand-in)', expected: 'Recommendation goes to the controller', actual: `amount $${(refund.amount / 100).toFixed(2)}; ${o.recommendation?.action ?? 'no recommendation'}; ${flow}`, match: ok, details: o });
}

// ---------------------------------------------------------------- P6: the proposer (worker) cannot decide; a shopper cannot decide
if (want('P6')) {
  const s = await shopper('qa-p6');
  const { claim, refund } = await fileClaim(s);
  const u = await upload(claim.id, claim.nonce, V('S06-fresh.mp4'));
  await outcome(s.conn, claim.id, refund.id, u.t0);
  let workerErr = 'worker token not found';
  try {
    const token = readFileSync('worker/.keys/stdb-worker-token', 'utf8').trim();
    const w = await open(token);
    workerErr = await w.reducers.decide({ refundId: refund.id, action: 'accept', amount: refund.amount, note: 'QA: proposer tries to decide' }).then(() => 'DECIDED (should fail)', errText);
    w.disconnect();
  } catch (e) { workerErr = errText(e); }
  const shopperErr = await s.conn.reducers.decide({ refundId: refund.id, action: 'accept', amount: refund.amount, note: 'QA: shopper tries to decide' }).then(() => 'DECIDED (should fail)', errText);
  const ok = !workerErr.startsWith('DECIDED') && !shopperErr.startsWith('DECIDED') && workerErr !== 'worker token not found';
  record({ id: 'P6', persona: 'P6', video: 'S06-fresh', expected: 'The proposer identity and a shopper cannot decide', actual: `worker → ${workerErr}; shopper → ${shopperErr}`, match: ok, details: {} });
}

// ---------------------------------------------------------------- P3: repeat claimer (make-agent --purchases 10 --refunds 6)
if (want('P3')) {
  const file = argv.includes('--p3') ? argv[argv.indexOf('--p3') + 1]! : '';
  if (file) {
    const a = JSON.parse(readFileSync(file, 'utf8')) as { agentId: number; token: string; claims: { claimId: string; nonce: string }[] };
    const s = await shopper('qa-p3', a.token);
    const c = a.claims[0]!;
    const refund = [...s.conn.db.claim.iter()].find((x) => String(x.id) === c.claimId);
    const u = await upload(BigInt(c.claimId), c.nonce, V('S05-fresh.mp4'));
    const o = refund ? await outcome(s.conn, BigInt(c.claimId), refund.refundId, u.t0) : {};
    const rec = (o as Outcome).recommendation;
    record({ id: 'P3', persona: 'P3', video: 'S05-fresh', expected: 'More scrutiny; never an automatic decline', actual: `upload ${u.status}; ${rec ? `${rec.action} $${(rec.amount / 100).toFixed(2)}; reasons: ${rec.reasons.join(' | ').slice(0, 200)}` : 'no recommendation'}`, match: !!rec && rec.action !== 'decline', details: { upload: u.body, ...o } });
  }
}

// ---------------------------------------------------------------- V14: stale
if (stale) {
  const left = stale.created + 11 * 60_000 - Date.now();
  if (left > 0) { console.log(`V14: waiting ${Math.round(left / 1000)} s`); await sleep(left); }
  const u = await upload(stale.claim.id, stale.claim.nonce, V('S08-fresh.mp4'));
  record({ id: 'V14', persona: 'P1', video: 'S08-fresh, 11 minutes after the claim', expected: 'Rejected as stale', actual: `${u.status}: ${u.body.error ?? ''}`, match: u.status === 410, details: u.body });
}

mkdirSync('qa/results', { recursive: true });
const mode = process.env.CREAO_MODE || 'fixture';
const out = `qa/results/matrix-${mode}${only ? `-${[...only].join('_')}` : ''}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), mode, rows }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\n${rows.filter((r) => r.match === true).length}/${rows.length} as expected → ${out}`);
process.exit(0);
