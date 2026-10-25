// After a person (or the bounded auto-approve) decides a real claim, the CREAO
// Score Reviewer judges what it does to the shopper's Vouch score: gain, loss or
// unchanged, with one line of why. Its answer is checked against its own brief
// (evaluateScoreVerdict) and the module applies it inside fixed bounds, once per
// refund (applyScoreReview). Each run is an agent_run row on the claim, so the
// phone and the business page see the Reviewer at work. Without the live agent
// the plain rule in score-rule.ts answers, labelled "rule", so every decision
// still carries a reason.
import type { DbConnection } from '../../module_bindings/index';
import type { Refund } from '../../module_bindings/types';
import type { Report } from '@vouch/module/review-types';
import { log } from '../env';
import { parseVerdict, seatAvailable, seatPath, startRun, waitForRun } from '../creao';
import { call } from '../stdb';
import { evaluateScoreVerdict, scoreRule, type ScoreInput, type ScoreOutput } from './score-rule';

const parse = <T>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };

export class ScoreReviewer {
  private busy = new Set<bigint>();
  constructor(private conn: DbConnection) {}

  start() {
    const db = this.conn.db;
    db.refund.onUpdate((_c, _o, r) => this.consider(r));
    for (const r of db.refund.iter()) this.consider(r);
    if (seatAvailable('score_reviewer')) log(`score reviewer started (CREAO seat score_reviewer: ${seatPath('score_reviewer')})`);
    else log('score reviewer started WITHOUT the CREAO Score Reviewer: set CREAO_SCORE_REVIEWER_APP_ID and CREAO_SCORE_REVIEWER_KEY (agents/creao/score-reviewer.md); until then score changes are labelled "rule"');
  }

  private consider(r: Refund) {
    if (r.source === 'sim' || (r.status !== 'accepted' && r.status !== 'declined')) return;
    if (this.busy.has(r.id) || this.conn.db.scoreReview.refundId.find(r.id)) return;
    this.busy.add(r.id);
    void this.run(r).catch((e) => log(`score review R-${r.id} failed: ${(e as Error).message}`)).finally(() => this.busy.delete(r.id));
  }

  private input(r: Refund): { input: ScoreInput; caseRef: string } {
    const db = this.conn.db;
    const claim = [...db.claim.iter()].find((c) => c.refundId === r.id);
    const row = claim ? [...db.report.iter()].filter((x) => x.claimId === claim.id).sort((a, b) => Number(b.id - a.id))[0] : undefined;
    const report = row ? parse<Report | null>(row.json, null) : null;
    const A = report?.factoryAssessment;
    const flags = report?.integrity.flags.map((f) => f.kind) ?? [];
    const agent = db.agent.id.find(r.agentId);
    const purchase = db.purchase.id.find(r.purchaseId);
    const checks = claim ? parse<{ clips?: number }>(claim.checksJson || '{}', {}) : {};
    // Only a confirmed pattern naming this shopper counts as verified fraud; a detector flag alone never does.
    const verifiedFraud = [...db.fraudPattern.iter()].some((p) => p.status === 'confirmed' && p.agentIds.includes(r.agentId));
    const input: ScoreInput = {
      decision: r.status as 'accepted' | 'declined',
      amountCents: r.amount,
      requestedCents: purchase?.amount ?? r.amount,
      factory: A ? { action: A.action, status: A.status, nextStep: A.nextStep, rationale: A.rationale.slice(0, 400) } : undefined,
      challenge: flags.includes('challenge_failed') ? 'failed' : flags.includes('challenge_unclear') ? 'unclear' : report ? 'passed' : 'unchecked',
      extraClipUsed: (checks.clips ?? 1) >= 2,
      contradicted: (report?.findings ?? []).some((f) => f.kind === 'contradicts'),
      verifiedFraud,
      shopper: { score: agent?.score ?? 600, band: agent?.band ?? 'neutral' },
    };
    return { input, caseRef: claim ? `C-${claim.id}` : `R-${r.id}` };
  }

  private async run(r: Refund) {
    const { input, caseRef } = this.input(r);
    const rule = scoreRule(input);
    let out: ScoreOutput = rule;
    let provenance = 'rule';
    let runId = '';
    if (seatAvailable('score_reviewer')) {
      const R = this.conn.reducers;
      let h: Awaited<ReturnType<typeof startRun>> | null = null;
      try {
        h = await startRun('score_reviewer', { task: 'vouch_score_review', refund: `R-${r.id}`, ...input, bounds: { gain: [1, 15], loss: [-60, -1] } }, caseRef);
        runId = h.runId;
        await call('recordRun', R.recordRun({ runId: h.runId, seat: 'score_reviewer', caseRef, runUrl: h.runUrl, conversationId: h.conversationId, mode: h.path === 'fixture' ? 'fixture' : 'live' }));
        const step = (s: string) => void call('runStep', R.runStep({ runId: h!.runId, step: s }));
        step(`decision and evidence sent (${input.decision})`);
        const res = await waitForRun(h, input, step, 5 * 60_000);
        const v = parseVerdict<Record<string, unknown>>(res.text, {}, (x) => 'direction' in x);
        const ev = v.ok ? evaluateScoreVerdict(input, v.value) : { ok: false as const, why: res.status === 'completed' ? 'no JSON verdict in the answer' : `run ${res.status}` };
        if (ev.ok) {
          out = ev.out;
          provenance = h.path === 'fixture' ? 'fixture' : 'live';
          step(ev.notes.length ? `verdict accepted with corrections: ${ev.notes.join('; ')}` : 'verdict accepted');
          for (const n of ev.notes) log(`${caseRef}: Score Reviewer ${n}`);
        } else {
          step(`verdict rejected (${ev.why}): the rule answers`);
          log(`${caseRef}: Score Reviewer verdict rejected (${ev.why}); using the rule`);
        }
        await call('finishRun', R.finishRun({ runId: h.runId, status: res.status === 'completed' ? 'completed' : 'failed', runUrl: h.runUrl }));
      } catch (e) {
        log(`score reviewer agent unavailable for ${caseRef}: ${(e as Error).message}; using the rule`);
        if (h) await call('finishRun', R.finishRun({ runId: h.runId, status: 'failed', runUrl: h.runUrl })).catch(() => undefined);
      }
    }
    await call('applyScoreReview', this.conn.reducers.applyScoreReview({ refundId: r.id, direction: out.direction, delta: Math.round(out.delta), reason: out.reason, runId, provenance }));
    log(`${caseRef} R-${r.id}: score ${out.direction} ${out.delta} (${provenance}): ${out.reason}`);
  }
}
