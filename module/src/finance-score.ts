import { spacetimedb } from './schema';
import { roleOf, type Ctx } from './ctx';
import { SIM } from './finance/sim-config';
import { audit } from './finance-ledger';

// The portfolio's scorer: the ONLY code that reads finance_sim_truth and the
// planted events (the answer key). It measures the detector and the Exposure
// Guardian's ladder against the hidden truth and writes finance_score rows; the
// Proof screen and FINANCE_SCORE.md read those rows, never a typed number.

function put(ctx: Ctx, key: string, label: string, value: string, detail = '') {
  const row = { key, label, value, detail, at: ctx.timestamp };
  if (ctx.db.financeScore.key.find(key)) ctx.db.financeScore.key.update(row);
  else ctx.db.financeScore.insert(row);
}
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

export function scorePortfolioImpl(ctx: Ctx) {
  const s = ctx.db.financeSimState.id.find(1);
  if (!s) return;
  let organic = 0, organicFraud = 0, claims = 0, fraud = 0, flagged = 0, tp = 0, fp = 0, legit = 0, investigated = 0, verified = 0, cross = 0;
  for (const c of ctx.db.financeSimClaim.iter()) {
    if (c.source !== 'sim') continue;
    const truth = ctx.db.financeSimTruth.claimId.find(c.id);
    claims++;
    if (c.flagged) flagged++;
    if (c.investigated) investigated++;
    if (c.outcome === 'verified_fraud') verified++;
    if (c.crossCompany && c.flagged) cross++;
    if (!truth?.eventId) { organic++; if (truth?.fraud) organicFraud++; }
    if (truth?.fraud) { fraud++; if (c.flagged) tp++; } else { legit++; if (c.flagged) fp++; }
  }
  let orders = 0;
  for (const st of ctx.db.financeCompanyState.iter()) orders += st.orders;
  const months = s.simHour / (30 * 24);
  put(ctx, 'sim.hours', 'Simulated hours run', String(s.simHour), `${(s.simHour / 24).toFixed(1)} days`);
  put(ctx, 'sim.orders_per_month', 'Orders per simulated 30 days', months ? String(Math.round(orders / months)) : 'n/a', `target ${SIM.ordersPerMonth}`);
  put(ctx, 'sim.claims_per_month', 'Refund claims per simulated 30 days', months ? String(Math.round(claims / months)) : 'n/a', 'target about 3,300 (13% of orders)');
  put(ctx, 'sim.fraud_share', 'Fraudulent share of organic claims (hidden truth; demo setting)', pct(organicFraud, organic), `setting ${(SIM.fraudShareBp / 100).toFixed(0)}%; with planted rings: ${pct(fraud, claims)}`);
  put(ctx, 'detector.recall', 'Detector recall on fraudulent claims', pct(tp, fraud), `${tp} of ${fraud}; target about 75%`);
  put(ctx, 'detector.false_flag', 'Honest claims falsely flagged', pct(fp, legit), `${fp} of ${legit}; target about 5%`);
  put(ctx, 'detector.flag_rate', 'Claims carrying a flag', pct(flagged, claims), 'target about 15%');
  put(ctx, 'detector.investigated', 'Claims investigated', pct(investigated, claims), 'target about 9%');
  put(ctx, 'detector.verified', 'Investigations ending in verified fraud', pct(verified, investigated), 'target about 30%');
  put(ctx, 'detector.cross_company', 'Claims caught because of another company\'s evidence', String(cross), 'hash seen in a verified fraud elsewhere');

  // The ladder against the planted stories.
  const logs = [...ctx.db.financeExposureLog.iter()];
  const reached = (companyId: number, from: number, to: number) => {
    const rungs = logs.filter((l) => l.companyId === companyId && l.simHour >= from && l.simHour <= to).map((l) => l.toRung);
    return rungs.includes('pause') || rungs.includes('pause_proposed') ? 'pause' : rungs.includes('hedge') ? 'hedge' : rungs.includes('watch') ? 'watch' : 'normal';
  };
  let rings = 0, ringsCaught = 0, decoys = 0, decoysPaused = 0, decoysOverWatch = 0;
  const ringTargets = new Set<number>();
  const decoyDetail: string[] = [];
  for (const e of ctx.db.financeSimEvent.iter()) {
    if (e.startHour > s.simHour) continue;
    const params = JSON.parse(e.paramsJson) as { offsets?: number[] };
    e.companyIds.forEach((companyId, i) => {
      const start = e.startHour + (params.offsets?.[i] ?? 0);
      const end = start + (e.endHour - e.startHour);
      if (e.kind === 'ring') {
        if (end > s.simHour) return; // still running: not scored yet
        rings++;
        ringTargets.add(companyId);
        const r = reached(companyId, start, end + 12);
        if (r === 'hedge' || r === 'pause') ringsCaught++;
      } else if (e.kind === 'sale_day' || e.kind === 'defect_batch') {
        if (end + 24 > s.simHour) return;
        decoys++;
        const r = reached(companyId, start, end + 24);
        if (r === 'pause') decoysPaused++;
        if (r === 'hedge' || r === 'pause') decoysOverWatch++;
        decoyDetail.push(`${e.kind} at company ${companyId}: ${r}`);
      }
    });
  }
  const quietPaused = new Set(logs.filter((l) => (l.toRung === 'pause' || l.toRung === 'pause_proposed') && !ringTargets.has(l.companyId)).map((l) => l.companyId));
  put(ctx, 'guardian.rings_caught', 'Planted ring attacks hedged or paused in time', `${ringsCaught} of ${rings}`, 'reached Hedge or a Pause proposal before the attack ended + 12 h');
  put(ctx, 'guardian.decoys_paused', 'Decoys (sale day, defective batch) wrongly paused', `${decoysPaused} of ${decoys}`, decoyDetail.join('; ') || 'none finished yet');
  put(ctx, 'guardian.decoys_over_watch', 'Decoys that went above Watch', `${decoysOverWatch} of ${decoys}`, 'should stay at Watch at most');
  put(ctx, 'guardian.quiet_paused', 'Companies with no planted attack that reached a Pause proposal', String(quietPaused.size), [...quietPaused].join(', ') || 'none');
  let delayed = 0, delayHours = 0;
  for (const st of ctx.db.financeCompanyState.iter()) { delayed += st.delayedByPause; delayHours += Number(st.delayHoursSum); }
  put(ctx, 'guardian.delayed', 'Honest-cost: claims delayed by a pause', String(delayed), delayed ? `mean delay ${(delayHours / delayed).toFixed(0)} h (nobody is denied by a pause)` : 'none');
}

export const financeScorePortfolio = spacetimedb.reducer((ctx) => {
  if (roleOf(ctx)?.role !== 'worker') return audit(ctx, 0, 'ROLE', { who: ctx.sender, role: roleOf(ctx)?.role ?? 'none' }, 'score', 'only the worker runs the scorer');
  scorePortfolioImpl(ctx);
});
