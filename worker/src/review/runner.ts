// The video reviewer. One claim at a time, in order:
//
//   frames_ready → ingest → transcript ∥ integrity → claims → Case Analyst (Droid, fenced)
//   → proof clips → Report Auditor (Droid) + the worker's own audit → score → report
//   → CREAO Refund Reviewer → propose (and, for T1/T2 the Reviewer agrees with, autoDecide)
//
// Every step writes an analysis_step row the phone shows live, every file Droid
// may cite is an artifact row, and the report is one validated JSON blob. When
// Droid cannot run the pipeline still finishes as "automated checks only",
// capped at T3. Nothing here can decline a refund.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbConnection } from '../../module_bindings/index';
import type { Claim } from '../../module_bindings/types';
import { catalogItem, type Policy } from '@vouch/module/world';
import { DEFAULT_AUTO_APPROVE_CENTS, FORMULA_VERSION, TIER_LABEL, type Band, type IntegrityFlag, type Tier, type VerifiedIdentity } from '@vouch/module/review-score';
import type { DroidSessionSummary, StepKey } from '@vouch/module/review-types';
import { config, log } from '../env';
import { label } from '../history';
import { mirrorOf } from '../mirror';
import type { CredentialChecker } from '../orchestrator';
import { call } from '../stdb';
import { auditFindings } from './audit';
import { buildCaseServer, type CaseContext } from './case-tools';
import { extractClaims } from './claims';
import { reviewWithCreao } from './creao-review';
import { ingest, sourceName } from './ingest';
import { integrityLane, transcribeLane, type UploadChecks } from './lanes';
import { caseDir, jobIdFor } from './paths';
import { SYSTEM, analystPrompt, auditorPrompt, caseMarkdown, proofPrompt, type CaseFacts } from './prompts';
import { buildProof, linkExistingClips } from './proof';
import { assembleReport, writeReportFiles } from './report';
import { historyFor, scoreClaim } from './score-claim';
import { DroidBudget, runDroidSession } from './session';
import { CaseState } from './state';

export const MAX_ATTEMPTS = 3;
const MATERIALITY_CENTS = 50_000;
type Sdk = typeof import('@factory/droid-sdk/node');

/**
 * The reviewer takes every live (or live-showcase) claim with a video once its frames
 * are ready. At start-up it also retakes a claim a crash left "investigating" with no
 * finished analysis, up to MAX_ATTEMPTS jobs in total.
 */
