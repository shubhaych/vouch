// After a person (or the bounded auto-approve) decides a real claim, the CREAO
// Score Reviewer judges what it does to the shopper's Vouch score: gain, loss or
// unchanged, with one line of why. The module applies it inside fixed bounds,
// once per refund (applyScoreReview). Without the live agent the plain rule in
// score-rule.ts answers, labelled "rule", so the business side always sees a reason.
import type { DbConnection } from '../../module_bindings/index';
import type { Refund } from '../../module_bindings/types';
import type { Report } from '@vouch/module/review-types';
import { log } from '../env';
import { parseVerdict, seatAvailable, seatPath, startRun, waitForRun } from '../creao';
import { call } from '../stdb';
import { scoreRule, type ScoreInput, type ScoreOutput } from './score-rule';

const parse = <T>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };

export class ScoreReviewer {
  private busy = new Set<bigint>();
  constructor(private conn: DbConnection) {}

  start() {
    const db = this.conn.db;
    db.refund.onUpdate((_c, _o, r) => this.consider(r));
    for (const r of db.refund.iter()) this.consider(r);
    log(`score reviewer started (CREAO seat score_reviewer: ${seatAvailable('score_reviewer') ? seatPath('score_reviewer') : 'not connected, rule fallback'})`);
  }

  private consider(r: Refund) {
    if (r.source === 'sim' || (r.status !== 'accepted' && r.status !== 'declined')) return;
    if (this.busy.has(r.id) || this.conn.db.scoreReview.refundId.find(r.id)) return;
    this.busy.add(r.id);
    void this.run(r).catch((e) => log(`score review R-${r.id} failed: ${(e as Error).message}`)).finally(() => this.busy.delete(r.id));
  }

  private input(r: Refund): ScoreInput {
    const db = this.conn.db;
    const claim = [...db.claim.iter()].find((c) => c.refundId === r.id);
    const row = claim ? [...db.report.iter()].filter((x) => x.claimId === claim.id).sort((a, b) => Number(b.id - a.id))[0] : undefined;
    const report = row ? parse<Report | null>(row.json, null) : null;
    const A = report?.factoryAssessment;
    const flags = report?.integrity.flags.map((f) => f.kind) ?? [];
    const agent = db.agent.id.find(r.agentId);
    const purchase = db.purchase.id.find(r.purchaseId);
    const checks = claim ? parse<{ clips?: number }>(claim.checksJson || '{}', {}) : {};
    return {
      decision: r.status as 'accepted' | 'declined',
      amountCents: r.amount,
      requestedCents: purchase?.amount ?? r.amount,
      factory: A ? { action: A.action, status: A.status, nextStep: A.nextStep, rationale: A.rationale.slice(0, 400) } : undefined,
      challenge: flags.includes('challenge_failed') ? 'failed' : flags.includes('challenge_unclear') ? 'unclear' : report ? 'passed' : 'unchecked',
      extraClipUsed: (checks.clips ?? 1) >= 2,
      contradicted: (report?.findings ?? []).some((f) => f.kind === 'contradicts'),
      verifiedFraud: false,
      shopper: { score: agent?.score ?? 600, band: agent?.band ?? 'neutral' },
    };
  }

  private async run(r: Refund) {
    const input = this.input(r);
    const rule = scoreRule(input);
    let out: ScoreOutput = rule;
    let provenance = 'rule';
    let runId = '';
    if (seatAvailable('score_reviewer')) {
      try {
        const h = await startRun('score_reviewer', { task: 'vouch_score_review', refund: `R-${r.id}`, ...input, bounds: { gain: [1, 15], loss: [-60, -1] } }, `R-${r.id}`);
        runId = h.runId;
        const res = await waitForRun(h, input, () => undefined, 5 * 60_000);
        const v = parseVerdict<ScoreOutput>(res.text, rule, (x) => ['gain', 'loss', 'same'].includes(String(x.direction)) && typeof x.reason === 'string');
        if (v.ok) { out = { direction: v.value.direction, delta: Number(v.value.delta) || 0, reason: String(v.value.reason) }; provenance = h.path === 'fixture' ? 'fixture' : 'live'; }
      } catch (e) {
        log(`score reviewer agent unavailable for R-${r.id}: ${(e as Error).message}; using the rule`);
      }
    }
    await call('applyScoreReview', this.conn.reducers.applyScoreReview({ refundId: r.id, direction: out.direction, delta: Math.round(out.delta), reason: out.reason, runId, provenance }));
    log(`R-${r.id}: score ${out.direction} ${out.delta} (${provenance}): ${out.reason}`);
  }
}
