// The simulated shopping economy: rules, not LLMs. Ten thousand agents make
// cheap deterministic decisions; the AI is spent where judgement is needed.
//
// Everything here runs against SimDb, so the same code is the scheduled
// reducer inside SpacetimeDB (ctx.db) and the in-memory world the detector
// evaluator grows (memdb.ts). It must not import spacetimedb.
import { Rng, hash32, unitHash } from './rng';
import { BUSINESSES, CATALOG, REGIONS, businessDef, catalogItem, itemsIn, regionById, type Policy } from './world';
import {
  CREDIT, INACTIVE_DAYS, KEPT_CAP_PER_WINDOW, KEPT_WINDOW_DAYS, SERIAL_RATIO, SERIAL_WINDOW_DAYS, START_SCORE, LIVE_START_SCORE,
  bandOf, bucketOf, clampScore,
} from './score';
import { falseDefectText, honestClaimText, ringClaimText, type ReasonCode } from './text';
import type { AgentRow, BusinessRow, MerchantFlowDayRow, PurchaseRow, RefundRow, RegionStatRow, SimDb, SimRunRow } from './simdb';
import { ALL_MERCHANTS_FLOW_ID } from './simdb';

export const FEED_SLOTS = 512;
export const SHOWCASE_AGENT_ID = 421;
/** The live economy starts on this day so the showcase agent has a real, simulated past. */
export const HISTORY_DAYS = 120;
export const LIVE_AGENT_BASE = 900_000;
export const DEFAULT_POPULATION = 10_000;
export const DEFAULT_AGENTS_PER_TICK = 1_000;
export const DEFAULT_TICK_MICROS = 200_000n;
export const DEFAULT_MAX_DAY = 1500;
const RING_BURST_PERIOD = 60;
export const AGENT_JITTER_DEG = 3;
const ELECTRONICS_BUSINESSES = BUSINESSES.filter((b) => b.category === 'electronics').map((b) => b.id);

export type Kind = 'honest' | 'opportunist' | 'serial' | 'ring' | 'live' | 'showcase';
export const KINDS: readonly Kind[] = ['honest', 'opportunist', 'serial', 'ring'];
const KIND_SHARE = [0.82, 0.1, 0.05, 0.03];
const BUY_RATE: Record<Kind, number> = { honest: 0.025, opportunist: 0.06, serial: 0.07, ring: 0.025, live: 0, showcase: 0 };

export const agentLabel = (id: number) => `A-${String(id).padStart(5, '0')}`;
export const businessLabel = (id: number) => `B-${String(id).padStart(3, '0')}`;
export const patternLabel = (id: number) => `FR-${String(id).padStart(3, '0')}`;
export const refundLabel = (id: bigint | number) => `R-${id}`;
export const purchaseLabel = (id: bigint | number) => `P-${id}`;
export const creditLabel = (id: bigint | number) => `CE-${id}`;
export const dollars = (cents: number | bigint) => `$${(Number(cents) / 100).toFixed(2)}`;

export interface StepResult { steps: number; events: number; dayEnded: number | null }

/**
 * A unit of work against the database. Caches the rows a tick touches many
 * times (agents, businesses, region stats, the policy JSON) and writes them
 * once in commit(), so one tick is one tidy transaction.
 */
export class World {
  rng: Rng;
  events = 0;
  private agents = new Map<number, AgentRow>();
  private dirtyAgents = new Set<number>();
  private businesses = new Map<number, BusinessRow>();
  private dirtyBusinesses = new Set<number>();
  private stats = new Map<number, RegionStatRow>();
  private dirtyStats = new Set<number>();
  private flows = new Map<string, MerchantFlowDayRow>();
  private dirtyFlows = new Set<string>();
  private policies = new Map<number, Policy>();

  constructor(readonly db: SimDb, public run: SimRunRow) {
    this.rng = new Rng(run.rngState);
  }

  static open(db: SimDb): World {
    const run = db.simRun.id.find(1);
    if (!run) throw new Error('simulation not initialised');
    return new World(db, run);
  }

  get day() {
    return this.run.day;
  }

  agent(id: number): AgentRow {
    let a = this.agents.get(id);
    if (!a) {
      a = this.db.agent.id.find(id);
      if (!a) throw new Error(`no agent ${agentLabel(id)}`);
      this.agents.set(id, a);
    }
    return a;
  }

  touchAgent(a: AgentRow) {
    this.agents.set(a.id, a);
    this.dirtyAgents.add(a.id);
  }

  business(id: number): BusinessRow {
    let b = this.businesses.get(id);
    if (!b) {
      b = this.db.business.id.find(id);
      if (!b) throw new Error(`no business ${businessLabel(id)}`);
      this.businesses.set(id, b);
    }
    return b;
  }

