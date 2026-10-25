import { ScheduleAt, t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { financeTickSchedule } from './finance-schema';
import { roleOf, type Ctx } from './ctx';
import { Rng } from './rng';
import { COMPANIES, COMPANY_CATEGORIES, companyById, type CompanyDef } from './finance/companies';
import { FLAG_AT, reasons, risk } from './finance/detector';
import { allowedRungs as allowedFor, codeStep, zeroSignals, type Signals } from './finance/exposure';
import { POLICY, RUNGS, type Rung } from './finance/policy';
import { DOW, HOUR_CURVE, SIM } from './finance/sim-config';
import { SIM_ACCOUNTANT, SIM_ENGINE, audit, bookImpl, seedFinanceCatalogImpl, type Actor } from './finance-ledger';
import { applyReturnImpl, closeLiteImpl, hourPeriod, openObligationImpl, type ReturnOutcome } from './finance-obligations';

// The 100-company portfolio, simulated inside the database. One tick advances
// hoursPerTick simulated hours. Every company gets orders and refund claims
// from its category's rates; the buyers and claimants are the main world's
// 10,000 agents (their real Vouch score; their hidden kind makes fraud more or
// less likely). The detector sees only observable features; the truth goes to
// a private table the scorer alone reads. Payouts, obligations and returns go
// through the same ledger code as everything else. Scripted rings and decoys
// make the Exposure Guardian's job real, and their ids are the answer key.

const ENGINE: Actor = { who: SIM_ENGINE, role: 'decision_engine' };
const ACCOUNTANT: Actor = { who: SIM_ACCOUNTANT, role: 'accountant' };
const SUM_SIZE = COMPANIES.reduce((s, c) => s + c.size, 0);
const FEATURED = COMPANIES.find((c) => c.featured)!.id;
const AVG_SUSC = Object.values(COMPANY_CATEGORIES).reduce((s, c) => s + c.fraudSusceptibilityPct, 0) / Object.keys(COMPANY_CATEGORIES).length;

/** FNV-1a: stable salted hashes for shoppers and devices. Never a real identifier. */
export function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const bp = (rng: Rng, x: number) => rng.next() * 10_000 < x;
const draw = (rng: Rng, mean: number) => Math.floor(mean) + (rng.next() < mean - Math.floor(mean) ? 1 : 0);

interface EventParams { offsets?: number[]; claimsPerHour?: number; agents?: number[]; hash?: string; sku?: string; mult?: number; ringId?: number }
interface ActiveEvent { id: bigint; kind: string; companyId: number; params: EventParams }

function state(ctx: Ctx) {
  const s = ctx.db.financeSimState.id.find(1);
  if (!s) throw new Error('the portfolio is not seeded (financeSeedPortfolio)');
  return s;
}

// ---------------------------------------------------------------- seed and scripted events

function ringAgents(ctx: Ctx): Map<number, number[]> {
  const byRing = new Map<number, number[]>();
  for (const a of ctx.db.agentTruth.iter()) {
    if (a.kind !== 'ring') continue;
    const list = byRing.get(a.ringId) ?? [];
    if (list.length < 12) list.push(a.agentId);
    byRing.set(a.ringId, list);
  }
  return byRing;
}

function plantEvent(ctx: Ctx, kind: string, companyIds: number[], startHour: number, hours: number, params: EventParams, plantedBy: string) {
  return ctx.db.financeSimEvent.insert({ id: 0n, kind, companyIds, startHour, endHour: startHour + hours, paramsJson: JSON.stringify(params), plantedBy, at: ctx.timestamp }).id;
}

const topSku = (c: CompanyDef) => [...c.products].sort((a, b) => b.priceCents - a.priceCents)[0]!.sku;

/**
 * The answer key's stories, chosen from the seed: three rings on quiet single
 * companies, two rings across several companies, two sale days and two
 * defective batches (decoys that must not be paused), and two rings timed to be
 * running when the prewarm ends, so the demo opens on one Hedge and one Pause proposal.
 */
function plantScripted(ctx: Ctx, rng: Rng) {
  const rings = [...ringAgents(ctx).entries()].filter(([, a]) => a.length >= 3);
  const quiet = COMPANIES.filter((c) => !c.featured && c.size <= 3).map((c) => c.id);
  const big = COMPANIES.filter((c) => !c.featured && c.size >= 4).map((c) => c.id);
  const pick = (pool: number[]) => { const i = rng.int(0, pool.length - 1); return pool.splice(i, 1)[0]!; };
  const ring = (i: number) => rings.length ? rings[i % rings.length]! : [i + 1, [1, 2, 3]] as [number, number[]];
  const day = 24;
  let r = 0;
  for (const d of [20, 45, 75]) {
    const c = pick(quiet);
    const [ringId, agents] = ring(r++);
    plantEvent(ctx, 'ring', [c], d * day, 24, { claimsPerHour: 2.5, agents, ringId, hash: `ring-${ringId}-${c}`, sku: topSku(companyById(c)!) }, 'script');
  }
  for (const d of [55, 82]) {
    const n = rng.int(4, 6);
    const cs = Array.from({ length: n }, () => pick(quiet));
    const [ringId, agents] = ring(r++);
    plantEvent(ctx, 'ring', cs, d * day, 20, { claimsPerHour: 2, agents, ringId, hash: `ring-${ringId}-multi`, offsets: cs.map((_, i) => i * 6) }, 'script');
  }
  for (const d of [30, 70]) plantEvent(ctx, 'sale_day', [pick(big)], d * day, 24, { mult: 4 }, 'script');
  for (const d of [40, 80]) { const c = pick(big); plantEvent(ctx, 'defect_batch', [c], d * day, 24, { claimsPerHour: 2, sku: companyById(c)!.products[rng.int(0, 3)]!.sku }, 'script'); }
  // Running at the end of the 90-day prewarm: one reaches Pause proposed, one is still climbing.
  for (const [startH, hours] of [[87 * day + 6, 40], [89 * day + 6, 30]] as const) {
    const c = pick(quiet);
    const [ringId, agents] = ring(r++);
    plantEvent(ctx, 'ring', [c], startH, hours, { claimsPerHour: 2.5, agents, ringId, hash: `ring-${ringId}-${c}`, sku: topSku(companyById(c)!) }, 'script');
  }
}

export function seedPortfolioImpl(ctx: Ctx, seed: bigint) {
  seedFinanceCatalogImpl(ctx);
  const rng = Rng.fromSeed(seed);
  for (const c of COMPANIES) {
    const row = {
      companyId: c.id, orders: 0, orderCents: 0n, claims: 0, claimCents: 0n, refundedCents: 0n, flags: 0, investigations: 0, verifiedFraud: 0, falseFlags: 0,
      crossCompanyCatches: 0, scoreSum: 0n, scoreN: 0, cashCents: BigInt(c.size * SIM.startingCashPerSizeCents), openObligations: 0, openLeg2Cents: 0n,
      unrecoveredLeg1Cents: 0n, delayedByPause: 0, delayHoursSum: 0n, goodsBackUnits: 0, goodsBackCents: 0n, rung: 'normal', rungSinceHour: 0,
      signalsJson: JSON.stringify({ now: zeroSignals(), prev: null, pausePending: false }), updatedHour: 0,
    };
    if (ctx.db.financeCompanyState.companyId.find(c.id)) ctx.db.financeCompanyState.companyId.update(row);
    else ctx.db.financeCompanyState.insert(row);
  }
  for (const e of [...ctx.db.financeSimEvent.iter()]) ctx.db.financeSimEvent.id.delete(e.id);
  plantScripted(ctx, rng);
  const s = {
    id: 1, running: false, hoursPerTick: 1, seed, simHour: 0, rngState: rng.state, ticks: 0n, seeded: true, epochMs: BigInt(SIM.epochMs),
    lastTickMs: 0n, rowsLastTick: 0, msLastTick: 0,
  };
  if (ctx.db.financeSimState.id.find(1)) ctx.db.financeSimState.id.update(s);
  else ctx.db.financeSimState.insert(s);
}

// ---------------------------------------------------------------- one simulated hour

interface Hour { orders: number; orderCents: number; claims: number; claimCents: number; flags: number; investigations: number; verifiedFraud: number; contradicted: number; ringCents: number; cross: number; scoreSum: number; scoreN: number }
const emptyHour = (): Hour => ({ orders: 0, orderCents: 0, claims: 0, claimCents: 0, flags: 0, investigations: 0, verifiedFraud: 0, contradicted: 0, ringCents: 0, cross: 0, scoreSum: 0, scoreN: 0 });

function activeEvents(ctx: Ctx, h: number): ActiveEvent[] {
  const out: ActiveEvent[] = [];
  for (const e of ctx.db.financeSimEvent.iter()) {
    const params = JSON.parse(e.paramsJson) as EventParams;
    e.companyIds.forEach((companyId, i) => {
      const start = e.startHour + (params.offsets?.[i] ?? 0);
      if (h >= start && h < start + (e.endHour - e.startHour)) out.push({ id: e.id, kind: e.kind, companyId, params });
    });
  }
  return out;
}

interface Draft { agentId: number; sku: string; cents: number; fraud: boolean; archetype: string; ringId: number; eventId: bigint; hash?: string; contradictedBp?: number }

function agentScore(ctx: Ctx, agentId: number): { score: number; band: string; kind: string } {
  const a = ctx.db.agent.id.find(agentId);
  const k = ctx.db.agentTruth.agentId.find(agentId);
  return { score: a?.score ?? 600, band: a?.band ?? 'neutral', kind: k?.kind ?? 'honest' };
}

function fileClaim(ctx: Ctx, rng: Rng, seed: bigint, c: CompanyDef, d: Draft, h: number, hour: Hour) {
  const st = ctx.db.financeCompanyState.companyId.find(c.id)!;
  const { score, band } = agentScore(ctx, d.agentId);
  const hash = d.hash ?? `d${hashStr(`${seed}:${d.agentId}`)}`;
  const signal = ctx.db.financeVouchSignal.hash.find(hash);
  const crossCompany = !!signal && signal.companyId !== c.id;
  const contradicted = bp(rng, d.contradictedBp ?? SIM.contradictedBp[d.fraud ? d.archetype : 'legit'] ?? 500);
  const hashReuse = d.hash ? true : bp(rng, d.fraud ? SIM.hashReuseBp.fraud : SIM.hashReuseBp.legit);
  const f = { contradicted, hashReuse, crossCompany, score, noise: rng.next() };
  const r = risk(f);
  const flagged = r >= FLAG_AT;
  const rung = st.rung as Rung;
  const investigated = flagged && rung !== 'pause' && bp(rng, SIM.investigateBp);
  let tier = 'T1';
  let outcome = 'pending';
  let resolveHour = 0;
  if (rung === 'pause') { tier = 'T5'; outcome = 'review'; resolveHour = h + 48; }
  else if (investigated) { tier = 'T5'; resolveHour = h + rng.int(6, 36); }
  else if (flagged) { tier = 'T4'; resolveHour = h + 24; }
  const claim = ctx.db.financeSimClaim.insert({
    id: 0n, companyId: c.id, agentId: d.agentId, sku: d.sku, cents: d.cents, tier, score, band, riskBp: Math.round(r * 10_000), flagged,
    reasons: reasons(f).join('; '), investigated, outcome, contradicted, clusterHash: hashReuse ? hash : '', crossCompany, simHour: h, resolveHour, obligationId: 0n, source: 'sim',
  });
  ctx.db.financeSimTruth.insert({ claimId: claim.id, archetype: d.archetype, fraud: d.fraud, ringId: d.ringId, eventId: d.eventId });
  hour.claims++;
  hour.claimCents += d.cents;
  if (flagged) hour.flags++;
  if (investigated) hour.investigations++;
  if (contradicted) hour.contradicted++;
  if (hashReuse || crossCompany) hour.ringCents += d.cents;
  if (crossCompany && flagged) hour.cross++;
  ctx.db.financeCompanyState.companyId.update({
    ...st, claims: st.claims + 1, claimCents: st.claimCents + BigInt(d.cents), flags: st.flags + (flagged ? 1 : 0), investigations: st.investigations + (investigated ? 1 : 0),
    crossCompanyCatches: st.crossCompanyCatches + (crossCompany && flagged ? 1 : 0),
    delayedByPause: st.delayedByPause + (rung === 'pause' ? 1 : 0), delayHoursSum: st.delayHoursSum + BigInt(rung === 'pause' ? 48 : 0),
  });
  if (outcome === 'pending' && !resolveHour) pay(ctx, rng, claim.id, h, d.fraud);
}

/** A claim the business pays: the tier sets the legs; a split or return-first refund opens an obligation. */
function pay(ctx: Ctx, rng: Rng, claimId: bigint, h: number, fraud: boolean) {
  const cl = ctx.db.financeSimClaim.id.find(claimId)!;
  const c = companyById(cl.companyId)!;
  const st = ctx.db.financeCompanyState.companyId.find(c.id)!;
  const rung = st.rung as Rung;
  const risky = cl.riskBp >= 2_500;
  const tier = cl.cents >= SIM.t3MinCents || (rung === 'hedge' && risky) ? 'T3' : cl.cents <= SIM.t1MaxCents ? 'T1' : 'T2';
  const share = rung === 'hedge' ? POLICY.exposure.hedgeLeg1ShareBp : SIM.leg1ShareBp;
  const leg1 = tier === 'T1' ? cl.cents : tier === 'T2' ? Math.floor((cl.cents * share) / 10_000) : 0;
  const leg2 = cl.cents - leg1;
  const period = hourPeriod(SIM.epochMs, h);
  const post = c.id !== FEATURED; // the featured company's book lives in the worker (DuckDB); its sim claims count, they do not post here
  const base = { companyId: c.id, period, sourceRef: `sim:${claimId}`, decisionRef: `sim-decision:${claimId}`, formulaVersion: `sim-${tier}`, evidenceIds: '', processorRef: `ch_sim_${claimId}` };
  if (post && leg1 > 0) {
    bookImpl(ctx, { ...base, kind: 'leg1_authorized', cents: leg1, memo: `${tier} leg 1 authorized` }, ENGINE, ACCOUNTANT);
    bookImpl(ctx, { ...base, kind: 'leg1_settled', cents: leg1, memo: `${tier} leg 1 settled` }, ENGINE, ACCOUNTANT);
  }
  let obligationId = 0n;
  if (post && leg2 > 0) {
    obligationId = openObligationImpl(ctx, {
      companyId: c.id, orderRef: `sim-order:${claimId}`, claimRef: `sim:${claimId}`, decisionRef: base.decisionRef, tier, category: c.category, sku: cl.sku,
      leg1Cents: leg1, leg2Cents: leg2, costCents: Math.floor((cl.cents * SIM.costShareBp) / 10_000), openedHour: h,
    }, ENGINE);
    planReturn(ctx, rng, obligationId, h, fraud);
  }
  ctx.db.financeSimClaim.id.update({ ...cl, tier, outcome: 'paid', obligationId });
  ctx.db.financeCompanyState.companyId.update({
    ...st, refundedCents: st.refundedCents + BigInt(leg1), cashCents: st.cashCents - BigInt(leg1),
    openObligations: st.openObligations + (obligationId ? 1 : 0), openLeg2Cents: st.openLeg2Cents + BigInt(obligationId ? leg2 : 0),
    unrecoveredLeg1Cents: st.unrecoveredLeg1Cents + BigInt(obligationId ? leg1 : 0),
  });
}

function planReturn(ctx: Ctx, rng: Rng, obligationId: bigint, h: number, fraud: boolean) {
  const due = h + POLICY.leg2.clockDays * 24;
  const roll = rng.next() * 10_000;
  let outcome: ReturnOutcome = 'missing';
  let at = due;
  if (fraud) {
    if (roll < SIM.fraudReturn.intactBp) { outcome = 'intact'; at = h + rng.int(48, 20 * 24); }
    else if (roll < SIM.fraudReturn.intactBp + SIM.fraudReturn.swapBp) { outcome = 'partial'; at = h + rng.int(48, 18 * 24); }
  } else if (roll < SIM.legitReturn.intactBp) { outcome = 'intact'; at = h + rng.int(24, 20 * 24); }
  else if (roll < SIM.legitReturn.intactBp + SIM.legitReturn.lateBp) { outcome = 'lapsed'; at = due; }
  ctx.db.financeReturnPlan.insert({ obligationId, hour: Math.min(at, due), outcome: at > due ? 'lapsed' : outcome });
}

function closeObligation(ctx: Ctx, obligationId: bigint, outcome: ReturnOutcome, h: number) {
  const o = ctx.db.financeObligation.id.find(obligationId);
  if (!o || o.status !== 'open') return;
  applyReturnImpl(ctx, obligationId, outcome, h, SIM.epochMs, ACCOUNTANT);
  const st = ctx.db.financeCompanyState.companyId.find(o.companyId)!;
  const paid = outcome === 'intact' ? o.leg2Cents : 0;
  ctx.db.financeCompanyState.companyId.update({
    ...st, openObligations: Math.max(0, st.openObligations - 1), openLeg2Cents: st.openLeg2Cents - BigInt(Math.min(Number(st.openLeg2Cents), o.leg2Cents)),
    unrecoveredLeg1Cents: st.unrecoveredLeg1Cents - BigInt(Math.min(Number(st.unrecoveredLeg1Cents), o.leg1Cents)),
    refundedCents: st.refundedCents + BigInt(paid), cashCents: st.cashCents - BigInt(paid),
  });
}

function resolveClaim(ctx: Ctx, rng: Rng, seed: bigint, claimId: bigint, h: number, hourOf: (companyId: number) => Hour) {
  const cl = ctx.db.financeSimClaim.id.find(claimId);
  if (!cl || (cl.outcome !== 'pending' && cl.outcome !== 'review')) return;
  const truth = ctx.db.financeSimTruth.claimId.find(claimId);
  const fraud = !!truth?.fraud;
  const st = ctx.db.financeCompanyState.companyId.find(cl.companyId)!;
  if (cl.outcome === 'review' && st.rung === 'pause') { ctx.db.financeSimClaim.id.update({ ...cl, resolveHour: h + 24 }); ctx.db.financeCompanyState.companyId.update({ ...st, delayHoursSum: st.delayHoursSum + 24n }); return; }
  const verified = fraud && (cl.investigated || cl.outcome === 'review') && bp(rng, SIM.verifyFraudBp);
  if (verified) {
    ctx.db.financeSimClaim.id.update({ ...cl, outcome: 'verified_fraud' });
    const ringLinked = !!truth?.ringId && truth.ringId > 0;
    ctx.db.financeVouchLedger.insert({ id: 0n, shopperHash: `s${hashStr(`${seed}:shopper:${cl.agentId}`)}`, companyId: cl.companyId, outcome: ringLinked ? 'ring_linked' : 'verified', scoreDelta: -40, evidenceHash: `e${hashStr(`${seed}:claim:${claimId}`)}`, simHour: h });
    const hash = cl.clusterHash || `d${hashStr(`${seed}:${cl.agentId}`)}`;
    const sig = ctx.db.financeVouchSignal.hash.find(hash);
    if (sig) ctx.db.financeVouchSignal.hash.update({ ...sig, hits: sig.hits + 1 });
    else ctx.db.financeVouchSignal.insert({ hash, companyId: cl.companyId, simHour: h, hits: 1 });
    hourOf(cl.companyId).verifiedFraud++;
    ctx.db.financeCompanyState.companyId.update({ ...st, verifiedFraud: st.verifiedFraud + 1 });
    return;
  }
  if (cl.tier === 'T4' && fraud && bp(rng, 7_000)) { ctx.db.financeSimClaim.id.update({ ...cl, outcome: 'abandoned' }); return; }
  if (cl.flagged && !fraud && cl.investigated) {
    ctx.db.financeCompanyState.companyId.update({ ...st, falseFlags: st.falseFlags + 1 });
    ctx.db.financeVouchLedger.insert({ id: 0n, shopperHash: `s${hashStr(`${seed}:shopper:${cl.agentId}`)}`, companyId: cl.companyId, outcome: 'cleared', scoreDelta: 0, evidenceHash: `e${hashStr(`${seed}:claim:${claimId}`)}`, simHour: h });
  }
  pay(ctx, rng, claimId, h, fraud);
}

function salesSummary(ctx: Ctx, c: CompanyDef, h: number) {
  let orderCents = 0;
  for (const row of ctx.db.financeStatsHourly.companyId.filter(c.id)) if (row.simHour >= h - 24 && row.simHour < h) orderCents += Number(row.orderCents);
  if (!orderCents) return;
  const cost = Math.floor((orderCents * SIM.costShareBp) / 10_000);
  const fee = Math.floor((orderCents * SIM.feeBp) / 10_000);
  const period = hourPeriod(SIM.epochMs, h - 1);
  bookImpl(ctx, { companyId: c.id, kind: 'sales_summary', cents: orderCents, period, memo: `Daily sales summary (processor batch), day ${Math.floor((h - 1) / 24)}`, sourceRef: `sales:${c.id}:${Math.floor((h - 1) / 24)}`, decisionRef: '', formulaVersion: '', evidenceIds: '', processorRef: `po_sim_${c.id}_${Math.floor((h - 1) / 24)}` }, ENGINE, ACCOUNTANT, {
    lines: [
      { account: '1010', debit: orderCents, credit: 0 }, { account: '4000', debit: 0, credit: orderCents },
      { account: '5000', debit: cost, credit: 0 }, { account: '1200', debit: 0, credit: cost },
      { account: '5100', debit: fee, credit: 0 }, { account: '1010', debit: 0, credit: fee },
    ],
  });
  const st = ctx.db.financeCompanyState.companyId.find(c.id)!;
  ctx.db.financeCompanyState.companyId.update({ ...st, cashCents: st.cashCents + BigInt(orderCents - fee) });
}

/** The six exposure signals for one company, in basis points, from its own rows. */
export function signalsFor(ctx: Ctx, companyId: number, h: number): Signals {
  const s = zeroSignals();
  let c24 = 0, cc24 = 0, oc24 = 0, con24 = 0, ring24 = 0, cc168 = 0, oc168 = 0;
  for (const r of ctx.db.financeStatsHourly.companyId.filter(companyId)) {
    if (r.simHour > h || r.simHour <= h - 168) continue;
    cc168 += Number(r.claimCents);
    oc168 += Number(r.orderCents);
    if (r.simHour > h - 24) { c24 += r.claims; cc24 += Number(r.claimCents); oc24 += Number(r.orderCents); con24 += r.contradicted; ring24 += Number(r.ringCents); }
  }
  if (c24 >= SIM.minClaims24h && oc24 > 0 && cc168 > 0 && oc168 > 0) s.refund_share_vs_baseline = Math.round(((cc24 / oc24) / (cc168 / oc168)) * 10_000);
  if (c24 >= SIM.minClaims24h) {
    s.contradicted_rate = Math.round((con24 / c24) * 10_000);
    s.ring_concentration = cc24 ? Math.round((ring24 / cc24) * 10_000) : 0;
  }
  const st = ctx.db.financeCompanyState.companyId.find(companyId);
  if (st && st.cashCents > 0n) s.leg1_exposure_vs_cash = Math.round((Number(st.unrecoveredLeg1Cents) / Number(st.cashCents)) * 10_000);
  const res = [...ctx.db.financeReserve.companyId.filter(companyId)].filter((r) => r.resolvedAccruedCents > 0n).sort((a, b) => Number(b.id - a.id))[0];
  if (res && res.trueUpCents > 0n) s.reserve_shortfall = Math.round((Number(res.trueUpCents) / Number(res.resolvedAccruedCents)) * 10_000);
  let open = 0, late = 0;
  for (const o of ctx.db.financeObligation.companyId.filter(companyId)) {
    if (o.status !== 'open') continue;
    open++;
    if (h - o.openedHour > (POLICY.leg2.clockDays * 24) / 2) late++;
  }
  if (open >= 5) s.obligations_past_half = Math.round((late / open) * 10_000);
  return s;
}

function exposureCheck(ctx: Ctx, h: number) {
  for (const c of COMPANIES) {
    const st = ctx.db.financeCompanyState.companyId.find(c.id)!;
    const saved = JSON.parse(st.signalsJson || '{}') as { now?: Signals; prev?: Signals | null; pausePending?: boolean; checks?: { hour: number; signals: Signals; evidence_ids: string[] }[] };
    const now = signalsFor(ctx, c.id, h);
    const prev = saved.now ?? undefined;
    const source = [...ctx.db.financeStatsHourly.simHour.filter(h)].find((row) => row.companyId === c.id);
    const checks = [...(saved.checks ?? []), { hour: h, signals: now, evidence_ids: source ? [String(source.id)] : [] }].slice(-6);
    const step = codeStep(st.rung as Rung, st.rungSinceHour, h, now, prev);
    let pausePending = !!saved.pausePending && st.rung === 'hedge';
    if (step.pausePending && !pausePending) {
      pausePending = true;
      ctx.db.financeQueue.insert({
        id: 0n, companyId: c.id, kind: 'pause_confirm', title: `${c.name}: pause new refund payouts? (code proposes; you confirm)`,
        detailJson: JSON.stringify({ signals: now, reason: step.reason, expiresInHours: POLICY.exposure.expiryHours.pause, nobodyDenied: 'Claims are recorded; customers are told their refund is under review and when to expect an update; approved refunds are still paid.' }),
        targetRef: `exposure:${c.id}`, status: 'open', answer: '', reason: '', requestedBy: SIM_ENGINE, decidedBy: undefined, precedentId: 0n, at: ctx.timestamp, decidedAt: undefined,
      });
      ctx.db.financeExposureLog.insert({ id: 0n, companyId: c.id, fromRung: st.rung, toRung: 'pause_proposed', by: 'code', reason: step.reason, signalsJson: JSON.stringify(now), simHour: h, at: ctx.timestamp });
    }
    if (step.next !== st.rung) {
      ctx.db.financeExposureLog.insert({ id: 0n, companyId: c.id, fromRung: st.rung, toRung: step.next, by: 'code', reason: step.reason, signalsJson: JSON.stringify(now), simHour: h, at: ctx.timestamp });
      if (RUNGS.indexOf(step.next) < RUNGS.indexOf('hedge')) pausePending = false;
    }
    ctx.db.financeCompanyState.companyId.update({
      ...st, rung: step.next, rungSinceHour: step.next !== st.rung ? h : st.rungSinceHour, signalsJson: JSON.stringify({ now, prev: prev ?? null, pausePending, checks }), updatedHour: h,
    });
  }
}

function hourStep(ctx: Ctx, rng: Rng, seed: bigint, h: number): number {
  let rows = 0;
  const hours = new Map<number, Hour>();
  const hourOf = (id: number) => { let x = hours.get(id); if (!x) { x = emptyHour(); hours.set(id, x); } return x; };
  // 1. returns arriving now, and clocks running out
  for (const p of [...ctx.db.financeReturnPlan.hour.filter(h)]) { closeObligation(ctx, p.obligationId, p.outcome as ReturnOutcome, h); ctx.db.financeReturnPlan.obligationId.delete(p.obligationId); rows += 3; }
  for (const o of [...ctx.db.financeObligation.dueHour.filter(h)]) if (o.status === 'open') { closeObligation(ctx, o.id, 'lapsed', h); rows++; }
  // 2. claims whose investigation, evidence request or pause hold ends now
  for (const cl of [...ctx.db.financeSimClaim.resolveHour.filter(h)]) { resolveClaim(ctx, rng, seed, cl.id, h, hourOf); rows += 2; }
  // 3. new orders and claims
  const date = new Date(SIM.epochMs + h * 3_600_000);
  const shape = DOW[date.getUTCDay()]! * HOUR_CURVE[date.getUTCHours()]!;
  const events = activeEvents(ctx, h);
  const population = ctx.db.simRun.id.find(1)?.population || 10_000;
  for (const c of COMPANIES) {
    const cat = COMPANY_CATEGORIES[c.category]!;
    const mine = events.filter((e) => e.companyId === c.id);
    const mult = mine.find((e) => e.kind === 'sale_day')?.params.mult ?? 1;
    const hour = hourOf(c.id);
    const orders = draw(rng, (SIM.ordersPerMonth / (30 * 24)) * (c.size / SUM_SIZE) * shape * mult);
    for (let i = 0; i < orders; i++) {
      const p = c.products[rng.int(0, 3)]!;
      hour.orders++;
      hour.orderCents += p.priceCents;
      const buyer = agentScore(ctx, rng.int(1, population));
      hour.scoreSum += buyer.score;
      hour.scoreN++;
    }
    const claims = draw(rng, (SIM.ordersPerMonth / (30 * 24)) * (c.size / SUM_SIZE) * shape * mult * (cat.claimRateBp / 10_000));
    for (let i = 0; i < claims; i++) {
      const agentId = rng.int(1, population);
      const kind = agentScore(ctx, agentId).kind;
      const fraud = bp(rng, SIM.fraudShareBp * (cat.fraudSusceptibilityPct / AVG_SUSC) * (SIM.kindFraudMult[kind] ?? 1));
      const persona = SIM.legitPersonas[rng.int(0, SIM.legitPersonas.length - 1)]!;
      const archetype = fraud ? SIM.fraudArchetypes[rng.int(0, SIM.fraudArchetypes.length - 1)]! : persona;
      const p = c.products[rng.int(0, 3)]!;
      fileClaim(ctx, rng, seed, c, { agentId, sku: p.sku, cents: p.priceCents, fraud, archetype, ringId: 0, eventId: 0n }, h, hour);
      rows += 3;
    }
    for (const e of mine) {
      if (e.kind === 'ring') {
        const n = draw(rng, e.params.claimsPerHour ?? 2);
        const sku = e.params.sku ?? topSku(c);
        const price = c.products.find((p) => p.sku === sku)?.priceCents ?? c.products[0]!.priceCents;
        for (let i = 0; i < n; i++) {
          const agents = e.params.agents ?? [1];
          fileClaim(ctx, rng, seed, c, { agentId: agents[rng.int(0, agents.length - 1)]!, sku, cents: price, fraud: true, archetype: 'ring', ringId: e.params.ringId ?? 1, eventId: e.id, hash: e.params.hash, contradictedBp: SIM.contradictedBp.ring }, h, hour);
          rows += 3;
        }
      } else if (e.kind === 'defect_batch') {
        const n = draw(rng, e.params.claimsPerHour ?? 2);
        const sku = e.params.sku ?? c.products[0]!.sku;
        const price = c.products.find((p) => p.sku === sku)?.priceCents ?? c.products[0]!.priceCents;
        for (let i = 0; i < n; i++) {
          fileClaim(ctx, rng, seed, c, { agentId: rng.int(1, population), sku, cents: price, fraud: false, archetype: 'honest_damage', ringId: 0, eventId: e.id, contradictedBp: 0 }, h, hour);
          rows += 3;
        }
      }
    }
  }
  // 4. hourly rows, rollups, and the 7-day window
  for (const [companyId, x] of hours) {
    ctx.db.financeStatsHourly.insert({
      id: 0n, companyId, simHour: h, orders: x.orders, orderCents: BigInt(x.orderCents), claims: x.claims, claimCents: BigInt(x.claimCents), flags: x.flags,
      investigations: x.investigations, verifiedFraud: x.verifiedFraud, contradicted: x.contradicted, ringCents: BigInt(x.ringCents), crossCompanyCatches: x.cross,
      scoreSum: x.scoreSum, scoreN: x.scoreN,
    });
    const st = ctx.db.financeCompanyState.companyId.find(companyId)!;
    ctx.db.financeCompanyState.companyId.update({ ...st, orders: st.orders + x.orders, orderCents: st.orderCents + BigInt(x.orderCents), scoreSum: st.scoreSum + BigInt(x.scoreSum), scoreN: st.scoreN + x.scoreN, updatedHour: h });
    rows += 2;
  }
  for (const old of [...ctx.db.financeStatsHourly.simHour.filter(h - 169)]) ctx.db.financeStatsHourly.id.delete(old.id);
  // 5. daily sales journal, month-end close for lite companies, exposure checks
  if (h > 0 && h % 24 === 0) for (const c of COMPANIES) if (c.id !== FEATURED) { salesSummary(ctx, c, h); rows += 7; }
  if (h > 0 && hourPeriod(SIM.epochMs, h) !== hourPeriod(SIM.epochMs, h - 1)) {
    const prevMonth = hourPeriod(SIM.epochMs, h - 1);
    for (const c of COMPANIES) if (c.id !== FEATURED) closeLiteImpl(ctx, c.id, prevMonth, ENGINE, ACCOUNTANT);
  }
  if (h % POLICY.exposure.checkEveryHours === 0) exposureCheck(ctx, h);
  return rows;
}

export function advanceImpl(ctx: Ctx, hours: number) {
  const s = state(ctx);
  const rng = new Rng(s.rngState);
  let rows = 0;
  let h = s.simHour;
  for (let i = 0; i < hours; i++) { h++; rows += hourStep(ctx, rng, s.seed, h); }
  ctx.db.financeSimState.id.update({ ...s, simHour: h, rngState: rng.state, ticks: s.ticks + 1n, rowsLastTick: rows, lastTickMs: BigInt(Number(ctx.timestamp.microsSinceUnixEpoch / 1000n)) });
}

// ---------------------------------------------------------------- reducers

const actorOf = (ctx: Ctx): Actor => ({ who: ctx.sender, role: roleOf(ctx)?.role ?? 'none' });
const allow = (ctx: Ctx, target: string, ...roles: string[]) => {
  const a = actorOf(ctx);
  if (roles.includes(a.role)) return a;
  audit(ctx, 0, 'ROLE', a, target, `requires ${roles.join(' or ')}`);
  return null;
};

export const financeSeedPortfolio = spacetimedb.reducer({ seed: t.u64(), force: t.bool() }, (ctx, a) => {
  if (!allow(ctx, 'portfolio', 'worker')) return;
  if (ctx.db.financeSimState.id.find(1)?.seeded && !a.force) return audit(ctx, 0, 'ALREADY_SEEDED', actorOf(ctx), 'portfolio', 'the portfolio is already seeded; pass force to reseed', false);
  seedPortfolioImpl(ctx, a.seed);
});

/** Advance by whole simulated hours in one transaction (the prewarm calls this in chunks). */
export const financeAdvance = spacetimedb.reducer({ hours: t.u32() }, (ctx, a) => {
  if (!allow(ctx, 'portfolio', 'worker')) return;
  advanceImpl(ctx, Math.min(a.hours, 72));
});

export const financeTick = spacetimedb.reducer({ onSchedule: financeTickSchedule }, { scheduledMessage: financeTickSchedule.rowType }, (ctx) => {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) return;
  const s = ctx.db.financeSimState.id.find(1);
  if (!s?.running) return;
  advanceImpl(ctx, s.hoursPerTick);
});

