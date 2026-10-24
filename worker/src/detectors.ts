// Runs the live detectors over the worker's mirror of purchase, refund and
// agent every 5 simulated days and writes what they find with flagPattern.
// Detectors are imported fresh each run, so a promoted Droid candidate is
// used by the very next run without restarting the worker.
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DbConnection } from '../module_bindings/index';
import { catalogItem } from '@vouch/module/world';
import type { Candidate, Detector, History } from '../../detectors/types';
import { REPO_ROOT, log } from './env';
import { call } from './stdb';

const LIVE_DIR = resolve(REPO_ROOT, 'detectors/live');
const EVERY_DAYS = 5;
/** Single-agent detectors can flag hundreds of agents; flag the strongest few per run so the review budget means something. */
const MAX_NEW_PER_SINGLE_AGENT_DETECTOR = 3;

export async function loadLiveDetectors(): Promise<Detector[]> {
  const out: Detector[] = [];
  for (const f of readdirSync(LIVE_DIR).filter((x) => x.endsWith('.ts')).sort()) {
    const file = resolve(LIVE_DIR, f);
    const mod = (await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`)) as { detector?: Detector };
    if (mod.detector) out.push(mod.detector);
  }
  return out;
}

export function historyFromConn(conn: DbConnection, day: number): History {
  return {
    day,
    purchases: [...conn.db.purchase.iter()].map((p) => ({ id: p.id, buyer: p.buyer, business: p.business, item: p.item, category: p.category, amount: p.amount, day: p.day, deliverDay: p.deliverDay, windowEndDay: p.windowEndDay, status: p.status })),
    refunds: [...conn.db.refund.iter()].map((r) => ({ id: r.id, purchaseId: r.purchaseId, agentId: r.agentId, businessId: r.businessId, amount: r.amount, day: r.day, reasonCode: r.reasonCode, reasonText: r.reasonText, status: r.status })),
    agents: [...conn.db.agent.iter()].map((a) => ({ id: a.id, region: a.region, score: a.score, purchases: a.purchases, refunds: a.refunds })),
  };
}

const severity = (c: Candidate) => Number(c.features.refund_ratio ?? c.features.defect_claims ?? c.agentIds.length) || 0;

export class DetectorRunner {
  private lastRunDay = -1;
  private running = false;
  private refunds = new Map<bigint, History['refunds'][number]>();
  private purchases = new Map<bigint, History['purchases'][number]>();
  private regions = new Map<number, number>();

  constructor(private conn: DbConnection) {}

  start() {
    this.conn.db.simRun.onUpdate((_c, _o, run) => {
      if (!run.seeded || run.day === this.lastRunDay || this.running) return;
      if (run.day < this.lastRunDay) this.lastRunDay = -1; // the world was reseeded
      if ((run.day - run.startDay) % EVERY_DAYS !== 0 || run.day === run.startDay) return;
      this.lastRunDay = run.day;
      this.running = true;
      this.runOnce(run.day).catch((e) => log('detector run failed', (e as Error).message)).finally(() => { this.running = false; });
    });
    log(`detectors run every ${EVERY_DAYS} simulated days`);
  }

  async runOnce(day: number) {
    const t0 = Date.now();
    const h = historyFromConn(this.conn, day);
    // One pass to index rows: per-event lookups through the client cache are far slower at 200k rows.
    this.refunds = new Map(h.refunds.map((r) => [r.id, r]));
    this.purchases = new Map(h.purchases.map((p) => [p.id, p]));
    this.regions = new Map(h.agents.map((a) => [a.id, a.region]));
    const detectors = await loadLiveDetectors();
    const known = new Set([...this.conn.db.fraudPattern.iter()].map((p) => p.signature));
    let flagged = 0;
    for (const d of detectors) {
      let cands = d.run(h).filter((c) => !known.has(`${d.id}@${d.version}:${[...c.agentIds].sort((a, b) => a - b).join(',')}`));
      // Agents already in an open or confirmed pattern from this detector are not flagged again on their own.
      const covered = new Set<number>();
      for (const p of this.conn.db.fraudPattern.iter()) if (p.detectorId === d.id && p.status !== 'dismissed') for (const a of p.agentIds) covered.add(a);
      cands = cands.filter((c) => c.agentIds.some((a) => !covered.has(a)));
      if (d.id !== 'coordinated') cands = cands.sort((a, b) => severity(b) - severity(a)).slice(0, MAX_NEW_PER_SINGLE_AGENT_DETECTOR);
      for (const c of cands) {
        await this.flag(d, c);
        flagged++;
      }
    }
    log(`detectors on day ${day}: ${h.purchases.length} purchases, ${h.refunds.length} refunds, ${flagged} new patterns (${Date.now() - t0} ms)`);
  }

  /** Writes the pattern plus one pattern_event per purchase, delivery and refund behind it, each with a one-line why. */
  private async flag(d: Detector, c: Candidate) {
    const events: { table: string; id: bigint; kind: string; agentId: number; businessId: number; amount: number; day: number; text: string; why: string }[] = [];
    for (const e of c.events.slice(0, 40)) {
      if (e.table !== 'refund') continue;
      const r = this.refunds.get(e.id);
      const p = r ? this.purchases.get(r.purchaseId) : undefined;
      if (!r) continue;
      if (p) {
        const item = catalogItem(p.item)?.name ?? 'item';
        events.push({ table: 'purchase', id: p.id, kind: 'purchase', agentId: p.buyer, businessId: p.business, amount: p.amount, day: p.day, text: item, why: `bought ${item}` });
        events.push({ table: 'purchase', id: p.id, kind: 'delivery', agentId: p.buyer, businessId: p.business, amount: 0, day: p.deliverDay, text: item, why: 'delivered' });
      }
      events.push({ table: 'refund', id: r.id, kind: 'refund', agentId: r.agentId, businessId: r.businessId, amount: r.amount, day: r.day, text: r.reasonText, why: e.why });
    }
    const days = events.map((e) => e.day);
    // Regions are added for the pattern card only, after detection: the detector never saw them.
    const regions = new Set(c.agentIds.map((id) => this.regions.get(id)).filter((x) => x !== undefined)).size;
    await call('flagPattern', this.conn.reducers.flagPattern({
      kind: c.kind, detectorId: d.id, detectorVersion: d.version, firstDay: Math.min(...days), lastDay: Math.max(...days),
      agentIds: c.agentIds, businessIds: c.businessIds, featuresJson: JSON.stringify({ ...c.features, regions }), events,
    }));
  }
}