  touchBusiness(b: BusinessRow) {
    this.businesses.set(b.id, b);
    this.dirtyBusinesses.add(b.id);
  }

  stat(regionId: number): RegionStatRow {
    let s = this.stats.get(regionId);
    if (!s) {
      s = this.db.regionStat.regionId.find(regionId);
      if (!s) throw new Error(`no region ${regionId}`);
      this.stats.set(regionId, s);
    }
    this.dirtyStats.add(regionId);
    return s;
  }

  /** Load or create a day bucket for one merchant (or the all-merchants rollup). */
  flow(businessId: number): MerchantFlowDayRow {
    const key = `${businessId}:${this.day}`;
    let row = this.flows.get(key);
    if (!row) {
      row = this.db.merchantFlowDay.key.find(key);
      if (!row) {
        row = this.db.merchantFlowDay.insert({
          key, businessId, day: this.day, purchaseCents: 0n, refundPaidCents: 0n, purchases: 0, refundsPaid: 0,
        });
      }
      this.flows.set(key, row);
    }
    this.dirtyFlows.add(key);
    return row;
  }

  /** Purchase inflow or accepted-refund outflow — both merchant and all-merchants buckets. */
  bumpFlow(businessId: number, kind: 'purchase' | 'refund_paid', cents: number) {
    for (const id of [businessId, ALL_MERCHANTS_FLOW_ID]) {
      const row = this.flow(id);
      if (kind === 'purchase') {
        row.purchaseCents += BigInt(cents);
        row.purchases += 1;
      } else {
        row.refundPaidCents += BigInt(cents);
        row.refundsPaid += 1;
      }
    }
  }

  policy(businessId: number): Policy {
    let p = this.policies.get(businessId);
    if (!p) {
      p = JSON.parse(this.business(businessId).policy) as Policy;
      this.policies.set(businessId, p);
    }
    return p;
  }

  kind(agentId: number): Kind {
    return (this.db.agentTruth.agentId.find(agentId)?.kind ?? 'live') as Kind;
  }

  /** Append to the 512-slot live event ring. */
  feed(kind: string, agentId: number, businessId: number, amount: number, refId: bigint, line: string) {
    const seq = this.run.eventSeq;
    this.run.eventSeq = seq + 1n;
    const slot = Number(seq % BigInt(FEED_SLOTS));
    const row = { slot, seq, day: this.run.day, kind, agentId, businessId, amount, refId, line };
    if (this.db.eventFeed.slot.find(slot)) this.db.eventFeed.slot.update(row);
    else this.db.eventFeed.insert(row);
  }

  commit() {
    for (const id of this.dirtyAgents) this.db.agent.id.update(this.agents.get(id)!);
    for (const id of this.dirtyBusinesses) this.db.business.id.update(this.businesses.get(id)!);
    for (const id of this.dirtyStats) this.db.regionStat.regionId.update(this.stats.get(id)!);
    for (const key of this.dirtyFlows) this.db.merchantFlowDay.key.update(this.flows.get(key)!);
    this.dirtyAgents.clear();
    this.dirtyBusinesses.clear();
    this.dirtyStats.clear();
    this.dirtyFlows.clear();
    this.run.rngState = this.rng.state;
    this.db.simRun.id.update(this.run);
  }
}

// ---------------------------------------------------------------- credit

/**
 * The one place a score changes. Clamps to 0..1000, writes a credit_event
 * with its cause, moves the agent between histogram buckets and tells the feed.
 * A score that changed without a credit_event row is a bug.
 */
export function applyCredit(w: World, agentId: number, kind: string, delta: number, causeTable: string, causeId: bigint, feed = true) {
  const a = w.agent(agentId);
  const before = a.score;
  const after = clampScore(before + delta);
  if (after === before) return null;
  const ev = w.db.creditEvent.insert({ id: 0n, agentId, day: w.day, kind, delta: after - before, before, after, causeTable, causeId });
  a.score = after;
  a.band = bandOf(after);
  w.touchAgent(a);
  const s = w.stat(a.region);
  const hist = [...s.scoreHist];
  hist[bucketOf(before)] = Math.max(0, hist[bucketOf(before)]! - 1);
  hist[bucketOf(after)] = hist[bucketOf(after)]! + 1;
  s.scoreHist = hist;
  w.events++;
  if (feed) w.feed('credit', agentId, 0, 0, ev.id, `[Credit] ${agentLabel(agentId)} ${before} → ${after} (${kind.replaceAll('_', ' ')})`);
  return ev;
}

// ---------------------------------------------------------------- seeding

export interface SeedOpts { seed: bigint; population: number; agentsPerTick?: number; tickMicros?: bigint; maxDay?: number; running?: boolean }

