// The CREAO Refund Reviewer (and, when saved, the Customer Liaison) read the
// finished report and answer with one JSON object each. The Reviewer can only
// agree or disagree: it never changes the tier, and only an agreement unlocks
// the automatic T1/T2 pay-out. Offline, unparseable or over budget all fail
// closed to "a person decides".
import type { DbConnection } from '../../module_bindings/index';
import type { Report } from '@vouch/module/review-types';
import { TIER_LABEL } from '@vouch/module/review-score';
import { config, log, type Seat } from '../env';
import { parseVerdict, seatAvailable, startRun, waitForRun } from '../creao';
import { call } from '../stdb';

export type CreaoReview = NonNullable<Report['creaoReview']>;
export interface Liaison { customerTitle: string; customerMessage: string; nextSteps: string; evidenceRequest: string }
export interface ReviewOutcome { review: CreaoReview; runUrl: string; liaison: Liaison | null; suggestedTier: string | null; confidence: number }

export interface ReviewOptions {
  creaoOn: boolean;
  /** Spends one CREAO run; false when the daily limit is reached. */
  takeBudget: () => boolean;
  onStep: (s: string) => void;
}

const offline = (why: string): ReviewOutcome => ({
  review: { agrees: false, businessSummary: `Reviewer offline: ${why}. A person decides.`, concerns: [], customerMessage: '', runId: '', provenance: 'offline' },
  runUrl: '', liaison: null, suggestedTier: null, confidence: 0,
});

interface ReviewerJson { agrees: boolean; businessSummary: string; concerns?: unknown; suggestedTierIfDisagree?: unknown; confidence?: unknown; customerMessage?: unknown }

/** Runs one seat end to end (run row, progress steps, parse, finish). Throws on transport errors; the caller fails closed. */
async function runSeat<T extends object>(conn: DbConnection, seat: Seat, caseRef: string, caseJson: unknown, fallback: T, valid: (v: Record<string, unknown>) => boolean, onStep: (s: string) => void) {
  const handle = await startRun(seat, caseJson, caseRef);
  await call('recordRun', conn.reducers.recordRun({ runId: handle.runId, seat, caseRef, runUrl: handle.runUrl, conversationId: handle.conversationId, mode: handle.path === 'fixture' ? 'fixture' : 'live' }));
  const step = (s: string) => { onStep(s); void call('runStep', conn.reducers.runStep({ runId: handle.runId, step: s })); };
  step('report sent');
  const result = await waitForRun(handle, caseJson, step);
  const parsed = parseVerdict(result.text, fallback, valid);
  step(result.status !== 'completed' ? `run ${result.status}` : parsed.ok ? 'result received' : 'result unparseable: failed closed');
  await call('finishRun', conn.reducers.finishRun({ runId: handle.runId, status: result.status === 'completed' ? 'completed' : 'failed', runUrl: handle.runUrl }));
  return { ...parsed, handle };
}

export async function reviewWithCreao(conn: DbConnection, report: Report, caseRef: string, o: ReviewOptions): Promise<ReviewOutcome> {
  if (!o.creaoOn) return offline('the CREAO kill switch is off');
  if (!seatAvailable('refund_reviewer')) return offline('no saved CREAO agent "Vouch Refund Reviewer"');
  if (!o.takeBudget()) return offline(`the daily CREAO run limit (${config.creao.dailyRunLimit}) is reached`);
  const caseJson = { ...report, tierLabel: TIER_LABEL[report.recommendation.tier] };
  const fallback: ReviewerJson = { agrees: false, businessSummary: 'The Reviewer output could not be read, so a person decides.', concerns: ['unreadable output'] };
  let r: Awaited<ReturnType<typeof runSeat<ReviewerJson>>>;
  try {
    r = await runSeat<ReviewerJson>(conn, 'refund_reviewer', caseRef, caseJson, fallback, (v) => typeof v.agrees === 'boolean' && typeof v.businessSummary === 'string', o.onStep);
  } catch (e) {
    log(`${caseRef}: Refund Reviewer failed: ${(e as Error).message}`);
    return offline(`the CREAO run failed (${(e as Error).message.slice(0, 120)})`);
  }
  const v = r.value;
  const provenance = r.handle.path === 'fixture' ? 'fixture' : 'live';
  const concerns = Array.isArray(v.concerns) ? v.concerns.map(String).slice(0, 8) : [];
  const review: CreaoReview = {
    agrees: r.ok && v.agrees === true, businessSummary: String(v.businessSummary).slice(0, 1200), concerns,
    customerMessage: typeof v.customerMessage === 'string' ? v.customerMessage.slice(0, 600) : '', runId: r.handle.runId, provenance,
  };
  const suggestedTier = typeof v.suggestedTierIfDisagree === 'string' && /^T[1-5]$/.test(v.suggestedTierIfDisagree) ? v.suggestedTierIfDisagree : null;
  const confidence = typeof v.confidence === 'number' ? Math.min(1, Math.max(0, v.confidence)) : 0;
  let liaison: Liaison | null = null;
  if (seatAvailable('customer_liaison') && o.takeBudget()) {
    try {
      const l = await runSeat<Partial<Liaison>>(conn, 'customer_liaison', caseRef, { ...caseJson, review }, {}, (x) => typeof x.customerMessage === 'string', o.onStep);
      if (l.ok) liaison = { customerTitle: String(l.value.customerTitle ?? '').slice(0, 80), customerMessage: String(l.value.customerMessage ?? '').slice(0, 600), nextSteps: String(l.value.nextSteps ?? '').slice(0, 400), evidenceRequest: String(l.value.evidenceRequest ?? '').slice(0, 400) };
    } catch (e) {
      log(`${caseRef}: Customer Liaison failed: ${(e as Error).message}`);
    }
  }
  return { review, runUrl: r.handle.runUrl, liaison, suggestedTier, confidence };
}
