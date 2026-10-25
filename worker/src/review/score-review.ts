// After a CREAO verdict that was not put on hold, or a person's decision, on a real claim, CREAO
// agents judge what it does to the shopper's Vouch score. Preferred: the saved
// Score Reviewer gives a direct verdict. Always, when their seats are connected:
// a panel of the Refund Investigator (does the evidence back the decision?) and
// the Risk Scorecard (how much caution does the shopper's behaviour warrant?),
// run in parallel on the decided claim (panelVerdict). Every answer is checked
// against the Score Reviewer's brief (evaluateScoreVerdict) and the module
// applies it inside fixed bounds, once per refund (applyScoreReview). Each run is
// an agent_run row on the claim. Only when no CREAO seat answers does the plain
// rule decide, labelled "rule".
import type { DbConnection } from '../../module_bindings/index';
import type { Refund } from '../../module_bindings/types';
import type { Report } from '@vouch/module/review-types';
import { businessDef, catalogItem } from '@vouch/module/world';
import { config, log, type Seat } from '../env';
import { fillFromChat, parseVerdict, seatAvailable, seatPath, startRun, waitForRun, type RunHandle } from '../creao';
import { historySummary } from '../history';
import { call } from '../stdb';
import { evaluateScoreVerdict, panelVerdict, scoreRule, type PanelInput, type ScoreInput, type ScoreOutput } from './score-rule';

const parse = <T>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };
const PANEL: Seat[] = ['refund_investigator', 'risk_scorecard'];

interface Context { input: ScoreInput; caseRef: string; report: Report | null; refund: Refund }

export class ScoreReviewer {
  private busy = new Set<bigint>();
  constructor(private conn: DbConnection) {}

  private creaoOn() { return this.conn.db.control.key.find('creao_enabled')?.value !== 'false'; }

  start() {
    const db = this.conn.db;
    // Only decisions arrive on their own; a CREAO verdict comes through afterVerdict, so a held review never scores.
    db.refund.onUpdate((_c, _o, r) => { if (r.status === 'accepted' || r.status === 'declined') this.consider(r); });
    for (const r of db.refund.iter()) if (r.status === 'accepted' || r.status === 'declined') this.consider(r);
    const seats = (['score_reviewer', ...PANEL] as Seat[]).map((s) => `${s}=${seatAvailable(s) ? seatPath(s) : 'off'}`).join(' ');
    log(`score reviewer started: CREAO ${seats}`);
    if (!PANEL.some((s) => seatAvailable(s)) && !seatAvailable('score_reviewer')) log('WARNING: no CREAO seat can judge score changes; they fall back to the labelled rule');
  }

  /** Called by the video review when it reached a verdict that was not put on hold. */
  afterVerdict(refundId: bigint) {
    const r = this.conn.db.refund.id.find(refundId);
    if (r && this.verdictOf(r)) this.consider(r);
  }

  /** accepted/declined after a decision, or the open CREAO accept/decline proposal before one. */
  private verdictOf(r: Refund): 'accepted' | 'declined' | null {
    if (r.status === 'accepted' || r.status === 'declined') return r.status;
    if (r.status !== 'recommended') return null;
    const open = [...this.conn.db.decision.refundId.filter(r.id)].filter((d) => d.status === 'proposed' || d.status === 'sent_to_controller').sort((a, b) => Number(b.id - a.id))[0];
    return open?.action === 'accept' ? 'accepted' : open?.action === 'decline' ? 'declined' : null;
  }

  private consider(r: Refund) {
    if (r.source === 'sim' || (r.status !== 'accepted' && r.status !== 'declined' && r.status !== 'recommended')) return;
    if (!this.verdictOf(r)) return;
    if (this.busy.has(r.id) || this.conn.db.scoreReview.refundId.find(r.id)) return;
    this.busy.add(r.id);
    void this.run(r).catch((e) => log(`score review R-${r.id} failed: ${(e as Error).message}`)).finally(() => this.busy.delete(r.id));
  }