/** Creates regions, businesses, agents (with private truth) and the showcase agent's past. Expects empty tables. */
export function seedWorld(db: SimDb, opts: SeedOpts): SimRunRow {
  const existing = db.simRun.id.find(1);
  if (existing?.seeded) throw new Error('world already seeded (pass force to reseed)');
  const population = opts.population;
  if (population < 500 || population > 200_000) throw new Error('population must be 500 to 200,000');
  const rng = Rng.fromSeed(opts.seed);

  const hist = REGIONS.map(() => new Array<number>(10).fill(0));
  const counts = REGIONS.map(() => 0);
  for (const r of REGIONS) {
    db.regionStat.insert({
      regionId: r.id, name: r.name, lat: r.lat, lng: r.lng, agents: 0, purchases: 0, salesCents: 0n, refundsRequested: 0,
      accepted: 0, declined: 0, pending: 0, lossCents: 0n, honestDeclines: 0, fraudFlags: 0, scoreHist: new Array<number>(10).fill(0),
    });
  }

  for (const b of BUSINESSES) {
    const r = regionById(b.regionId)!;
    db.business.insert({
      id: b.id, name: b.name, region: r.id, lat: r.lat + (unitHash(b.id, 'lat') - 0.5) * 0.6, lng: r.lng + (unitHash(b.id, 'lng') - 0.5) * 0.6,
      category: b.category, balance: 5_000_000n, inventory: 5_000, policy: JSON.stringify(b.policy), issuerPublicKey: '', sales: 0, refundsPaid: 0,
    });
  }

  const regionWeights = REGIONS.map((r) => r.weight);
  const ringMembers: number[] = [];
  for (let id = 1; id <= population; id++) {
    const showcase = id === SHOWCASE_AGENT_ID;
    const region = showcase ? REGIONS[2]! : REGIONS[rng.weighted(regionWeights)]!;
    const kind: Kind = showcase ? 'showcase' : KINDS[rng.weighted(KIND_SHARE)]!;
    // Uniform in a disc of radius 3 degrees around the metro centroid. (The spec says 1.5; at globe
    // scale that renders 10,000 agents as 40 dots hidden under the store markers.)
    const rad = AGENT_JITTER_DEG * Math.sqrt(rng.next());
    const theta = rng.next() * Math.PI * 2;
    const score = START_SCORE;
    db.agent.insert({
      id, region: region.id, lat: region.lat + rad * Math.sin(theta), lng: region.lng + rad * Math.cos(theta), homeRegionName: region.name,
      cash: BigInt(Math.round(region.cashDollars * 100 * (0.5 + rng.next()))), score, band: bandOf(score), purchases: 0, refunds: 0,
      refundsAccepted: 0, isLive: false, lastActiveDay: 0, keptWindowStart: 0, keptInWindow: 0, serialPenaltyDay: -1_000,
    });
    db.agentTruth.insert({ agentId: id, kind, ringId: 0 });
    if (kind === 'ring') ringMembers.push(id);
    counts[region.id - 1]!++;
    hist[region.id - 1]![bucketOf(score)]!++;
  }

  // Rings: groups of 5 to 12, members spread across regions by construction.
  let rings = 0;
  for (let i = 0; i < ringMembers.length; ) {
    const size = Math.min(rng.int(5, 12), ringMembers.length - i);
    if (size < 5 && rings > 0) {
      for (const id of ringMembers.slice(i)) db.agentTruth.agentId.update({ agentId: id, kind: 'ring', ringId: rings });
      break;
    }
    rings++;
    for (const id of ringMembers.slice(i, i + size)) db.agentTruth.agentId.update({ agentId: id, kind: 'ring', ringId: rings });
    i += size;
  }

  for (const r of REGIONS) {
    const s = db.regionStat.regionId.find(r.id)!;
    db.regionStat.regionId.update({ ...s, agents: counts[r.id - 1]!, scoreHist: hist[r.id - 1]! });
  }

  const run: SimRunRow = {
    id: 1, seed: opts.seed, day: 0, cursor: 0, agentsPerTick: opts.agentsPerTick ?? DEFAULT_AGENTS_PER_TICK,
    tickMicros: opts.tickMicros ?? DEFAULT_TICK_MICROS, running: false, rngState: rng.state, population, seeded: true,
    maxDay: opts.maxDay ?? DEFAULT_MAX_DAY, eventSeq: existing?.eventSeq ?? 0n, startDay: HISTORY_DAYS, rings,
  };
  if (existing) db.simRun.id.update(run);
  else db.simRun.insert(run);

  writeShowcaseHistory(db);

  const done = db.simRun.id.find(1)!;
  const final = { ...done, day: HISTORY_DAYS, cursor: 0, running: opts.running ?? true };
  db.simRun.id.update(final);
  return final;
}