export function claimNeedsReview(c: { status: string; kind: string; videoUrl: string }, atStartup: boolean, finishedJob: boolean): boolean {
  if (c.kind !== 'live' && c.kind !== 'showcase') return false;
  if (!c.videoUrl) return false;
  return c.status === 'frames_ready' || (atStartup && c.status === 'investigating' && !finishedJob);
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** What the phone says when neither the Liaison nor the Reviewer wrote a customer line. */
export function customerLine(tier: Tier, now: number, later: number): string {
  switch (tier) {
    case 'T1': return `Thanks for the video. Your refund of ${money(now)} is approved.`;
    case 'T2': return `Thanks for the video. ${money(now)} is refunded now; ${money(later)} follows when the return is scanned.`;
    case 'T3': return `Thanks for the video. Your refund of ${money(later)} is paid when the return is scanned.`;
    case 'T4': return 'Thanks for the video. One more short clip would settle this: the item and the problem in one continuous take.';
    default: return 'Thanks for the video. A member of the team is reviewing your claim.';
  }
}

export interface ReviewRunnerOptions {
  /** The Desk Lead's daily CREAO budget, shared so both together stay under the limit. */
  takeCreaoBudget: () => boolean;
  /** Showcase claims the home demo marked as live (the others are replayed, never reviewed). */
  liveShowcaseClaims: Set<bigint>;
}

class ReviewFailure extends Error {}

export class ReviewRunner {
  readonly budget = new DroidBudget(config.review.maxDroidSessionsPerHour);
  private queue: bigint[] = [];
  private queued = new Set<bigint>();
  private active = false;

  constructor(private conn: DbConnection, private checkCredential: CredentialChecker, private opts: ReviewRunnerOptions) {}

  start() {
    const db = this.conn.db;
    db.claim.onInsert((_c, row) => this.consider(row, false));
    db.claim.onUpdate((_c, _old, row) => this.consider(row, false));
    for (const c of db.claim.iter()) this.consider(c, true);
    log(`video reviewer started (${config.factoryKey ? 'Droid live' : 'no FACTORY_API_KEY: automated checks only'}, ${config.review.maxDroidSessionsPerHour} sessions/hour, proof by ${config.review.droidProof ? 'Droid' : 'worker'})`);
  }

  /** The Desk Lead asks this before taking a claim. */
  handles(c: Claim): boolean {
    if (c.kind === 'showcase' && !this.opts.liveShowcaseClaims.has(c.id)) return false;
    return (c.kind === 'live' || c.kind === 'showcase') && !!c.videoUrl;
  }

  private consider(c: Claim, atStartup: boolean) {
    if (!this.handles(c)) return;
    const finished = [...this.conn.db.analysisJob.iter()].some((j) => j.claimId === c.id && (j.status === 'done' || j.status === 'lanes_only'));
    if (!claimNeedsReview(c, atStartup, finished)) return;
    if (this.queued.has(c.id)) return;
    this.queued.add(c.id);
    this.queue.push(c.id);
    void this.drain();
  }

  /** Sessions run one claim at a time: Droid sessions are heavy, and the phone shows one live case cleanly. */
  private async drain() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const c = this.conn.db.claim.id.find(id);
        if (c) await this.run(c).catch((e) => log(`${label.claim(id)}: review crashed: ${(e as Error).message}`));
        this.queued.delete(id);
      }
    } finally {
      this.active = false;
    }
  }

  private creaoOn() {
    return this.conn.db.control.key.find('creao_enabled')?.value === 'true';
  }

  private uploadFile(claimId: bigint): string | null {
    const dir = resolve(config.mediaDir, String(claimId));
    if (!existsSync(dir)) return null;
    const f = readdirSync(dir).find((n) => /^video\.[a-z0-9]+$/i.test(n));
    return f ? resolve(dir, f) : null;
  }

  private async run(c: Claim) {
    const db = this.conn.db;
    const r = this.conn.reducers;
    const m = mirrorOf(this.conn);
    const caseRef = label.claim(c.id);
    const refund = m.refunds.get(c.refundId);
    const purchase = refund ? m.purchases.get(refund.purchaseId) : undefined;
    const business = refund ? db.business.id.find(refund.businessId) : undefined;
    if (!refund || !purchase || !business) return log(`${caseRef}: refund, purchase or business not in the mirror yet`);
    const attempt = [...db.analysisJob.iter()].filter((j) => j.claimId === c.id).length + 1;
    if (attempt > MAX_ATTEMPTS) return log(`${caseRef}: ${attempt - 1} analysis attempts already; leaving it to a person`);
    const jobId = jobIdFor(c.id, attempt);
    const droidOk = config.review.enabled && !!config.factoryKey;
    try {
      await r.startAnalysis({ claimId: c.id, jobId, mode: droidOk ? 'live' : 'lanes_only' });
    } catch (e) {
      return log(`${caseRef}: startAnalysis refused: ${(e as Error).message}`);
    }
    const dir = caseDir(c.id);
    rmSync(dir, { recursive: true, force: true }); // a fresh folder per attempt; the rows of old jobs stay
    mkdirSync(dir, { recursive: true });
    const state = new CaseState(this.conn, c.id, jobId, dir, 0);
    const sessions: DroidSessionSummary[] = [];
    const limits: string[] = [];
    let lanesOnly = !droidOk;
    let droidSessions = 0;
    let creaoRuns = 0;
    let current: StepKey = 'ingest';
    const t0 = Date.now();
    const step = async (key: StepKey, status: '' | 'pending' | 'running' | 'done' | 'failed' | 'skipped', summary = '', note = '') => {
      current = key;
      await state.step(key, status, summary, note);
    };
    state.log(`=== ${caseRef} job ${jobId} (attempt ${attempt}, ${droidOk ? 'Droid live' : 'lanes only'})`);

    try {
      const source = this.uploadFile(c.id);
      if (!source) throw new ReviewFailure('the uploaded video is not on this worker');
      // 1. ingest
      await step('ingest', 'running', '', 'Receiving your video');
      const ing = await ingest(dir, source);
      state.durationS = ing.meta.durationS;
      for (const a of ing.artifacts) await state.addArtifact(a);
      limits.push(...ing.limits);
      await step('ingest', 'done', `${ing.meta.durationS.toFixed(1)} s, ${ing.meta.width}×${ing.meta.height}, ${ing.meta.fps} fps, ${ing.meta.hasAudio ? 'with audio' : 'no audio track'}; sha256 ${ing.sha256.slice(0, 12)}…`);
      await step('frames', 'done', `${ing.uniform.length} frames at 2 fps, ${ing.scenes.length} scene changes, ${ing.mosaics.length} contact sheets`, 'Looking at the footage');

      // 2. transcript and integrity lanes, side by side
      await step('transcript', 'running', '', ing.meta.hasAudio ? 'Listening to what you said' : 'No audio track to listen to');
      await step('integrity', 'running', '', 'Checking the recording itself');
      const checks = JSON.parse(c.checksJson || '{}') as UploadChecks;
      const openedAt = new Date(Number(c.createdAt.microsSinceUnixEpoch / 1000n));
      const [tr, integ] = await Promise.all([transcribeLane(dir, ing.meta.hasAudio), integrityLane(dir, ing, checks, c.fingerCount, openedAt)]);
      for (const a of tr.artifacts) await state.addArtifact(a);
      for (const a of integ.artifacts) await state.addArtifact(a);
      if (tr.limit && ing.meta.hasAudio) limits.push(tr.limit); // without audio, ingest already recorded the limit
      limits.push(...integ.limits);
      await step('transcript', tr.transcript?.segments.length ? 'done' : 'skipped', tr.transcript?.segments.length ? `${tr.transcript.words.length} words in ${tr.transcript.segments.length} segments` : tr.limit ?? '');
      await step('integrity', 'done', integ.doc.notes.length ? integ.doc.notes.join(' ') : 'Nothing flagged by the automated checks (internally consistent, not proof of authenticity).');

      // 3. spoken claims
      const item = catalogItem(purchase.item);
      const claimsRes = await extractClaims(
        { transcript: tr.transcript, reasonText: refund.reasonText, reasonCode: refund.reasonCode, itemName: item?.name ?? 'the item', durationS: ing.meta.durationS },
        droidOk && this.budget.take(), dir,
      );
      if (claimsRes.source === 'droid') droidSessions++;
      const claims = claimsRes.claims;
      writeFileSync(resolve(dir, 'claims.json'), JSON.stringify({ source: claimsRes.source, note: claimsRes.note, claims }, null, 2));
      await state.addArtifact({ kind: 'transcript', path: 'claims.json', tStart: 0, tEnd: ing.meta.durationS, label: `spoken claims (${claimsRes.source}): ${claims.map((x) => x.id).join(', ')}`, sha256: '' });
      state.log(`claims (${claimsRes.source}): ${claims.map((x) => `${x.id}@${x.tSaid}s ${x.text}`).join(' | ')}`);

      // 4. the case file and the history the scorer and get_customer_summary use
      const policy = JSON.parse(business.policy) as Policy & { autoApproveLimitCents?: number };
      const credential = await this.checkCredential(refund.agentId, refund.id, refund.businessId).catch(() => null);
      const verified: VerifiedIdentity = credential?.verified ? 'verified' : credential?.presented ? 'unverified' : 'unknown';
      if (!config.crs.apiKey) limits.push('Identity verification (CRS) is not configured; a verified Vouch credential from another store counts instead.');
      const hist = historyFor(this.conn, purchase, refund, policy.windowDays, verified);
      const facts: CaseFacts = {
        caseRef,
        business: { name: business.name, id: label.business(business.id), category: business.category },
        order: { item: item?.name ?? `SKU-${purchase.item}`, description: item?.description ?? '', parts: item?.parts ?? [], priceCents: purchase.amount, purchasedDay: purchase.day, deliveredDay: purchase.deliverDay, claimDay: refund.day },
        claim: { reasonCode: refund.reasonCode, reasonText: refund.reasonText, amountCents: refund.amount, fingerCount: c.fingerCount },
        policy: policy as unknown as Record<string, unknown>,
        claims,
        claimsFrom: tr.transcript?.segments.length ? 'transcript' : 'written',
        claimsNote: claimsRes.note,
        transcriptNote: tr.transcript?.segments.length ? `transcript.json (word timestamps) and transcript.txt: ${tr.transcript.words.length} words` : tr.limit ?? 'No transcript.',
        integrity: integ.doc,
        ingest: ing,
      };
      const caseMd = caseMarkdown(facts);
      writeFileSync(resolve(dir, 'CASE.md'), caseMd);
      const customer = { orders: hist.orders, tenureDays: hist.tenureDays, refundsLast365Days: hist.refunds365, refundsLast30Days: hist.refundsThisMonth, categoryBaseline: hist.categoryBaseline, verifiedIdentity: verified };
      const ctx: CaseContext = { state, caseMd, policy: facts.policy, customer, claims, liveNote: (text) => state.step('droid_case', '', '', text), visionAllowed: () => this.budget.take() };
      const sdk: Sdk | null = droidOk ? await import('@factory/droid-sdk/node') : null;

      // 5. Case Analyst
      await step('droid_case', 'running', '', 'Droid is opening your case');
      if (sdk && this.budget.take()) {
        const server = await buildCaseServer(sdk, 'analyst', ctx);
        const unfinished = () => {
          const fs = [...state.findings.values()];
          const missing = claims.filter((x) => !fs.some((f) => f.spokenClaimId === x.id && f.kind !== 'integrity')).map((x) => x.id);
          const gaps = [
            ...(missing.length ? [`claim${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no finding yet`] : []),
            ...(fs.some((f) => f.kind === 'integrity' && f.spokenClaimId.startsWith('challenge:')) ? [] : ['the finger challenge has no integrity finding']),
          ];
          return gaps.length ? gaps.join('; ') : null;
        };
        const spec = { sdk, name: 'Case Analyst', role: 'analyst' as const, state, server, system: SYSTEM.analyst, prompt: analystPrompt(facts), limitMs: config.review.sessionLimitMs, unfinished };
        let s = await runDroidSession(spec);
        droidSessions++;
        // A session that failed, or ended without running or recording anything, gets one more try.
        const nothing = () => state.findings.size === 0 && (s.mode === 'failed' || s.commands.length === 0);
        if (nothing() && this.budget.take()) {
          state.log(`the Case Analyst produced nothing (${s.mode}, ${s.commands.length} commands); retrying once`);
          s = await runDroidSession({ ...spec, name: 'Case Analyst (retry)' });
          droidSessions++;
        }
        sessions.push(s);
        if (s.mode === 'failed' && state.findings.size === 0) {
          lanesOnly = true;
          limits.push(`Droid unavailable (${s.note ?? 'the Case Analyst session failed'}); this report is automated checks only.`);
          await step('droid_case', 'failed', `Droid unavailable: ${s.note ?? 'the session failed'}. Automated checks only.`, 'Droid unavailable; automated checks only');
        } else {
          const fs = [...state.findings.values()];
          const n = (k: string) => fs.filter((f) => f.kind === k).length;
          const missing = claims.filter((x) => !fs.some((f) => f.spokenClaimId === x.id && f.kind !== 'integrity'));
          if (missing.length) limits.push(`No finding for ${missing.map((x) => x.id).join(', ')}; ${missing.length === 1 ? 'that claim counts' : 'those claims count'} as not shown.`);
          if (s.mode === 'failed') limits.push(`The Case Analyst stopped early (${s.note ?? 'session failed'}); its findings so far were kept.`);
          await step('droid_case', 'done', `${fs.length} findings: ${n('supports')} support, ${n('contradicts')} contradict, ${n('neutral')} neutral, ${n('integrity')} integrity; ${s.commands.length} commands, ${s.filesWritten.length} files`, 'Droid has finished looking');
        }
      } else {
        lanesOnly = true;
        const why = !config.review.enabled ? 'REVIEW_ENABLED=0' : !config.factoryKey ? 'FACTORY_API_KEY is not set' : 'the hourly Droid session budget is spent';
        sessions.push({ name: 'Case Analyst', plan: '', commands: [], filesWritten: [], mode: 'skipped', note: why });
        limits.push(`Droid did not run (${why}); this report is automated checks only.`);
        if (!config.factoryKey) log(`UNVERIFIED-LIVE: factory: ${caseRef} reviewed with automated checks only (no FACTORY_API_KEY)`);
        await step('droid_case', 'skipped', `Droid unavailable (${why}). Automated checks only.`, 'Automated checks only');
      }

      // 6. proof clips: Droid when asked, the worker otherwise (same files either way)
      await step('proof', 'running', '', 'Building the proof clips');
      if (sdk && config.review.droidProof && !lanesOnly && state.findings.size && this.budget.take()) {
        const server = await buildCaseServer(sdk, 'proof', { ...ctx, liveNote: (text) => state.step('proof', '', '', text) });
        const unfinished = () => {
          const have = new Set([...state.artifacts.values()].filter((a) => a.kind === 'clip').map((a) => a.path));
          const left = [...state.findings.keys()].filter((id) => !have.has(`proof/clip_${id}.mp4`));
          return left.length ? `finding${left.length === 1 ? '' : 's'} ${left.join(', ')} ${left.length === 1 ? 'has' : 'have'} no registered proof clip` : null;
        };
        const s = await runDroidSession({ sdk, name: 'Proof Builder', role: 'proof', state, server, system: SYSTEM.proof, prompt: proofPrompt(facts), limitMs: Math.min(config.review.sessionLimitMs, 3 * 60_000), unfinished });
        droidSessions++;
        sessions.push(s);
      }
      let clips = 0;
      let reel: string | null = null;
      if (linkExistingClips(state)) {
        clips = state.findings.size;
        reel = [...state.artifacts.values()].some((a) => a.path === 'proof/reel.mp4') ? 'proof/reel.mp4' : null;
      } else {
        const proof = await buildProof(state, ing.meta, sourceName(source));
        clips = proof.clips.length;
        reel = proof.reel;
        limits.push(...proof.limits);
      }
      await step('proof', 'done', `${clips} clip${clips === 1 ? '' : 's'}${reel ? ' and a proof reel' : ''}`);

      // 7. audit: the Droid auditor's verdicts, then the worker's own checks on top (a rejection by either sticks)
      await step('audit', 'running', '', 'Auditing the report');
      if (sdk && !lanesOnly && state.findings.size && this.budget.take()) {
        const server = await buildCaseServer(sdk, 'auditor', { ...ctx, liveNote: (text) => state.step('audit', '', '', text) });
        const unfinished = () => {
          const left = [...state.findings.values()].filter((f) => f.auditStatus === 'pending').map((f) => f.id);
          return left.length ? `finding${left.length === 1 ? '' : 's'} ${left.join(', ')} ${left.length === 1 ? 'has' : 'have'} no audit verdict` : null;
        };
        const s = await runDroidSession({ sdk, name: 'Report Auditor', role: 'auditor', state, server, system: SYSTEM.auditor, prompt: auditorPrompt(facts), limitMs: Math.min(config.review.sessionLimitMs, 2 * 60_000), unfinished });
        droidSessions++;
        sessions.push(s);
        if (s.mode === 'failed') limits.push(`The Droid Report Auditor did not finish (${s.note ?? 'session failed'}); the worker's own audit decided.`);
      }
      let passed = 0;
      let rejected = 0;
      for (const v of auditFindings(dir, [...state.findings.values()], state.artifacts, ing.meta.durationS, claims)) {
        const f = state.findings.get(v.id)!;
        if (f.auditStatus === 'rejected') { rejected++; continue; }
        const note = f.auditStatus === 'passed' && v.status === 'passed' ? `Droid: ${f.auditNote}; worker: ${v.note}` : v.note;
        await state.audit(v.id, v.status, note);
        if (v.status === 'passed') passed++; else rejected++;
      }
      await step('audit', 'done', state.findings.size ? `${passed} passed, ${rejected} rejected` : 'No findings to audit.');

      // 8. score and tier
      await step('score', 'running', '', 'Scoring the evidence');
      const flags: IntegrityFlag[] = [...integ.doc.flags];
      for (const f of state.findings.values()) {
        if (f.kind !== 'integrity' || f.auditStatus !== 'passed') continue;
        const base = { confidence: f.confidence, tStart: f.tStart, tEnd: f.tEnd, artifactIds: f.artifactIds.map(Number), note: f.observation.slice(0, 160) };
        if (f.spokenClaimId === 'challenge:failed') flags.push({ kind: 'challenge_failed', ...base });
        else if (f.spokenClaimId === 'challenge:passed') integ.doc.challenge.checkedBy = 'droid';
        else if (f.spokenClaimId === 'challenge:unclear') flags.push({ kind: 'challenge_unclear', ...base });
        else if (f.spokenClaimId === 'recapture') flags.push({ kind: 'recapture', ...base });
        else if (f.spokenClaimId === 'splice') { const i = flags.findIndex((x) => x.kind === 'splice'); if (i >= 0) flags.splice(i, 1); flags.push({ kind: 'splice', ...base }); }
        else flags.push({ kind: 'other', ...base });
      }
      const band = (m.agents.get(refund.agentId)?.band ?? 'neutral') as Band;
      const autoLimit = policy.autoApproveLimitCents ?? DEFAULT_AUTO_APPROVE_CENTS;
      const score = scoreClaim({ claims, findings: [...state.findings.values()], flags, history: hist, amountCents: refund.amount, autoApproveLimitCents: autoLimit, band, lanesOnly });
      if (score.capped) limits.push('The tier is capped at T3 because Droid did not check the footage.');
      const tier = score.tier;
      await r.writeScore({
        claimId: c.id, jobId, eSupport: score.support.eSupport, coverage: score.support.coverage, integrity: score.integrity, pLegit: score.legit.pLegit,
        anomaly: score.history.anomaly.score, excessRefundRatio: score.history.excessRatio,
        featuresJson: JSON.stringify({ components: score.legit.components, perClaim: score.support.perClaim, history: score.historyInput, anomaly: score.history.anomaly, flags, band, autoApproveLimitCents: autoLimit }),
        formulaVersion: FORMULA_VERSION,
      });
      await step('score', 'done', `P(legit) ${pct(score.legit.pLegit)} (E ${score.support.eSupport.toFixed(2)}, C ${score.support.coverage.toFixed(2)}, I ${score.integrity.toFixed(2)}) → ${tier.tier} ${TIER_LABEL[tier.tier]}`);

      // 9. the report, the CREAO Refund Reviewer, then the final report with its review
      const reportInput = { claimId: c.id, businessId: business.id, state, ing, claims, reasonCode: refund.reasonCode, reasonText: refund.reasonText, integrity: integ.doc, score, sessions, lanesOnly, limits, reel, transcribed: !!tr.transcript?.segments.length };
      const draft = assembleReport(reportInput);
      await step('review', 'running', '', 'The CREAO Refund Reviewer is reading the report');
      const creaoOn = this.creaoOn();
      const outcome = await reviewWithCreao(this.conn, draft, caseRef, {
        creaoOn, takeBudget: () => { const ok = this.opts.takeCreaoBudget(); if (ok) creaoRuns++; return ok; }, onStep: (s) => state.log(`creao: ${s}`),
      });
      const review = outcome.review;
      await state.addArtifact({ kind: 'log', path: 'droid.log', tStart: 0, tEnd: ing.meta.durationS, label: 'every Droid message, tool call and fence decision', sha256: '' });
      const report = assembleReport({ ...reportInput, creaoReview: review });
      const files = writeReportFiles(dir, report);
      await r.writeRecommendation({
        claimId: c.id, jobId, tier: tier.tier, refundNow: tier.refundNowCents, refundOnReturn: tier.refundOnReturnCents, returnRequired: tier.returnRequired,
        reasonsJson: JSON.stringify(tier.reasons), creaoReview: JSON.stringify({ ...review, suggestedTier: outcome.suggestedTier, confidence: outcome.confidence, liaison: outcome.liaison }), creaoRunId: review.runId,
      });
      await r.writeReport({ claimId: c.id, jobId, json: files.json, markdownPath: files.md, proofReelUrl: report.video.proofReelUrl, auditPassed: rejected === 0 });
      await step('review', review.provenance === 'offline' ? 'skipped' : 'done', review.provenance === 'offline' ? review.businessSummary : `${review.agrees ? 'Agrees' : 'Disagrees'} (${review.provenance}): ${review.businessSummary.slice(0, 400)}`);

      // 10. the decision: a proposal a person acts on, or the one automatic pay-out the module allows
      await step('decision', 'running', '', 'Preparing the recommendation');
      const customerMsg = outcome.liaison?.customerMessage || review.customerMessage || customerLine(tier.tier, tier.refundNowCents, tier.refundOnReturnCents);
      if (!creaoOn) {
        // Same rule as the Desk Lead: with the kill switch off there is no proposal, and a person may only ask for more evidence.
        await call('recordEvidence', r.recordEvidence({ claimId: c.id, seat: 'system', runId: '', runUrl: '', json: JSON.stringify({ offline: true, reason: 'creao_enabled is off', report: 'written' }), provenance: 'live' }));
        await call('setClaimStatus', r.setClaimStatus({ claimId: c.id, status: 'offline' }));
        await step('decision', 'skipped', 'Investigator offline (CREAO kill switch): the report is ready; a person may only request more evidence.', 'A person will review your claim.');
      } else {
        const payNow = tier.tier === 'T1' || tier.tier === 'T2';
        const action = payNow || tier.tier === 'T3' ? 'accept' : 'more_evidence';
        const amount = payNow ? tier.refundNowCents : tier.tier === 'T3' ? tier.refundOnReturnCents : 0;
        const method = tier.tier === 'T3' ? 'original_payment_on_return' : tier.tier === 'T2' ? 'split_now_and_on_return' : 'original_payment';
        const reasons = [
          ...tier.reasons,
          review.provenance === 'offline' ? { text: review.businessSummary, cites: 'creao:offline' } : { text: `CREAO Refund Reviewer ${review.agrees ? 'agrees' : 'disagrees'}: ${review.businessSummary.slice(0, 300)}`, cites: `creao:${review.runId}` },
          ...(tier.evidenceRequested ?? []).map((text) => ({ text, cites: 'evidence:requested' })),
        ];
        await r.propose({ refundId: refund.id, action, amount, method, confidence: score.legit.pLegit, reasonsJson: JSON.stringify(reasons), runId: review.runId || `droid-${jobId}`, runUrl: outcome.runUrl });
        let decided = '';
        const limit = Math.min(autoLimit, MATERIALITY_CENTS);
        if (payNow && tier.autoDecidable && review.agrees && !lanesOnly && tier.refundNowCents > 0 && tier.refundNowCents <= limit) {
          try {
            await r.autoDecide({ refundId: refund.id, amount: tier.refundNowCents, note: `Auto-approved: ${tier.tier}, P(legit) ${pct(score.legit.pLegit)}, Reviewer agreed (${review.provenance})` });
            decided = ` Auto-approved ${money(tier.refundNowCents)} (within the ${money(limit)} limit).`;
          } catch (e) {
            limits.push(`The automatic decision was refused: ${(e as Error).message.slice(0, 160)}`);
            state.log(`autoDecide refused: ${(e as Error).message}`);
          }
        }
        await step('decision', 'done', `${tier.tier} ${TIER_LABEL[tier.tier]}: proposed ${action}${amount ? ` ${money(amount)}` : ''}.${decided}${decided ? '' : ' A person decides.'}`, customerMsg);
      }
      const secs = Math.round((Date.now() - t0) / 1000);
      await r.finishAnalysis({ jobId, status: lanesOnly ? 'lanes_only' : 'done', costNote: `${droidSessions} Droid session(s), ${creaoRuns} CREAO run(s), ${secs} s`, droidSessions: Math.min(255, droidSessions) });
      state.log(`=== done: ${tier.tier} in ${secs} s`);
      log(`${caseRef}: ${tier.tier} ${TIER_LABEL[tier.tier]} in ${secs} s (${droidSessions} Droid sessions${lanesOnly ? ', automated checks only' : ''}, reviewer ${review.provenance})`);
    } catch (e) {
      // A hard failure never strands the claim: the job is marked failed and the business gets a more-evidence proposal (never a decline).
      const msg = (e as Error).message.slice(0, 300);
      log(`${caseRef}: review failed at ${current}: ${msg}`);
      state.log(`!!! failed at ${current}: ${msg}`);
      await call('setStep', r.setStep({ jobId, key: current, status: 'failed', summary: msg, liveNote: 'Something went wrong on our side; a person will look at your claim.' }));
      await call('finishAnalysis', r.finishAnalysis({ jobId, status: 'failed', costNote: `failed at ${current}: ${msg}`.slice(0, 600), droidSessions: Math.min(255, droidSessions) }));
      await call('propose', r.propose({
        refundId: refund.id, action: 'more_evidence', amount: 0, method: 'none', confidence: 0,
        reasonsJson: JSON.stringify([{ text: `The video could not be analysed (${current}: ${msg}). A new recording, or a person, would settle it.`, cites: 'review:failed' }]), runId: `droid-${jobId}`, runUrl: '',
      }));
    }
  }
}