/** Play, pause and speed: 1x is one simulated hour per tick; Turbo batches 24. */
export const financeSetRunning = spacetimedb.reducer({ running: t.bool(), hoursPerTick: t.u8() }, (ctx, a) => {
  if (!allow(ctx, 'portfolio', 'worker', 'controller')) return;
  const s = ctx.db.financeSimState.id.find(1);
  if (!s) return;
  ctx.db.financeSimState.id.update({ ...s, running: a.running, hoursPerTick: Math.max(1, Math.min(SIM.turboHours, a.hoursPerTick)) });
  for (const row of [...ctx.db.financeTickSchedule.iter()]) ctx.db.financeTickSchedule.scheduledId.delete(row.scheduledId);
  if (a.running) ctx.db.financeTickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(SIM.tickMs) * 1000n) });
});

/** Scenario console: inject a ring, a sale day or a defect batch at a company, starting now. */
export const financeInjectEvent = spacetimedb.reducer({ kind: t.string(), companyId: t.u16(), hours: t.u32() }, (ctx, a) => {
  const who = allow(ctx, `company:${a.companyId}`, 'worker', 'controller');
  if (!who) return;
  const c = companyById(a.companyId);
  const s = ctx.db.financeSimState.id.find(1);
  if (!c || !s || !['ring', 'sale_day', 'defect_batch'].includes(a.kind)) return audit(ctx, a.companyId, 'SCENARIO_REFUSED', who, `company:${a.companyId}`, 'unknown company or scenario kind');
  const rings = [...ringAgents(ctx).entries()];
  const [ringId, agents] = rings.length ? rings[Number(s.simHour) % rings.length]! : [1, [1, 2, 3]];
  const params: EventParams = a.kind === 'ring' ? { claimsPerHour: 2.5, agents, ringId, hash: `ring-${ringId}-${a.companyId}-${s.simHour}`, sku: topSku(c) }
    : a.kind === 'sale_day' ? { mult: 4 } : { claimsPerHour: 2, sku: c.products[0]!.sku };
  plantEvent(ctx, a.kind, [a.companyId], s.simHour + 1, Math.max(6, Math.min(72, a.hours)), params, 'console');
  audit(ctx, a.companyId, 'SCENARIO_INJECTED', who, `company:${a.companyId}`, `${a.kind} for ${a.hours} h from hour ${s.simHour + 1}`, false);
});