// A-00421: 38 purchases at 6 businesses and two accepted refunds, written day
// by day through the same functions the live economy uses. The schedule is
// explicit so the story starts at 684 and every window has closed by day 120.
// [day, business, sku or 0 for "pick from the store's category"]
const SHOWCASE_PLAN: [number, number, number][] = [
  [0, 4, 0], [1, 19, 2], [2, 7, 0], [3, 2, 0], [4, 16, 0], [6, 1, 0], [7, 4, 0], [9, 7, 0], [11, 19, 0], [12, 16, 0],
  [14, 2, 0], [17, 1, 0], [20, 19, 0], [23, 4, 0], [26, 2, 0], [29, 7, 0], [32, 1, 0], [35, 19, 0], [38, 16, 0], [41, 2, 0],
  [44, 4, 0], [47, 1, 0], [50, 19, 0], [53, 7, 0], [56, 2, 8], [59, 16, 0], [62, 1, 0], [65, 19, 0], [68, 4, 0], [71, 2, 0],
  [74, 7, 0], [77, 1, 0], [80, 19, 0], [83, 16, 0], [86, 2, 0], [90, 4, 0], [94, 7, 0], [98, 16, 0],
];
const SHOWCASE_REFUNDS = new Map<number, { reason: ReasonCode; text: string }>([
  [1, { reason: 'defective', text: 'The left earbud stopped charging after a week; the case light never turns on.' }],
  [24, { reason: 'damaged_in_shipping', text: 'Box arrived crushed and the screen corner is cracked.' }],
]);

function writeShowcaseHistory(db: SimDb) {
  const id = SHOWCASE_AGENT_ID;
  const plan = SHOWCASE_PLAN.map(([day, shop, sku], n) => {
    const items = itemsIn(businessDef(shop)!.category);
    return { day, shop, sku: sku || items[(n * 7) % items.length]!.sku, n };
  });
  const refunded = new Map<bigint, { claimDay: number; reason: ReasonCode; text: string }>();
  for (let day = 0; day < HISTORY_DAYS; day++) {
    const run = db.simRun.id.find(1)!;
    db.simRun.id.update({ ...run, day });
    const w = World.open(db);
    for (const p of plan.filter((x) => x.day === day)) {
      const purchase = recordPurchase(w, id, p.shop, p.sku, 'sim', 3);
      const r = SHOWCASE_REFUNDS.get(p.n);
      if (r) refunded.set(purchase.id, { claimDay: purchase.deliverDay + 2, reason: r.reason, text: r.text });
    }
    for (const [pid, r] of refunded) {
      if (r.claimDay === day) {
        const pur = db.purchase.id.find(pid)!;
        fileRefund(w, pur, r.reason, r.text, 'sim', 'investigation');
      }
      if (r.claimDay + 2 === day) {
        const ref = [...db.refund.purchaseId.filter(pid)][0]!;
        settleRefund(w, ref, 'accepted', ref.amount, 'evidence');
      }
    }
    dayEnd(w, day, { bursts: false, drift: false });
    w.commit();
  }
}

// ---------------------------------------------------------------- the tick

/** One scheduled tick: step the next agentsPerTick agents; on wrap, close the day. */
export function step(db: SimDb): StepResult {
  const run = db.simRun.id.find(1);
  if (!run || !run.seeded || !run.running) return { steps: 0, events: 0, dayEnded: null };
  const w = new World(db, run);
  if (run.maxDay > 0 && run.day >= run.maxDay) {
    run.running = false;
    w.feed('system', 0, 0, 0, 0n, `[System] Simulation paused at day ${run.day} (max day reached)`);
    w.commit();
    return { steps: 0, events: 0, dayEnded: null };
  }
  const start = run.cursor;
  const end = Math.min(start + run.agentsPerTick, run.population);
  for (let id = start + 1; id <= end; id++) stepAgent(w, id);
  run.cursor = end;
  let dayEnded: number | null = null;
  if (end >= run.population) {
    dayEnd(w, run.day, { bursts: true, drift: true });
    dayEnded = run.day;
    run.day += 1;
    run.cursor = 0;
  }
  w.commit();
  return { steps: end - start, events: w.events, dayEnded };
}

function buyRate(w: World, kind: Kind, id: number): number {
  const personal = 0.5 + unitHash(w.run.seed.toString(), id, 'buy');
  const weekend = w.day % 7 >= 5 ? 1.25 : 1;
  return BUY_RATE[kind] * personal * weekend;
}

function stepAgent(w: World, id: number) {
  if (id === SHOWCASE_AGENT_ID) return;
  const kind = w.kind(id);
  if (kind === 'live' || kind === 'showcase') return;
  if (!w.rng.chance(buyRate(w, kind, id))) return;
  const a = w.agent(id);
  const shop = pickBusiness(w, id);
  const items = itemsIn(businessDef(shop)!.category);
  const item = w.rng.pick(items);
  accrueIncome(w, a);
  if (a.cash < BigInt(item.priceCents)) return;
  recordPurchase(w, id, shop, item.sku, 'sim', w.rng.int(2, 5));
}

