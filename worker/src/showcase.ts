// The home page's "buy, then verify" demo. Once per (re)seed the worker plays
// the showcase agent A-00421 through the same reducers a person uses: buy
// headphones at Business B, fast-forward delivery, file a claim, upload a
// video, run the two investigators, verify its credential from Business A,
// and have a business seat accept. Every row is real (badge: Simulated).
//
// So the loop never burns CREAO credits, the two investigator steps write the
// stored output of the most recent real showcase run (badge: Replay of real
// run). Until a live run has been recorded they use the hand-written fixtures
// (badge: Fixture). "Watch it live" (controller only) runs CREAO for real once.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DbConnection } from '../module_bindings/index';
import { BUSINESS_A, BUSINESS_B, SHOWCASE_SKU } from '@vouch/module/world';
import { REPO_ROOT, config, log } from './env';
import { call, connect } from './stdb';
import { processUpload } from './video';
import { fixtureResponse } from './fixtures';
import type { Credentials } from './credentials';
import type { Orchestrator } from './orchestrator';
import { mirrorOf } from './mirror';

const run = promisify(execFile);
export const SHOWCASE_AGENT = 421;
const RECORDING = resolve(REPO_ROOT, 'worker/fixtures/showcase/recorded.json');
const CLAIM_TEXT = 'The left ear cup cracked within the first week of normal use; the hinge creaks and the cup came loose.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Recorded { evidence: unknown; investigator: unknown; evidenceRun: { runId: string; runUrl: string }; investigatorRun: { runId: string; runUrl: string }; recordedAt: string }

export class Showcase {
  private running = false;
  private lastSeedKey = '';
  private seat: DbConnection | null = null;
  orchestrator: Orchestrator | null = null;

  constructor(private conn: DbConnection, private credentials: Credentials) {}

  start() {
    this.conn.db.simRun.onUpdate((_c, _o, run) => {
      const key = `${run.seed}:${run.startDay}:${run.population}`;
      if (!run.seeded || this.running || run.day < run.startDay + 3) return;
      const already = mirrorOf(this.conn).purchasesOf(SHOWCASE_AGENT).some((p) => p.source === 'showcase');
      if (already) { this.lastSeedKey = key; return; }
      if (key === this.lastSeedKey && already) return;
      this.lastSeedKey = key;
      this.runNow({ live: false });
    });
  }

  private async businessSeat(): Promise<DbConnection> {
    if (this.seat) return this.seat;
    const { conn } = await connect('showcase', []);
    await conn.reducers.takeBusinessSeat({ code: config.demoBusinessCode }).catch((e: Error) => log('showcase seat:', e.message));
    await conn.reducers.switchBusiness({ businessId: BUSINESS_B }).catch(() => undefined);
    this.seat = conn;
    return conn;
  }

  runNow(opts: { live: boolean }): boolean {
    if (this.running) return false;
    this.running = true;
    this.sequence(opts.live).catch((e) => log(`showcase failed: ${(e as Error).message}`)).finally(() => { this.running = false; });
    return true;
  }