/** The company's controller confirms a Pause the code proposed. */
export const financeConfirmPause = spacetimedb.reducer({ companyId: t.u16(), confirm: t.bool(), reason: t.string() }, (ctx, a) => {
  const who = actorOf(ctx);
  const target = `exposure:${a.companyId}`;
  if (who.role !== 'controller') return audit(ctx, a.companyId, 'ROLE', who, target, 'only the controller confirms a pause');
  const q = [...ctx.db.financeQueue.companyId.filter(a.companyId)].find((x) => x.kind === 'pause_confirm' && x.status === 'open');
  const st = ctx.db.financeCompanyState.companyId.find(a.companyId);
  const s = ctx.db.financeSimState.id.find(1);
  if (!q || !st || !s) return audit(ctx, a.companyId, 'NO_PROPOSAL', who, target, 'no pause is proposed for this company');
  if (!a.confirm && a.reason.trim().length < 5) return audit(ctx, a.companyId, 'REASON_REQUIRED', who, target, 'declining a pause needs a reason');
  ctx.db.financeQueue.id.update({ ...q, status: a.confirm ? 'approved' : 'rejected', reason: a.reason, decidedBy: who.who, decidedAt: ctx.timestamp });
  const saved = JSON.parse(st.signalsJson || '{}') as Record<string, unknown>;
  if (a.confirm) {
    ctx.db.financeCompanyState.companyId.update({ ...st, rung: 'pause', rungSinceHour: s.simHour, signalsJson: JSON.stringify({ ...saved, pausePending: false }) });
    ctx.db.financeExposureLog.insert({ id: 0n, companyId: a.companyId, fromRung: st.rung, toRung: 'pause', by: 'controller', reason: a.reason || 'Controller confirmed the proposed pause', signalsJson: JSON.stringify(saved.now ?? {}), simHour: s.simHour, at: ctx.timestamp });
  } else {
    ctx.db.financeCompanyState.companyId.update({ ...st, signalsJson: JSON.stringify({ ...saved, pausePending: false }) });
    ctx.db.financeExposureLog.insert({ id: 0n, companyId: a.companyId, fromRung: st.rung, toRung: st.rung, by: 'controller', reason: `Pause declined: ${a.reason}`, signalsJson: JSON.stringify(saved.now ?? {}), simHour: s.simHour, at: ctx.timestamp });
  }
});