/** Three favourite stores per agent (stable), sometimes somewhere new. */
function pickBusiness(w: World, id: number): number {
  if (w.rng.chance(0.7)) return 1 + (hash32(w.run.seed.toString(), id, 'fav', w.rng.int(0, 2)) % BUSINESSES.length);
  return w.rng.int(1, BUSINESSES.length);
}

/** Income accrues lazily when the agent next acts, so idle agents cost no writes. */
function accrueIncome(w: World, a: AgentRow) {
  const r = regionById(a.region);
  if (!r) return;
  const perDay = Math.round((r.cashDollars * 100) / 30);
  const days = Math.max(0, w.day - a.lastActiveDay);
  const cap = BigInt(r.cashDollars * 100 * 3);
  const next = a.cash + BigInt(perDay * days);
  a.cash = next > cap ? cap : next;
}

// ---------------------------------------------------------------- purchases and refunds

/** deliverIn = 0 leaves the purchase 'ordered' until someone delivers it (live shoppers fast-forward). */
export function recordPurchase(w: World, agentId: number, businessId: number, sku: number, source: string, deliverIn: number): PurchaseRow {
  const item = catalogItem(sku);
  if (!item) throw new Error(`unknown item ${sku}`);
  const b = w.business(businessId);
  if (item.category !== b.category) throw new Error(`${b.name} does not sell ${item.name}`);
  const a = w.agent(agentId);
  const amount = item.priceCents;
  const deliverDay = deliverIn > 0 ? w.day + deliverIn : 0;
  // Live and showcase purchases keep their window open: simulated days fly by while a person records a video.
  const windowEndDay = source === 'sim' && deliverDay > 0 ? deliverDay + w.policy(businessId).windowDays : 0;
  const p = w.db.purchase.insert({
    id: 0n, buyer: agentId, business: businessId, item: sku, category: item.category, amount, day: w.day,
    deliverDay, windowEndDay, status: 'ordered', source,
  });
  a.cash -= BigInt(amount);
  a.purchases += 1;
  a.lastActiveDay = w.day;
  w.touchAgent(a);
  b.balance += BigInt(amount);
  b.sales += 1;
  b.inventory = Math.max(0, b.inventory - 1);
  w.touchBusiness(b);
  const s = w.stat(a.region);
  s.purchases += 1;
  s.salesCents += BigInt(amount);
  w.bumpFlow(businessId, 'purchase', amount);
  w.events++;
  w.feed('purchase', agentId, businessId, amount, p.id, `[Purchase] ${agentLabel(agentId)} → ${businessLabel(businessId)} ${dollars(amount)} ${item.name}`);
  return p;
}

export function fileRefund(w: World, p: PurchaseRow, reasonCode: string, reasonText: string, source: string, path: 'fast' | 'investigation'): RefundRow {
  if (p.status !== 'delivered') throw new Error(`purchase ${purchaseLabel(p.id)} is ${p.status}, not delivered`);
  const r = w.db.refund.insert({
    id: 0n, purchaseId: p.id, agentId: p.buyer, businessId: p.business, amount: p.amount, day: w.day, reasonCode,
    reasonText, status: path === 'fast' ? 'requested' : 'investigating', decidedDay: 0, source, decideDay: path === 'fast' ? w.day + 2 : 0,
    resolveDay: 0, path,
  });
  w.db.purchase.id.update({ ...p, status: 'refund_requested' });
  const a = w.agent(p.buyer);
  a.refunds += 1;
  a.lastActiveDay = w.day;
  w.touchAgent(a);
  const s = w.stat(a.region);
  s.refundsRequested += 1;
  s.pending += 1;
  w.events++;
  w.feed('refund', p.buyer, p.business, p.amount, r.id, `[Refund] ${agentLabel(p.buyer)} → ${businessLabel(p.business)} ${dollars(p.amount)} ${reasonCode.replaceAll('_', ' ')}`);
  serialCheck(w, a, r);
  return r;
}

/** Refund requests above 40% of purchases in the last 90 days cost 15 points, once per window. */
function serialCheck(w: World, a: AgentRow, r: RefundRow) {
  if (w.day - a.serialPenaltyDay < SERIAL_WINDOW_DAYS) return;
  const since = w.day - SERIAL_WINDOW_DAYS;
  let bought = 0;
  for (const p of w.db.purchase.buyer.filter(a.id)) if (p.day >= since) bought++;
  if (bought < 3) return;
  let asked = 0;
  for (const x of w.db.refund.agentId.filter(a.id)) if (x.day >= since) asked++;
  if (asked / bought <= SERIAL_RATIO) return;
  a.serialPenaltyDay = w.day;
  w.touchAgent(a);
  applyCredit(w, a.id, CREDIT.serialReturns.kind, CREDIT.serialReturns.delta, 'refund', r.id);
}