  /** A short synthetic clip (a different random pattern every run, so frame hashes never collide). Replace with a real phone video in qa/videos/showcase.mp4. */
  private async video(): Promise<{ data: Buffer; ext: string }> {
    const real = resolve(REPO_ROOT, 'qa/videos/showcase.mp4');
    if (existsSync(real)) return { data: readFileSync(real), ext: 'mp4' };
    const dir = resolve(config.mediaDir, 'showcase');
    mkdirSync(dir, { recursive: true });
    const out = resolve(dir, `synthetic-${Date.now()}.mp4`);
    const seed = Math.floor(Math.random() * 1e9);
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `life=s=640x480:mold=10:r=15:ratio=0.12:seed=${seed}:life_color=#22d3ee:death_color=#0b0f14`, '-t', '10', '-pix_fmt', 'yuv420p', out]);
    return { data: readFileSync(out), ext: 'mp4' };
  }

  private recorded(): Recorded | null {
    return existsSync(RECORDING) ? (JSON.parse(readFileSync(RECORDING, 'utf8')) as Recorded) : null;
  }

  private async sequence(live: boolean) {
    const db = this.conn.db;
    const r = this.conn.reducers;
    log(`showcase: A-00421 buy → verify sequence (${live ? 'live CREAO' : 'replay'})`);
    if (![...db.credential.iter()].some((c) => c.issuer === BUSINESS_A && c.holder === this.credentials.holderFor(SHOWCASE_AGENT).did && !c.revoked)) {
      await this.credentials.issue(SHOWCASE_AGENT, BUSINESS_A);
    }
    const m = mirrorOf(this.conn);
    const before = new Set(m.purchasesOf(SHOWCASE_AGENT).map((p) => p.id));
    await call('showcase buy', r.showcaseAct({ action: 'buy', businessId: BUSINESS_B, sku: SHOWCASE_SKU, purchaseId: 0n, reasonCode: '', reasonText: '' }));
    await sleep(800);
    const purchase = m.purchasesOf(SHOWCASE_AGENT).find((p) => !before.has(p.id));
    if (!purchase) throw new Error('showcase purchase did not appear');
    await sleep(3500);
    await call('showcase deliver', r.showcaseAct({ action: 'deliver', businessId: 0, sku: 0, purchaseId: purchase.id, reasonCode: '', reasonText: '' }));
    await sleep(3500);
    await call('showcase refund', r.showcaseAct({ action: 'refund', businessId: 0, sku: 0, purchaseId: purchase.id, reasonCode: 'defective', reasonText: CLAIM_TEXT }));
    await sleep(800);
    const refund = m.refundsOf(SHOWCASE_AGENT).find((x) => x.purchaseId === purchase.id);
    const claim = refund ? [...db.claim.iter()].find((c) => c.refundId === refund.id) : undefined;
    if (!refund || !claim) throw new Error('showcase claim did not appear');
    if (live) this.orchestrator?.liveShowcaseClaims.add(claim.id);
    await sleep(3000);
    const v = await this.video();
    await processUpload(this.conn, claim.id, claim.nonce, v.data, v.ext);

    if (live) {
      // The orchestrator runs both CREAO agents for real; wait for its proposal (runs take minutes).
      const t0 = Date.now();
      while (Date.now() - t0 < 20 * 60_000 && ![...db.decision.iter()].some((d) => d.refundId === refund.id && d.status === 'proposed')) await sleep(3000);
      this.saveRecording(claim.id);
    } else {
      await this.replayInvestigators(claim.id, refund.id, refund.amount, claim.fingerCount);
    }

    const seat = await this.businessSeat();
    await sleep(4500);
    const d = [...db.decision.iter()].find((x) => x.refundId === refund.id && x.status === 'proposed');
    if (d) {
      const action = d.action === 'accept' ? 'accept' : 'more_evidence';
      await call('showcase decide', seat.reducers.decide({ refundId: refund.id, action, amount: d.amount, note: 'Showcase: Business B accepts the recommendation' }));
    }
    log('showcase: sequence complete');
  }

  private async replayInvestigators(claimId: bigint, refundId: bigint, amount: number, fingers: number) {
    const r = this.conn.reducers;
    const rec = this.recorded();
    const prov = rec ? 'replay' : 'fixture';
    await sleep(4000);
    const evidence = rec?.evidence ?? fixtureResponse('evidence_analyst', { claim_id: `C-${claimId}`, challenge: { fingers }, frames: [1, 2, 3, 4] });
    await call('recordEvidence', r.recordEvidence({ claimId, seat: 'evidence_analyst', runId: rec?.evidenceRun.runId ?? '', runUrl: rec?.evidenceRun.runUrl ?? '', json: JSON.stringify(evidence), provenance: prov }));
    await sleep(3000);
    const credential = await this.credentials.check(SHOWCASE_AGENT, refundId, BUSINESS_B).catch(() => null);
    await sleep(3000);
    const inv = (rec?.investigator ?? fixtureResponse('refund_investigator', { claim_id: `C-${claimId}`, amount_requested: amount / 100, controller_threshold: 500, evidence, deterministic_checks: { frame_reuse: [] } })) as {
      action: string; amount: number; method: string; confidence: number; reasons: unknown[];
    };
    const reasons = [...(inv.reasons ?? [])];
    if (credential?.verified) reasons.push({ text: `Verified credential from ${credential.issuer}: 10 or more purchases, low refund ratio, no confirmed fraud.`, cites: `credential:${credential.issuer}` });
    await call('recordEvidence', r.recordEvidence({ claimId, seat: 'refund_investigator', runId: rec?.investigatorRun.runId ?? '', runUrl: rec?.investigatorRun.runUrl ?? '', json: JSON.stringify({ ...inv, reasons, credential }), provenance: prov }));
    await call('propose', r.propose({
      refundId, action: inv.action === 'accept' ? 'accept' : 'more_evidence', amount: inv.action === 'accept' ? amount : 0, method: inv.method || 'original_payment',
      confidence: Number(inv.confidence) || 0.7, reasonsJson: JSON.stringify(reasons), runId: rec?.investigatorRun.runId ?? `showcase-${prov}`, runUrl: rec?.investigatorRun.runUrl ?? '',
    }));
  }

  /** After a live showcase run, keep the real outputs so later loops replay them instead of spending credits. */
  private saveRecording(claimId: bigint) {
    const ev = [...this.conn.db.evidence.iter()].filter((e) => e.claimId === claimId);
    const a = ev.find((e) => e.seat === 'evidence_analyst' && e.provenance === 'live');
    const b = ev.find((e) => e.seat === 'refund_investigator' && e.provenance === 'live');
    if (!a || !b) return;
    mkdirSync(resolve(RECORDING, '..'), { recursive: true });
    const out: Recorded = {
      evidence: JSON.parse(a.json), investigator: JSON.parse(b.json), evidenceRun: { runId: a.runId, runUrl: a.runUrl }, investigatorRun: { runId: b.runId, runUrl: b.runUrl },
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(RECORDING, JSON.stringify(out, null, 2));
    log('showcase: recorded the live run for future replays');
  }
}
