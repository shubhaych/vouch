// The worker process: privileged SpacetimeDB identities plus the HTTP routes
// the phone and CREAO need. Everything slow, secret or heavy happens here.
import { existsSync } from 'node:fs';
import { sendMedia } from './media-response';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createServer as createNetServer } from 'node:net';
import { config, log } from './env';
import { call, connect, type Conn } from './stdb';
import { handleWebhook, resolveAgents } from './creao';
import { Orchestrator } from './orchestrator';
import { DetectorRunner } from './detectors';
import { ScoreReviewer } from './review/score-review';
import { Poster } from './poster';
import { Credentials } from './credentials';
import { MAX_UPLOAD_BYTES, UploadError, checkSignature, processUpload } from './video';
import { LabRunner } from './lab';
import { Showcase } from './showcase';
import { mirrorOf } from './mirror';
import { ReviewRunner } from './review/runner';
import { generateBook } from './finance/book';
import { closeBookPeriod } from './finance/close';
import { checkFinanceCreaoAgents, financeCreaoEnvStatus, resumeFinanceAgentRun, runFinanceAgent, type FinanceSeat } from './finance/creao';
import type { DbConnection } from '../module_bindings';
import { POLICY } from '../../module/src/finance/policy';
import { allowedRungs as allowedFinanceRungs, zeroSignals, type Signals } from '../../module/src/finance/exposure';
import { isPersonaId, sandboxReady, screen, type PersonaId } from './crs';
import { PulseRunner } from './pulse';
import { brightdataReady, scrapesUsedToday } from './brightdata';

const WORKER_QUERIES = [
  'SELECT * FROM sim_run', 'SELECT * FROM metrics', 'SELECT * FROM control', 'SELECT * FROM agent', 'SELECT * FROM business',
  'SELECT * FROM purchase', 'SELECT * FROM refund', 'SELECT * FROM claim', 'SELECT * FROM evidence', 'SELECT * FROM agent_run',
  'SELECT * FROM decision', 'SELECT * FROM fraud_pattern', 'SELECT * FROM pattern_event', 'SELECT * FROM credential',
  'SELECT * FROM verification', 'SELECT * FROM lab_job', 'SELECT * FROM partner_order',
  'SELECT * FROM analysis_job', 'SELECT * FROM analysis_step', 'SELECT * FROM artifact', 'SELECT * FROM finding', 'SELECT * FROM report',
  'SELECT * FROM claim_score', 'SELECT * FROM recommendation', 'SELECT * FROM score_review',
];
const FINANCE_WORKER_QUERIES = [
  'SELECT * FROM finance_agent_run', 'SELECT * FROM finance_sim_state', 'SELECT * FROM finance_company_state',
  'SELECT * FROM finance_stats_hourly', 'SELECT * FROM finance_exposure_log', 'SELECT * FROM finance_exposure_proposal',
];

const CASE_TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  json: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', log: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8',
};

const activeFinanceCases = new Set<string>();