/**
 * Close a refund. 'evidence' is an accept backed by evidence (an investigation,
 * or the agent sending more evidence); 'fast' is the policy engine's accept.
 * A decline only ever comes from a person.
 */
export function settleRefund(w: World, r: RefundRow, outcome: 'accepted' | 'declined' | 'withdrawn', amount: number, basis: 'fast' | 'evidence' | 'person') {
  const open = ['requested', 'investigating', 'more_evidence', 'recommended', 'awaiting_controller'];
  if (!open.includes(r.status)) throw new Error(`refund ${refundLabel(r.id)} is already ${r.status}`);
  const a = w.agent(r.agentId);
  const s = w.stat(a.region);
  s.pending = Math.max(0, s.pending - 1);
  w.db.refund.id.update({ ...r, status: outcome, decidedDay: w.day, amount: outcome === 'accepted' ? amount : r.amount });
  const p = w.db.purchase.id.find(r.purchaseId);
  if (outcome === 'accepted') {
    if (p) w.db.purchase.id.update({ ...p, status: 'refunded' });
    a.refundsAccepted += 1;
    a.cash += BigInt(amount);
    w.touchAgent(a);
    const b = w.business(r.businessId);
    b.balance -= BigInt(amount);
    b.refundsPaid += 1;
    w.touchBusiness(b);
    w.bumpFlow(r.businessId, 'refund_paid', amount);
    s.accepted += 1;
    if (w.db.refundIntent.purchaseId.find(r.purchaseId)?.falseClaim) s.lossCents += BigInt(amount);
    const c = basis === 'fast' ? CREDIT.acceptedFast : CREDIT.acceptedEvidence;
    const before = a.score;
    applyCredit(w, r.agentId, c.kind, c.delta, 'refund', r.id, false);
    // One line per outcome, carrying the business so the globe can draw the return arc.
    w.feed('refund_accepted', r.agentId, r.businessId, amount, r.id,
      `[Refund] ${businessLabel(r.businessId)} accepted ${agentLabel(r.agentId)} ${dollars(amount)}${basis === 'fast' ? ' (fast path)' : ''} · credit ${before} → ${w.agent(r.agentId).score}`);
  } else if (outcome === 'declined') {
    if (p) w.db.purchase.id.update({ ...p, status: 'kept' });
    s.declined += 1;
    if (!w.db.refundIntent.purchaseId.find(r.purchaseId)?.falseClaim && w.kind(r.agentId) !== 'live') s.honestDeclines += 1;
    const before = a.score;
    applyCredit(w, r.agentId, CREDIT.declined.kind, CREDIT.declined.delta, 'refund', r.id, false);
    w.feed('refund_declined', r.agentId, r.businessId, r.amount, r.id,
      `[Refund] ${businessLabel(r.businessId)} declined ${agentLabel(r.agentId)} ${dollars(r.amount)} · credit ${before} → ${w.agent(r.agentId).score}`);
  } else if (p) {
    w.db.purchase.id.update({ ...p, status: 'kept' });
  }
  w.events++;
}

/** The fast policy engine for simulated refunds: never declines. */
function fastDecide(w: World, r: RefundRow) {
  const band = w.agent(r.agentId).band;
  const policy = w.policy(r.businessId);
  if ((band === 'neutral' || band === 'green') && r.amount <= policy.needsVideoOverCents) {
    settleRefund(w, r, 'accepted', r.amount, 'fast');
    return;
  }
  w.db.refund.id.update({ ...r, status: 'more_evidence', resolveDay: w.day + 4 });
  // A genuine claim slowed down is the honest-customer cost of fraud controls.
  if (!w.db.refundIntent.purchaseId.find(r.purchaseId)?.falseClaim) w.stat(w.agent(r.agentId).region).honestDeclines += 1;
}

/** Four days after "more evidence": genuine claimants send it and get paid, false claims are dropped. */
function resolveMoreEvidence(w: World, r: RefundRow) {
  if (w.db.refundIntent.purchaseId.find(r.purchaseId)?.falseClaim) settleRefund(w, r, 'withdrawn', 0, 'person');
  else settleRefund(w, r, 'accepted', r.amount, 'evidence');
}