/** The Guardian's proposal is validated and applied only inside the reducer. */
export function financeRecordGuardianImpl(ctx: Ctx, a: { companyId: number; proposedRung: string; reason: string; customerNotice: string; expiresInHours: number; runId: string; mode: string }) {
  const who = allow(ctx, `exposure:${a.companyId}`, 'analyst', 'worker');
  if (!who) return;
  const st = ctx.db.financeCompanyState.companyId.find(a.companyId);
  const s = ctx.db.financeSimState.id.find(1);
  if (!st || !s) return;
  const saved = JSON.parse(st.signalsJson || '{}') as { now?: Signals; prev?: Signals | null; pausePending?: boolean };
  const allowedR = allowedFor(st.rung as Rung, saved.now ?? zeroSignals(), saved.prev ?? undefined);
  const accepted = allowedR.includes(a.proposedRung as Rung);
  if (!accepted) audit(ctx, a.companyId, 'GUARDIAN_OUT_OF_BOUNDS', who, `exposure:${a.companyId}`, `proposed ${a.proposedRung}; allowed: ${allowedR.join(', ')}`);
  if (accepted) {
    const expiry = a.proposedRung === 'hedge' || a.proposedRung === 'pause' ? POLICY.exposure.expiryHours[a.proposedRung] : POLICY.exposure.expiryHours.watch;
    if (a.expiresInHours !== expiry) return audit(ctx, a.companyId, 'GUARDIAN_EXPIRY', who, `exposure:${a.companyId}`, `expiry ${a.expiresInHours} does not match ${a.proposedRung} policy (${expiry} h)`);
    if (!/under review/i.test(a.customerNotice) || !new RegExp(`\\b(?:within|in)\\s+${a.expiresInHours}\\s+hours?\\b`, 'i').test(a.customerNotice) || /\b(denied|declined|rejected)\b/i.test(a.customerNotice)) {
      return audit(ctx, a.companyId, 'GUARDIAN_NOTICE', who, `exposure:${a.companyId}`, 'notice must preserve the customer refund and state the configured update time');
    }
  }
  const row = { companyId: a.companyId, proposedRung: a.proposedRung, allowedJson: JSON.stringify(allowedR), reason: a.reason.slice(0, 1000), customerNotice: a.customerNotice.slice(0, 1000), expiresInHours: a.expiresInHours, runId: a.runId, mode: a.mode, accepted, simHour: s.simHour };
  if (ctx.db.financeExposureProposal.companyId.find(a.companyId)) ctx.db.financeExposureProposal.companyId.update(row);
  else ctx.db.financeExposureProposal.insert(row);
  if (!accepted || a.proposedRung === st.rung) return;
  if (a.proposedRung === 'pause') {
    if (!saved.pausePending) {
      ctx.db.financeQueue.insert({
        id: 0n, companyId: a.companyId, kind: 'pause_confirm', title: `Company ${a.companyId}: confirm the Exposure Guardian's pause proposal`,
        detailJson: JSON.stringify({ reason: a.reason, customerNotice: a.customerNotice, expiryHours: a.expiresInHours, signals: saved.now ?? zeroSignals(), nobodyDenied: true }),
        targetRef: `exposure:${a.companyId}`, status: 'open', answer: '', reason: '', requestedBy: who.who, decidedBy: undefined, precedentId: 0n, at: ctx.timestamp, decidedAt: undefined,
      });
      ctx.db.financeExposureLog.insert({ id: 0n, companyId: a.companyId, fromRung: st.rung, toRung: 'pause_proposed', by: 'guardian', reason: a.reason.slice(0, 1000), signalsJson: JSON.stringify(saved.now ?? zeroSignals()), simHour: s.simHour, at: ctx.timestamp });
    }
    ctx.db.financeCompanyState.companyId.update({ ...st, signalsJson: JSON.stringify({ ...saved, pausePending: true }) });
    return;
  }
  ctx.db.financeCompanyState.companyId.update({ ...st, rung: a.proposedRung, rungSinceHour: s.simHour, signalsJson: JSON.stringify({ ...saved, pausePending: false }) });
  ctx.db.financeExposureLog.insert({ id: 0n, companyId: a.companyId, fromRung: st.rung, toRung: a.proposedRung, by: 'guardian', reason: a.reason.slice(0, 1000), signalsJson: JSON.stringify(saved.now ?? zeroSignals()), simHour: s.simHour, at: ctx.timestamp });
}

export const financeRecordGuardian = spacetimedb.reducer({
  companyId: t.u16(), proposedRung: t.string(), reason: t.string(), customerNotice: t.string(), expiresInHours: t.u32(), runId: t.string(), mode: t.string(),
}, (ctx, a) => financeRecordGuardianImpl(ctx, a));