  private context(r: Refund): Context {
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
      decision: this.verdictOf(r) ?? 'accepted',
      amountCents: r.amount,
      requestedCents: purchase?.amount ?? r.amount,
      factory: A ? { action: A.action, status: A.status, nextStep: A.nextStep, rationale: A.rationale.slice(0, 400) } : undefined,
      challenge: flags.includes('challenge_failed') ? 'failed' : flags.includes('challenge_unclear') ? 'unclear' : report ? 'passed' : 'unchecked',
      extraClipUsed: (checks.clips ?? 1) >= 2,
      contradicted: (report?.findings ?? []).some((f) => f.kind === 'contradicts'),
      verifiedFraud,
      shopper: { score: agent?.score ?? 600, band: agent?.band ?? 'neutral' },
    };
    return { input, caseRef: claim ? `C-${claim.id}` : `R-${r.id}`, report, refund: r };
  }

  /** One CREAO run, recorded on the claim. Returns the parsed object, or null when the run failed or was unreadable. */
  private async seat(seat: Seat, caseRef: string, caseJson: unknown, valid: (v: Record<string, unknown>) => boolean, first: string): Promise<{ value: Record<string, unknown>; handle: RunHandle } | null> {
    const R = this.conn.reducers;
    let h: RunHandle | null = null;
    try {
      h = await startRun(seat, caseJson, caseRef);
      await call('recordRun', R.recordRun({ runId: h.runId, seat, caseRef, runUrl: h.runUrl, conversationId: h.conversationId, mode: h.path === 'fixture' ? 'fixture' : 'live' }));
      const step = (s: string) => void call('runStep', R.runStep({ runId: h!.runId, step: s }));
      step(first);
      const res = await waitForRun(h, caseJson, step, 6 * 60_000);
      const v = parseVerdict<Record<string, unknown>>(res.text, {}, valid, (x) => fillFromChat(seat, x, res.chat));
      step(res.status !== 'completed' ? `run ${res.status}` : v.ok ? 'answer received for the score review' : 'answer unreadable: not used');
      await call('finishRun', R.finishRun({ runId: h.runId, status: res.status === 'completed' ? 'completed' : 'failed', runUrl: h.runUrl }));
      return v.ok ? { value: v.value, handle: h } : null;
    } catch (e) {
      log(`${caseRef}: ${seat} unavailable for the score review: ${(e as Error).message}`);
      if (h) await call('finishRun', R.finishRun({ runId: h.runId, status: 'failed', runUrl: h.runUrl })).catch(() => undefined);
      return null;
    }
  }

  /** The decided claim in the shape each panel seat already reads in the investigation. */
  private async panelCases(x: Context) {
    const { refund: r, report, input, caseRef } = x;
    const db = this.conn.db;
    const purchase = db.purchase.id.find(r.purchaseId);
    const item = purchase ? catalogItem(purchase.item) : undefined;
    const policy = businessDef(r.businessId)?.policy;
    const history = await historySummary(this.conn, r.agentId);
    const patterns = [...db.fraudPattern.iter()].filter((p) => p.agentIds.includes(r.agentId)).map((p) => ({ id: `FR-${p.id}`, kind: p.kind, status: p.status }));
    const A = report?.factoryAssessment;
    const evidence = {
      unable_to_verify: !report || A?.status === 'unavailable',
      summary: (A?.rationale ?? r.reasonText ?? 'No evidence report was written for this claim.').slice(0, 900),
      findings: (report?.findings ?? []).slice(0, 10).map((f) => ({ kind: f.kind, observation: f.observation, confidence: f.confidence })),
      challenge: { passed: input.challenge === 'passed' ? true : input.challenge === 'failed' ? false : null },
      capture_flags: report?.integrity.flags.map((f) => f.kind) ?? [],
    };
    const credential = { presented: false, verified: false, failed_step: null, issuer: null, claims: {} };
    const investigator = {
      task: 'review_decided_claim', claim_id: caseRef, decision_already_made: input.decision,
      amount_requested: r.amount / 100, controller_threshold: 500,
      order: { item: item?.name ?? 'item', category: purchase?.category ?? '', amount: (purchase?.amount ?? r.amount) / 100, purchased_day: purchase?.day ?? 0, delivered_day: purchase?.deliverDay ?? 0, claim_day: r.day },
      claim: { reason_code: r.reasonCode, reason_text: r.reasonText },
      policy: policy ? { window_days: policy.windowDays, restocking_fee_pct: policy.restockingFeePct, store_credit_allowed: policy.storeCreditAllowed, notes: policy.notes } : {},
      evidence, deterministic_checks: { fresh: true, frame_reuse: [], still_image: false, within_window: true },
      history, credential, patterns, today: db.simRun.id.find(1)?.day ?? 0,
    };
    const scorecard = {
      claim_id: caseRef, amount_requested: r.amount / 100, history, credential, patterns,
      identity: { status: 'not_run', reason: config.crs.configured ? 'no CRS persona is linked to this shopper' : 'CRS is not configured' },
      item_context: { sku: `SKU-${purchase?.item ?? 0}`, name: item?.name ?? 'item', pulse: null, business_context: {} },
      video_checks: { fresh: true, frame_reuse_count: 0, still_image: false, challenge_passed: evidence.challenge.passed, capture_flags: evidence.capture_flags, unable_to_verify: evidence.unable_to_verify },
      evidence_summary: evidence.summary,
    };
    return { investigator, scorecard };
  }

  private async run(r: Refund) {
    const x = this.context(r);
    const { input, caseRef } = x;
    let out: ScoreOutput = scoreRule(input);
    let provenance = 'rule';
    const runIds: string[] = [];
    if (this.creaoOn()) {
      const cases = PANEL.some((s) => seatAvailable(s)) ? await this.panelCases(x) : null;
      const [direct, inv, card] = await Promise.all([
        seatAvailable('score_reviewer')
          ? this.seat('score_reviewer', caseRef, { task: 'vouch_score_review', refund: `R-${r.id}`, ...input, bounds: { gain: [1, 15], loss: [-60, -1] } }, (v) => 'direction' in v, `decision and evidence sent (${input.decision})`)
          : Promise.resolve(null),
        cases && seatAvailable('refund_investigator')
          ? this.seat('refund_investigator', caseRef, cases.investigator, (v) => ['accept', 'decline', 'more_evidence'].includes(String(v.action)), `score review: decided claim sent (${input.decision})`)
          : Promise.resolve(null),
        cases && seatAvailable('risk_scorecard')
          ? this.seat('risk_scorecard', caseRef, cases.scorecard, (v) => typeof v.caution === 'string', 'score review: history and patterns sent')
          : Promise.resolve(null),
      ]);
      for (const s of [direct, inv, card]) if (s) runIds.push(s.handle.runId);
      const live = [direct, inv, card].some((s) => s && s.handle.path !== 'fixture');
      const tag = live ? 'live' : 'fixture';
      const directEval = direct ? evaluateScoreVerdict(input, direct.value) : null;
      const panelIn: PanelInput = {
        investigator: inv ? { action: String(inv.value.action), confidence: Number(inv.value.confidence) || 0 } : undefined,
        scorecard: card ? { caution: String(card.value.caution) } : undefined,
      };
      const panel = panelVerdict(input, panelIn);
      const panelEval = panel ? evaluateScoreVerdict(input, panel) : null;
      if (directEval?.ok) {
        out = directEval.out;
        provenance = `${tag}`;
        if (panelEval?.ok && panelEval.out.direction !== out.direction) log(`${caseRef}: Score Reviewer (${out.direction}) and panel (${panelEval.out.direction}) disagree; the Score Reviewer's verdict stands`);
      } else if (panelEval?.ok) {
        out = panelEval.out;
        provenance = `panel_${tag}`;
      } else {
        if (directEval && !directEval.ok) log(`${caseRef}: Score Reviewer verdict rejected (${directEval.why})`);
        if (panelEval && !panelEval.ok) log(`${caseRef}: panel verdict rejected (${panelEval.why})`);
      }
    }
    await call('applyScoreReview', this.conn.reducers.applyScoreReview({ refundId: r.id, direction: out.direction, delta: Math.round(out.delta), reason: out.reason, runId: runIds.join(',').slice(0, 300), provenance }));
    log(`${caseRef} R-${r.id}: score ${out.direction} ${out.delta} (${provenance}, runs ${runIds.length}): ${out.reason}`);
  }
}