function keepPurchase(w: World, p: PurchaseRow) {
  w.db.purchase.id.update({ ...p, status: 'kept' });
  const a = w.agent(p.buyer);
  if (w.day - a.keptWindowStart >= KEPT_WINDOW_DAYS) {
    a.keptWindowStart = w.day;
    a.keptInWindow = 0;
  }
  w.events++;
  if (a.keptInWindow * CREDIT.kept.delta >= KEPT_CAP_PER_WINDOW) {
    w.touchAgent(a);
    return;
  }
  a.keptInWindow += 1;
  w.touchAgent(a);
  applyCredit(w, p.buyer, CREDIT.kept.kind, CREDIT.kept.delta, 'purchase', p.id, false);
}

// ---------------------------------------------------------------- behaviour

const REASON_BY_CATEGORY: Record<string, [ReasonCode[], number[]]> = {
  apparel: [['wrong_size', 'not_as_described', 'defective', 'damaged_in_shipping'], [55, 25, 12, 8]],
  default: [['defective', 'not_as_described', 'damaged_in_shipping', 'missing_parts'], [50, 25, 15, 10]],
};

function genuineReason(w: World, category: string): ReasonCode {
  const [codes, weights] = REASON_BY_CATEGORY[category] ?? REASON_BY_CATEGORY.default!;
  return codes[w.rng.weighted(weights)]!;
}

/** On delivery, a simulated agent decides whether (and when) it will claim. Stored privately. */
function planRefund(w: World, p: PurchaseRow) {
  if (w.db.refundIntent.purchaseId.find(p.id)) return; // rings plan at purchase time
  const kind = w.kind(p.buyer);
  const window = Math.max(2, p.windowEndDay - p.deliverDay);
  const item = catalogItem(p.item)!;
  const edgeGap = () => window - w.rng.int(0, 2);
  const earlyGap = () => w.rng.int(1, Math.min(7, window - 1));
  let plan: { gap: number; reason: ReasonCode; text: string; falseClaim: boolean } | null = null;

  const genuine = () => {
    const reason = genuineReason(w, item.category);
    return { gap: earlyGap(), reason, text: honestClaimText(reason, item, w.rng), falseClaim: false };
  };
  if (kind === 'showcase' || kind === 'live') return; // scripted or real people, never simulated claims
  if (kind === 'honest' || kind === 'ring') {
    if (w.rng.chance(0.04)) plan = genuine();
  } else if (kind === 'opportunist') {
    if (w.rng.chance(0.04)) plan = genuine();
    else if (w.rng.chance(0.3)) plan = { gap: edgeGap(), reason: 'defective', text: falseDefectText(item, w.rng), falseClaim: true };
  } else if (kind === 'serial') {
    const rate = 0.35 + 0.15 * unitHash(w.run.seed.toString(), p.buyer, 'serial');
    if (w.rng.chance(rate)) {
      const falseClaim = w.rng.chance(0.7);
      const reason: ReasonCode = falseClaim ? w.rng.pick(['defective', 'not_as_described', 'changed_mind'] as const) : genuineReason(w, item.category);
      const text = falseClaim && reason === 'defective' ? falseDefectText(item, w.rng) : honestClaimText(reason, item, w.rng);
      plan = { gap: w.rng.chance(0.6) ? edgeGap() : w.rng.int(1, window - 1), reason, text, falseClaim };
    }
  }
  if (!plan) return;
  w.db.refundIntent.insert({ purchaseId: p.id, claimDay: p.deliverDay + Math.max(1, plan.gap), reasonCode: plan.reason, reasonText: plan.text, falseClaim: plan.falseClaim });
}

export const isBurstDay = (seed: bigint, ringId: number, day: number, startDay = HISTORY_DAYS): boolean => {
  const offset = 3 + (hash32(seed.toString(), ringId, 'burst') % (RING_BURST_PERIOD - 3));
  const d = day - startDay - offset;
  return d >= 0 && d % RING_BURST_PERIOD === 0;
};

/** A ring's burst: every member buys electronics from a few stores, then all claim "defective" within 48 hours. */
function ringBurst(w: World, ringId: number, members: number[]) {
  const shops = new Set<number>();
  const want = w.rng.int(2, 4);
  while (shops.size < want) shops.add(w.rng.pick(ELECTRONICS_BUSINESSES));
  const electronics = itemsIn('electronics').filter((i) => i.priceCents >= 4_000);
  const skus = [w.rng.pick(electronics), w.rng.pick(electronics), w.rng.pick(electronics)];
  const part = w.rng.pick(['screen', 'charging port', 'casing', 'button']);
  const deliverIn = 3;
  for (const id of members) {
    const shop = w.rng.pick([...shops]);
    const item = w.rng.pick(skus);
    const p = recordPurchase(w, id, shop, item.sku, 'sim', deliverIn);
    // Most members paste the ring's script; some write their own words, which text similarity cannot catch.
    const text = w.rng.chance(0.15) ? falseDefectText(item, w.rng) : ringClaimText(ringId, item, part, w.rng);
    w.db.refundIntent.insert({ purchaseId: p.id, claimDay: p.deliverDay + w.rng.int(0, 1), reasonCode: 'defective', reasonText: text, falseClaim: true });
  }
}