/** Check the public port before connecting identities or starting any workers. */
function assertWorkerPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Worker port ${port} is already in use. Stop the existing worker before starting another against the same SpacetimeDB database.`));
      } else reject(error);
    });
    probe.listen(port, '0.0.0.0', () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}

async function persistFinanceAgentRun(conn: DbConnection, seat: FinanceSeat, caseRef: string, input: unknown, companyId = 1) {
  const inputJson = JSON.stringify(input);
  const save = (runId: string, status: 'running' | 'done' | 'rejected' | 'failed', mode: 'live' | 'mock' | 'replay', outputJson: string, valid: boolean, rejectReason: string, runUrl: string, agentId: string, ms: number) => conn.reducers.financeRecordAgentRun({
    runId,
    seat,
    companyId,
    caseRef,
    status, mode, inputJson, outputJson, valid, rejectReason, runUrl, agentId, ms: Math.min(ms, 2_147_483_647),
  });
  let startedRun: { runId: string; runUrl: string; agentId: string } | undefined;
  const result = await runFinanceAgent(seat, input, async (run) => {
    startedRun = run;
    await save(run.runId, 'running', 'live', '', false, '', run.runUrl, run.agentId, 0);
  });
  await save(result.runId || startedRun?.runId || `finance:${caseRef}:${seat}`, result.output ? 'done' : result.status === 'rejected' ? 'rejected' : 'failed', result.mode,
    result.output ? JSON.stringify(result.output) : '', !!result.output && !result.error, result.error ?? '', result.runUrl ?? startedRun?.runUrl ?? '', result.agentId ?? startedRun?.agentId ?? '', result.durationMs);
  return result;
}

async function runCloseAgents(conn: DbConnection, period: string, close: Awaited<ReturnType<typeof closeBookPeriod>>) {
  const caseRef = `close:${period}`;
  if (activeFinanceCases.has(caseRef) || [...conn.db.financeAgentRun.iter()].some((row) => row.caseRef === caseRef && ['running', 'done'].includes(row.status))) return;
  activeFinanceCases.add(caseRef);
  const unexplained = close.bridge
    .filter((line) => line.cause !== 'bridge close (residual)')
    .reduce((sum, line) => sum + Math.abs(line.cents), 0);
  const closeInput = {
    close_summary: {
      period,
      totals: { ledger: close.summary.ledgerCents, processor: close.summary.processorCents, bank: close.summary.bankCents },
      bridge_lines: close.bridge.map((line) => ({ cause: line.cause, cents: line.cents, order_count: line.orders, source_that_won: line.winner })),
      open_obligations: [],
      reserve_change_cents: 0,
      driver_actions: close.drivers.actions,
      unexplained_cents: unexplained,
      funnel: {
        closed_by_playbook: close.closedByPlaybook,
        to_investigator: close.toInvestigator,
        to_controller: close.toController,
        verifier_rejected: close.verifierRejected,
      },
      controller_decisions: [],
    },
    code_may_lock: false,
  };
  const advisorInput = {
    drivers: {
      bridge_lines: close.bridge,
      cohorts: [],
      reserve_change_cents: 0,
      open_obligations: [],
      forecast_cents: close.summary.processorCents,
      actual_cents: close.summary.bankCents,
      action_candidates: close.drivers.actions,
      by_cause: close.drivers.by_cause,
    },
    scenario_options: ['reconciliation_variance', 'settlement_timing', 'UNKNOWN'],
  };
  await Promise.all([
    persistFinanceAgentRun(conn, 'close_controller', caseRef, closeInput),
    persistFinanceAgentRun(conn, 'advisor', caseRef, advisorInput),
  ]).finally(() => activeFinanceCases.delete(caseRef));
}

function buildClaimImpact(conn: DbConnection, claimId: bigint) {
  const db = conn.db;
  const claim = db.claim.id.find(claimId);
  if (!claim) throw new Error('claim was not found');
  const refund = db.refund.id.find(claim.refundId);
  if (!refund) throw new Error('refund was not found for this claim');
  const decision = [...db.decision.iter()].filter((row) => row.refundId === refund.id).sort((a, b) => Number(b.id - a.id))[0];
  if (!decision || !['decided', 'posted'].includes(decision.status) || !['accept', 'decline'].includes(decision.finalAction)) throw new Error('the business decision is not final yet');
  const agent = db.agent.id.find(refund.agentId);
  const recommendation = db.recommendation.claimId.find(claim.id);
  const score = db.claimScore.claimId.find(claim.id);
  const reportRow = [...db.report.iter()].filter((row) => row.claimId === claim.id).sort((a, b) => Number(b.id - a.id))[0];
  let report: Record<string, any> = {};
  try { report = reportRow ? JSON.parse(reportRow.json) as Record<string, any> : {}; } catch { /* incomplete legacy report */ }
  if (!recommendation || !score || !reportRow || !reportRow.auditPassed) throw new Error('the final recommendation, score or audited report is missing or unaudited');
  const evidenceIds = Array.isArray(report.artifacts) ? report.artifacts.map((a: { id: string | number }) => String(a.id)) : [];
  const accepted = decision.finalAction === 'accept';
  const leg1Authorized = accepted ? recommendation.refundNow : 0;
  const leg2Authorized = accepted ? recommendation.refundOnReturn : 0;
  const leg1Paid = Math.min(decision.finalAmount, leg1Authorized);
  const leg2Paid = Math.min(Math.max(0, decision.finalAmount - leg1Paid), leg2Authorized);
  // T2 keeps leg 2 open after the first-leg payment. T3 can be return-first,
  // so the recorded final payout may already have released leg 2.
  const openLeg2 = Math.max(0, leg2Authorized - leg2Paid);
  const completionRate = POLICY.reserve.defaultRateBp / 10_000;
  const windowStart = Math.max(0, refund.day - 30);
  const customerPurchases = mirrorOf(conn).purchasesOf(refund.agentId).filter((p) => p.day >= windowStart && p.day <= refund.day).length;
  const customerRefunds = mirrorOf(conn).refundsOf(refund.agentId).filter((r) => r.day >= windowStart && r.day <= refund.day).length;
  const impact = {
    refund: {
      decision_id: String(decision.id), amount_cents: leg1Authorized + leg2Authorized, tier: recommendation.tier,
      legs: [
        { leg: 1, amount_cents: leg1Authorized, condition: leg1Paid ? 'paid_now' : 'not_paid' },
        { leg: 2, amount_cents: leg2Authorized, condition: openLeg2 ? 'pending_verified_return' : leg2Paid ? 'return_verified_paid' : 'not_authorized' },
      ],
    },
    vouch: { score: agent?.score ?? 0, band: agent?.band ?? 'unknown', formula_version: score.formulaVersion, evidence_ids: evidenceIds },
    deltas: { revenue_cents: -leg1Paid, cash_cents: -decision.finalAmount, receivable_cents: openLeg2, reserve_cents: Math.round(openLeg2 * completionRate) },
    baseline: { refund_rate_30d: customerPurchases ? customerRefunds / customerPurchases : 0, materiality_cents: POLICY.materialityCents, tier_completion_rate: completionRate },
    required_flags: openLeg2 > 0 ? ['conditional_leg_open'] : [],
  };
  return { impact };
}

async function runClaimImpactAgents(conn: DbConnection, claimId: bigint, impact: ReturnType<typeof buildClaimImpact>) {
  const caseRef = `claim:${claimId}`;
  if (activeFinanceCases.has(caseRef)) return;
  activeFinanceCases.add(caseRef);
  try {
    const analystInput = { impact: impact.impact };
    const analyst = await persistFinanceAgentRun(conn, 'impact_analyst', caseRef, analystInput);
    const reviewerInput = { impact: impact.impact, analyst: analyst.output ?? { error: analyst.error ?? 'analyst unavailable' } };
    await persistFinanceAgentRun(conn, 'impact_reviewer', caseRef, reviewerInput);
  } finally {
    activeFinanceCases.delete(caseRef);
  }
}

async function resumeFinanceAgentRuns(conn: DbConnection) {
  if (process.env.FINANCE_CREAO_MODE !== 'live' || !financeCreaoEnvStatus().some((row) => row.configured)) return;
  const pending = [...conn.db.financeAgentRun.iter()].filter((row) => row.status === 'running' && row.mode === 'live');
  const queue = [...pending];
  const resumeOne = async () => {
    while (queue.length) {
      const row = queue.shift()!;
      if (!['impact_analyst', 'impact_reviewer', 'close_controller', 'advisor', 'guardian'].includes(row.seat)) continue;
      let input: unknown;
      try { input = JSON.parse(row.inputJson) as unknown; }
      catch { continue; }
      const result = await resumeFinanceAgentRun(row.seat as FinanceSeat, input, { runId: row.runId, runUrl: row.runUrl, agentId: row.agentId });
      await conn.reducers.financeRecordAgentRun({
        runId: row.runId, seat: row.seat, companyId: row.companyId, caseRef: row.caseRef,
        status: result.output ? 'done' : 'failed', mode: 'live', inputJson: row.inputJson,
        outputJson: result.output ? JSON.stringify(result.output) : '', valid: !!result.output && !result.error,
        rejectReason: result.error ?? '', runUrl: result.runUrl ?? row.runUrl, agentId: result.agentId ?? row.agentId,
        ms: Math.min(row.ms + result.durationMs, 2_147_483_647),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, resumeOne));
}

function startFinanceGuardianListener(conn: DbConnection) {
  const pending = new Map<number, number>();
  const active = new Set<number>();
  const maxActive = 2;
  const pump = () => {
    if (active.size >= maxActive) return;
    const next = [...pending.entries()].find(([companyId]) => !active.has(companyId));
    if (!next) return;
    const [companyId, simHour] = next;
    pending.delete(companyId);
    active.add(companyId);
    void runGuardianForCompany(conn, companyId, simHour)
      .catch((e) => log(`Finance Guardian company ${companyId} failed:`, (e as Error).message))
      .finally(() => { active.delete(companyId); pump(); });
    pump();
  };
  const enqueue = (companyId: number, simHour: number) => { pending.set(companyId, simHour); pump(); };
  const queueAtHour = (simHour: number) => {
    if (simHour <= 0 || simHour % POLICY.exposure.checkEveryHours !== 0) return;
    for (const state of conn.db.financeCompanyState.iter()) enqueue(state.companyId, simHour);
  };
  conn.db.financeStatsHourly.onInsert((_ctx, row) => {
    if (row.simHour > 0 && row.simHour % POLICY.exposure.checkEveryHours === 0) enqueue(row.companyId, row.simHour);
  });
  const currentHour = conn.db.financeSimState.id.find(1)?.simHour ?? 0;
  queueAtHour(currentHour);
}

async function runGuardianForCompany(conn: DbConnection, companyId: number, eventHour: number) {
  const state = conn.db.financeCompanyState.companyId.find(companyId);
  if (!state) return;
  let saved: { now?: Signals; prev?: Signals | null; checks?: { hour: number; signals: Signals; evidence_ids: string[] }[] };
  try { saved = JSON.parse(state.signalsJson || '{}') as typeof saved; }
  catch { return; }
  const checks = saved.checks ?? [];
  const currentCheck = checks.at(-1);
  if (!currentCheck) return;
  const proposal = conn.db.financeExposureProposal.companyId.find(companyId);
  if (proposal && proposal.simHour >= currentCheck.hour) return;
  const currentRung = state.rung as 'normal' | 'watch' | 'hedge' | 'pause';
  const allowed = allowedFinanceRungs(currentRung, currentCheck.signals, saved.prev ?? undefined);
  if (allowed.length < 2) return;
  const expiryByRung = Object.fromEntries(allowed.map((rung) => [rung, rung === 'hedge' || rung === 'pause' ? POLICY.exposure.expiryHours[rung] : POLICY.exposure.expiryHours.watch]));
  const evidenceIds = [...new Set(checks.slice(-6).flatMap((check) => check.evidence_ids))];
  const signals = (Object.keys(POLICY.exposure.signals) as (keyof Signals)[]).map((key) => ({
    key, value: currentCheck.signals[key], watch_line: POLICY.exposure.signals[key].watch, hedge_line: POLICY.exposure.signals[key].hedge,
    evidence_ids: currentCheck.evidence_ids,
  }));
  const exposure = {
    company_id: companyId,
    current_rung: currentRung,
    signals,
    last_six_checks: checks.slice(-6),
    allowed_rungs: allowed,
    allowed_expiries_hours: [...new Set(Object.values(expiryByRung))],
    expiry_by_rung: expiryByRung,
    evidence_ids: evidenceIds,
  };
  const caseRef = `exposure:${companyId}:${currentCheck.hour}`;
  const result = await persistFinanceAgentRun(conn, 'guardian', caseRef, { exposure }, companyId);
  if (!result.output) return;
  const output = result.output as { proposed_rung: string; reason: string; customer_notice_draft: string; expires_in_hours: number };
  await conn.reducers.financeRecordGuardian({
    companyId, proposedRung: output.proposed_rung, reason: output.reason, customerNotice: output.customer_notice_draft,
    expiresInHours: output.expires_in_hours, runId: result.runId || `finance:${caseRef}:guardian`, mode: result.mode,
  });
}

async function main() {
  await assertWorkerPortAvailable(config.port);
  log(`connecting to ${config.stdbUri}/${config.stdbDb}`);
  const { conn } = await connect('worker', config.financeDeskEnabled ? [...WORKER_QUERIES, ...FINANCE_WORKER_QUERIES] : WORKER_QUERIES, 120_000);
  mirrorOf(conn); // index purchase, refund and agent before anything reads them
  const poster = await connect('poster', ['SELECT * FROM decision']);
  await conn.reducers.setSeatCodes({ businessCode: config.demoBusinessCode, controllerCode: config.demoControllerCode }).catch((e: Error) => log('seat codes:', e.message));
  let financeReconciler: typeof conn | undefined;

  const run = conn.db.simRun.id.find(1);
  if (!run?.seeded) {
    log(`seeding world: seed ${config.seed}, ${config.population} agents`);
    await conn.reducers.seedWorld({ seed: config.seed, population: config.population, force: false });
  } else {
    log(`world: day ${run.day}, ${run.population} agents, running=${run.running}`);
  }

  // The finance portfolio is an optional, isolated module add-on. Seed its
  // catalog and rows only when enabled; it never changes the refund path.
  if (config.financeDeskEnabled) {
    void checkFinanceCreaoAgents().then((rows) => {
      for (const row of rows) log(`Finance CREAO ${row.name}: ${row.appIdEnv}=${row.appIdConfigured ? 'set' : 'missing'}; ${row.apiKeyEnv}=${row.apiKeyConfigured ? 'set' : 'missing'}; live run=${row.configured ? 'not verified' : 'not configured'}`);
    }).catch((e) => log('Finance CREAO startup check failed:', (e as Error).message));
    try {
      const [, reconciler] = await Promise.all([connect('accountant', []), connect('reconciler', []), connect('analyst', [])]);
      financeReconciler = reconciler.conn;
      if (!existsSync(config.financeBookPath)) {
        const book = await generateBook(config.financeBookPath, config.financeBookSeed);
        log(`Finance Desk book generated: ${book.counts.orders} orders in ${book.ms} ms`);
      }
      await conn.reducers.financeSeedPortfolio({ seed: config.seed, force: false })
        .then(() => log('Finance Desk portfolio is seeded (paused until a controller starts it)'))
        .catch((e: Error) => log(`Finance Desk unavailable; main refund path continues: ${e.message}`));
    } catch (e) {
      financeReconciler = undefined;
      log(`Finance Desk setup failed; main refund path continues: ${(e as Error).message}`);
    }
    void resumeFinanceAgentRuns(conn).catch((e) => log('Finance CREAO run recovery failed:', (e as Error).message));
    startFinanceGuardianListener(conn);
  }

  if (config.creao.mode === 'live') {
    try { await resolveAgents(); } catch (e) { log(`CREAO live mode is not ready: ${(e as Error).message}. Claims will wait as "investigator offline" until fixed.`); }
  }

  const credentials = new Credentials(conn);
  await credentials.start();
  const orchestrator = new Orchestrator(conn, (agentId, refundId, verifier) => credentials.check(agentId, refundId, verifier));
  const scoreReviewer = new ScoreReviewer(conn);
  // The video reviewer owns every claim with a video; the Desk Lead keeps simulated and video-less claims. REVIEW_ENABLED=0 restores the old path.
  if (config.review.enabled) {
    const reviewer = new ReviewRunner(conn, (agentId, refundId, verifier) => credentials.check(agentId, refundId, verifier), {
      takeCreaoBudget: () => orchestrator.takeBudget(), liveShowcaseClaims: orchestrator.liveShowcaseClaims,
      onVerdict: (refundId) => scoreReviewer.afterVerdict(refundId),
    });
    orchestrator.handledByReviewer = (c) => reviewer.handles(c);
    reviewer.start();
  }
  scoreReviewer.start();
  keepSimRunning(conn);
  orchestrator.start();
  new DetectorRunner(conn).start();
  const pulse = new PulseRunner(conn, { creaoOn: () => conn.db.control.key.find('creao_enabled')?.value === 'true', takeBudget: () => orchestrator.takeBudget() });
  pulse.start();
  orchestrator.pulseFor = (sku) => pulse.latest?.items.find((i) => i.sku === sku) ?? null;
  new Poster(poster.conn).start();
  const lab = new LabRunner(conn);
  lab.start();
  const showcase = new Showcase(conn, credentials);
  showcase.orchestrator = orchestrator;
  showcase.start();

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.get('/health', async () => ({ ok: true, mode: config.creao.mode, day: conn.db.simRun.id.find(1)?.day ?? null }));

  if (config.financeDeskEnabled) {
    app.get('/finance/creao/status', async (_req, reply) => {
      try { return (await checkFinanceCreaoAgents()).map(({ seat, name, configured, found, nameMatches, checked }) => ({ seat, name, configured, found, nameMatches, checked })); }
      catch (e) { return reply.code(503).send({ error: `CREAO agent check failed: ${(e as Error).message}` }); }
    });
    app.post<{ Body: { code?: string; running?: boolean; hoursPerTick?: number } }>('/finance/simulation', async (req, reply) => {
      if (req.body?.code !== config.demoControllerCode) return reply.code(403).send({ error: 'controller code required' });
      const running = req.body.running;
      const hoursPerTick = req.body.hoursPerTick ?? 1;
      if (typeof running !== 'boolean' || ![1, 5, 24].includes(hoursPerTick)) return reply.code(400).send({ error: 'running must be boolean and hoursPerTick must be 1, 5, or 24' });
      try {
        await conn.reducers.financeSetRunning({ running, hoursPerTick });
        return { ok: true, running, hoursPerTick };
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    });
    app.post<{ Body: { code?: string; companyId?: number; kind?: string; hours?: number } }>('/finance/scenario', async (req, reply) => {
      if (req.body?.code !== config.demoControllerCode) return reply.code(403).send({ error: 'controller code required' });
      const { companyId, kind, hours = 24 } = req.body;
      if (!Number.isInteger(companyId) || companyId! < 1 || companyId! > 100 || !['ring', 'sale_day', 'defect_batch'].includes(kind ?? '') || !Number.isInteger(hours) || hours! < 6 || hours! > 72) {
        return reply.code(400).send({ error: 'choose a company from 1–100, a supported scenario, and a duration from 6–72 hours' });
      }
      try {
        await conn.reducers.financeInjectEvent({ companyId: companyId!, kind: kind!, hours: hours! });
        return { ok: true, companyId, kind, hours };
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    });
    app.post<{ Params: { claimId: string } }>('/finance/claim/:claimId/analyze', async (req, reply) => {
      if (!/^\d+$/.test(req.params.claimId)) return reply.code(400).send({ error: 'claim id must be numeric' });
      const claimId = BigInt(req.params.claimId);
      const caseRef = `claim:${claimId}`;
      if ([...conn.db.financeAgentRun.iter()].some((row) => row.caseRef === caseRef && ['running', 'done'].includes(row.status))) return { accepted: true, caseRef, status: 'already_recorded' };
      try {
        const input = buildClaimImpact(conn, claimId);
        void runClaimImpactAgents(conn, claimId, input).catch((e) => log(`Finance CREAO ${caseRef} failed:`, (e as Error).message));
        return { accepted: true, caseRef, status: 'queued' };
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    });
    app.post<{ Params: { period: string }; Body: { code?: string } }>('/finance/close/:period', async (req, reply) => {
      if (req.body?.code !== config.demoControllerCode) return reply.code(403).send({ error: 'controller code required' });
      if (!financeReconciler) return reply.code(503).send({ error: 'finance reconciler is offline' });
      try {
        const close = await closeBookPeriod(financeReconciler, config.financeBookPath, req.params.period);
        // CREAO runs are deliberately detached from the close response. The ledger
        // snapshot and customer path never wait on agents that can take minutes.
        void runCloseAgents(conn, req.params.period, close).catch((e) => log('Finance CREAO close follow-up failed:', (e as Error).message));
        return close;
      } catch (e) {
        log('Finance Desk close failed', (e as Error).message);
        return reply.code(500).send({ error: (e as Error).message });
      }
    });
  }

  // The phone uploads here, never to SpacetimeDB. The nonce ties the upload to the claim's challenge.
  app.post<{ Params: { claimId: string }; Querystring: { nonce?: string } }>('/upload/:claimId', async (req, reply) => {
    try {
      const file = await req.file();
      if (!file) throw new UploadError(400, 'No video in the upload.');
      const data = await file.toBuffer();
      const ext = (file.filename.split('.').pop() || file.mimetype.split('/').pop() || 'mp4').toLowerCase();
      const res = await processUpload(conn, BigInt(req.params.claimId), req.query.nonce ?? '', data, ext);
      return { ok: true, frames: res.frames, checks: res.checks };
    } catch (e) {
      const status = e instanceof UploadError ? e.status : (e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 500;
      if (status === 500) log('upload failed', (e as Error).message);
      return reply.code(status).send({ ok: false, error: status === 413 ? 'That video is too large. Please record again at a lower quality.' : (e as Error).message, ...(e instanceof UploadError && e.code ? { code: e.code } : {}) });
    }
  });

  // Signed, expiring frame and video URLs (CREAO fetches them through the tunnel).
  app.get<{ Params: { claimId: string; file: string }; Querystring: { exp?: string; sig?: string } }>('/media/:claimId/:file', async (req, reply) => {
    const path = `/media/${req.params.claimId}/${req.params.file}`;
    if (!/^\d+$/.test(req.params.claimId) || !/^[\w.]+$/.test(req.params.file) || !checkSignature(path, req.query.exp ?? '', req.query.sig ?? '')) {
      return reply.code(403).send({ error: 'link expired or not signed' });
    }
    const file = resolve(config.mediaDir, req.params.claimId, req.params.file);
    if (!existsSync(file)) return reply.code(404).send({ error: 'not found' });
    const type = file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.webm') ? 'video/webm' : file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    return sendMedia(reply, file, type, req.headers.range);
  });

  // Case files (frames, mosaics, proof clips, probe charts, droid.log, report.md) at signed, expiring URLs; nested paths, never outside the case.
  app.get<{ Params: { claimId: string; '*': string }; Querystring: { exp?: string; sig?: string } }>('/cases/:claimId/*', async (req, reply) => {
    const rel = req.params['*'] ?? '';
    const path = `/cases/${req.params.claimId}/${rel}`;
    if (!/^\d+$/.test(req.params.claimId) || !/^[\w./-]+$/.test(rel) || rel.split('/').some((p) => p === '..' || p === '') || !checkSignature(path, req.query.exp ?? '', req.query.sig ?? '')) {
      return reply.code(403).send({ error: 'link expired or not signed' });
    }
    const root = resolve(config.casesDir, req.params.claimId);
    const file = resolve(root, rel);
    if (!file.startsWith(root + '/') || !existsSync(file)) return reply.code(404).send({ error: 'not found' });
    const type = CASE_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
    return sendMedia(reply, file, type, req.headers.range);
  });

  // CREAO webhooks (laptop only; at least once, answered fast, deduped).
  app.post<{ Body: Record<string, unknown> }>('/creao/webhook', async (req, reply) => {
    const status = handleWebhook(req.headers['x-creao-delivery-id'] as string | undefined, req.body as never);
    return reply.code(status).send({ ok: status === 200 });
  });

  // The home page's "Watch it live" and /system's benchmark need the controller code: they spend credits or CPU.
  app.post<{ Body: { code?: string } }>('/showcase/run', async (req, reply) => {
    if (req.body?.code !== config.demoControllerCode) return reply.code(403).send({ error: 'controller code required' });
    const started = showcase.runNow({ live: true });
    return { ok: started, message: started ? 'Showcase run started' : 'A showcase run is already in progress' };
  });
  // CRS identity screening of one sandbox persona (docs/CRS.md). Callers send only the persona id;
  // credentials and persona details stay here, and only the normalised result goes back.
  app.get('/identity/status', async () => ({ mode: config.crs.mode, notReady: config.crs.mode === 'sandbox' ? sandboxReady() : null }));
  app.post<{ Body: { personaId?: string } }>('/identity/check', async (req, reply) => {
    const id = req.body?.personaId;
    if (!isPersonaId(id)) return reply.code(400).send({ error: 'personaId must be one of the CRS sandbox personas' });
    const notReady = config.crs.mode === 'sandbox' ? sandboxReady() : null;
    if (notReady) return reply.code(503).send({ error: `CRS sandbox is not configured: ${notReady}` });
    try { return await screen(id); } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
  // Scale view: route N returns whose shoppers map onto the sandbox personas in a chosen mix.
  // Each persona is checked once (results are cached), so 1,000 returns cost at most 4 CRS calls.
  app.post<{ Body: { mix?: Record<string, number> } }>('/identity/batch', async (req, reply) => {
    const mix = Object.entries(req.body?.mix ?? {}).filter(([id, n]) => isPersonaId(id) && Number.isInteger(n) && n > 0) as [PersonaId, number][];
    const total = mix.reduce((s, [, n]) => s + n, 0);
    if (total === 0 || total > 100_000) return reply.code(400).send({ error: 'mix must name sandbox personas with 1 to 100,000 returns in total' });
    const notReady = config.crs.mode === 'sandbox' ? sandboxReady() : null;
    if (notReady) return reply.code(503).send({ error: `CRS sandbox is not configured: ${notReady}` });
    try {
      const rows = await Promise.all(mix.map(async ([id, n]) => ({ personaId: id, returns: n, result: await screen(id) })));
      const routes: Record<string, number> = { refund_investigator: 0, merchant_identity_review: 0, additional_verification: 0 };
      for (const r of rows) routes[r.result.route]! += r.returns;
      return { total, crsCalls: rows.length, routes, rows };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
  // Bright Data and the Returns Monitor: status for /system, and a manual monitor run for the demo (spends a CREAO run).
  app.get('/scrape/status', async () => ({ mode: config.brightdata.mode, notReady: brightdataReady(), usedToday: scrapesUsedToday(), dailyLimit: config.brightdata.dailyLimit, pulse: pulse.latest }));
  app.post<{ Body: { code?: string } }>('/monitor/run', async (req, reply) => {
    if (req.body?.code !== config.demoControllerCode && req.body?.code !== config.demoBusinessCode) return reply.code(403).send({ error: 'seat code required' });
    const started = await pulse.runMonitor('manual');
    return { ok: started, message: started ? 'Returns Monitor note written' : 'The Returns Monitor could not run: no pulse yet, the kill switch is off, the seat is missing, the budget is spent, or a run is in progress' };
  });
  app.post('/bench', async () => ({ message: 'Run `npx tsx scripts/bench.ts` on the worker machine: it publishes throwaway databases and writes results to bench_result.' }));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log(`worker listening on :${config.port} (public URL ${config.publicUrl})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// The judge page should never show a frozen world: if the run reached its last day, extend it
// at a slow, watchable pace (about 20 s a simulated day). SIM_KEEP_RUNNING=0 leaves it paused.
function keepSimRunning(conn: Conn) {
  if (process.env.SIM_KEEP_RUNNING === '0') return;
  const run = conn.db.simRun.id.find(1);
  if (!run) return;
  // Called on every start, not only when paused: setSim also adds merchants the world lacks.
  const maxDay = Math.max(run.maxDay, run.day + 3650);
  void call('setSim', conn.reducers.setSim({ running: true, agentsPerTick: 250, tickMicros: 500_000n, maxDay }))
    .then(() => log(`simulation resumed at day ${run.day}: 250 agents per 0.5 s tick`));
}