// ---------------------------------------------------------------- the day

export function dayEnd(w: World, day: number, opts: { bursts: boolean; drift: boolean }) {
  const db = w.db;
  const byId = <T extends { id: bigint }>(xs: Iterable<T>) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const p of byId(db.purchase.deliverDay.filter(day))) {
    if (p.status !== 'ordered' || p.source !== 'sim') continue;
    const delivered = { ...p, status: 'delivered' };
    db.purchase.id.update(delivered);
    planRefund(w, delivered);
  }

  const intents = [...db.refundIntent.claimDay.filter(day)].sort((a, b) => (a.purchaseId < b.purchaseId ? -1 : 1));
  for (const i of intents) {
    const p = db.purchase.id.find(i.purchaseId);
    if (p && p.status === 'delivered' && p.source === 'sim') fileRefund(w, p, i.reasonCode, i.reasonText, 'sim', 'fast');
  }

  for (const r of byId(db.refund.decideDay.filter(day))) {
    if (r.status === 'requested' && r.source === 'sim' && r.path === 'fast') fastDecide(w, r);
  }

  for (const r of byId(db.refund.resolveDay.filter(day))) {
    if (r.status === 'more_evidence' && r.source === 'sim') resolveMoreEvidence(w, r);
  }

  for (const p of byId(db.purchase.windowEndDay.filter(day))) {
    if (p.status === 'delivered' && p.source === 'sim') keepPurchase(w, p);
  }

  if (opts.bursts) {
    for (let ring = 1; ring <= w.run.rings; ring++) {
      if (!isBurstDay(w.run.seed, ring, day, w.run.startDay)) continue;
      // Ring membership is private truth; only the engine reads it.
      const members = [...db.agentTruth.ringId.filter(ring)].map((t) => t.agentId).sort((a, b) => a - b);
      ringBurst(w, ring, members);
    }
  }

  if (opts.drift && day % 7 === 0) inactivityDrift(w, day);
}

/** No activity for 60 simulated days: drift one point a week toward 600, keeping old scores honest. */
function inactivityDrift(w: World, day: number) {
  for (const a of w.db.agent.iter()) {
    if (a.isLive || a.id === SHOWCASE_AGENT_ID) continue;
    if (day - Math.max(a.lastActiveDay, w.run.startDay) < INACTIVE_DAYS || a.score === START_SCORE) continue;
    const delta = a.score > START_SCORE ? -CREDIT.drift.delta : CREDIT.drift.delta;
    applyCredit(w, a.id, CREDIT.drift.kind, delta, 'agent', BigInt(a.id), false);
  }
}

// ---------------------------------------------------------------- live shoppers

export function createLiveAgent(w: World, nextId: number): AgentRow {
  // Hash-based so a person joining never shifts the simulation's random stream.
  const id = LIVE_AGENT_BASE + nextId;
  const region = REGIONS[hash32(id, 'live-region') % REGIONS.length]!;
  const row = w.db.agent.insert({
    id, region: region.id, lat: region.lat + (unitHash(id, 'lat') - 0.5) * 2, lng: region.lng + (unitHash(id, 'lng') - 0.5) * 2,
    homeRegionName: region.name, cash: 150_000n, score: LIVE_START_SCORE, band: bandOf(LIVE_START_SCORE), purchases: 0, refunds: 0,
    refundsAccepted: 0, isLive: true, lastActiveDay: w.day, keptWindowStart: w.day, keptInWindow: 0, serialPenaltyDay: -1_000,
  });
  w.db.agentTruth.insert({ agentId: id, kind: 'live', ringId: 0 });
  const s = w.stat(region.id);
  s.agents += 1;
  const hist = [...s.scoreHist];
  hist[bucketOf(LIVE_START_SCORE)]! += 1;
  s.scoreHist = hist;
  w.feed('join', id, 0, 0, 0n, `[Join] ${agentLabel(id)} joined from the ${region.name} region (simulated)`);
  return row;
}

/** Marks a live purchase delivered and inside its refund window. */
export function deliverNow(w: World, p: PurchaseRow): PurchaseRow {
  if (p.status !== 'ordered') return p;
  const next = { ...p, status: 'delivered', deliverDay: w.day };
  w.db.purchase.id.update(next);
  w.feed('delivery', p.buyer, p.business, p.amount, p.id, `[Delivery] ${purchaseLabel(p.id)} delivered to ${agentLabel(p.buyer)}`);
  return next;
}

/** Plain data for UIs that want the catalogue and regions without a table. */
export const WORLD_STATIC = { regions: REGIONS, businesses: BUSINESSES, catalog: CATALOG };
