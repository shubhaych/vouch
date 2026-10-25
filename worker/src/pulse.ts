// The returns pulse: how many returns are happening per second, by item, by
// business and by shopper band, counted from refund rows as they arrive (wall
// clock, so a simulated economy at 5 ticks/s and a live shopper look the same).
// The pulse itself is worker arithmetic over live rows and is badged Live. The
// Returns Monitor is a CREAO agent that reads one window of it, plus web
// return signals scraped by Bright Data for the busiest items, and writes a
// note: what spiked, what the innocent explanation might be, what to watch.
// It counts nothing itself and never names a shopper.
import type { DbConnection } from '../module_bindings/index';
import type { Refund } from '../module_bindings/types';
import { businessDef, catalogItem } from '@vouch/module/world';
import { searchReturnSignals, type Scrape, type Signal } from './brightdata';
import { seatAvailable } from './creao';
import { config, log } from './env';
import { mirrorOf } from './mirror';
import { runSeat } from './seat';
import { call } from './stdb';

export interface PulseEvent { at: number; sku: number; name: string; business: number; businessName: string; band: string }
export interface PulseItem { sku: number; name: string; count: number; perSecond: number; baselinePerSecond: number; spike: boolean }
export interface Pulse {
  windowSeconds: number; returns: number; perSecond: number; baselinePerSecond: number;
  items: PulseItem[]; businesses: { id: number; name: string; count: number }[]; cohorts: { band: string; count: number }[]; spikes: number;
}
export interface PulseOptions { windowSeconds?: number; baselineSeconds?: number; spikeFactor?: number; minSpikeCount?: number; topItems?: number }

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure: one window over the events. A spike is an item whose window rate is spikeFactor × its baseline rate, with at least minSpikeCount returns. */
export function computePulse(events: PulseEvent[], now: number, o: PulseOptions = {}): Pulse {
  const windowSeconds = o.windowSeconds ?? 60;
  const baselineSeconds = o.baselineSeconds ?? 600;
  const spikeFactor = o.spikeFactor ?? config.returnsMonitor.spikeFactor;
  const minSpikeCount = o.minSpikeCount ?? 5;
  const topItems = o.topItems ?? 10;
  const windowStart = now - windowSeconds * 1000;
  const baselineStart = windowStart - baselineSeconds * 1000;
  const inWindow = events.filter((e) => e.at > windowStart && e.at <= now);
  const inBaseline = events.filter((e) => e.at > baselineStart && e.at <= windowStart);
  const count = <K>(xs: PulseEvent[], key: (e: PulseEvent) => K) => {
    const m = new Map<K, number>();
    for (const e of xs) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return m;
  };
  const byItem = count(inWindow, (e) => e.sku);
  const baseItem = count(inBaseline, (e) => e.sku);
  const items: PulseItem[] = [...byItem.entries()].map(([sku, n]) => {
    const perSecond = n / windowSeconds;
    const baselinePerSecond = (baseItem.get(sku) ?? 0) / baselineSeconds;
    return { sku, name: inWindow.find((e) => e.sku === sku)!.name, count: n, perSecond: round(perSecond), baselinePerSecond: round(baselinePerSecond, 4), spike: n >= minSpikeCount && perSecond >= spikeFactor * baselinePerSecond };
  }).sort((a, b) => b.count - a.count || a.sku - b.sku).slice(0, topItems);
  const businesses = [...count(inWindow, (e) => e.business).entries()].map(([id, n]) => ({ id, name: inWindow.find((e) => e.business === id)!.businessName, count: n })).sort((a, b) => b.count - a.count).slice(0, 8);
  const cohorts = [...count(inWindow, (e) => e.band).entries()].map(([band, n]) => ({ band, count: n })).sort((a, b) => b.count - a.count);
  return {
    windowSeconds, returns: inWindow.length, perSecond: round(inWindow.length / windowSeconds), baselinePerSecond: round(inBaseline.length / baselineSeconds, 4),
    items, businesses, cohorts, spikes: items.filter((i) => i.spike).length,
  };
}

export interface MonitorJson {
  narrative: string;
  anomalies: { sku: string; kind: string; why: string; cites: string[] }[];
  items_to_watch: string[];
  innocent_explanation_considered?: string;
  real_world_context?: { sku: string; summary: string; urls: string[] }[];
  suggested_detector_change?: string;
}
const ANOMALY_KINDS = new Set(['spike', 'possible_defective_batch', 'clustered_timing', 'new_item_returns', 'none']);

/** Fail closed and keep the note descriptive: unknown anomaly kinds are dropped, and nothing that looks like a shopper id survives. */
export function guardMonitor(v: MonitorJson): MonitorJson {
  const clean = (s: unknown) => String(s ?? '').replace(/\bA-\d{5}\b/g, 'a shopper').slice(0, 1200);
  return {
    narrative: clean(v.narrative),
    anomalies: (Array.isArray(v.anomalies) ? v.anomalies : []).filter((a) => a && ANOMALY_KINDS.has(String(a.kind))).slice(0, 10)
      .map((a) => ({ sku: clean(a.sku).slice(0, 20), kind: String(a.kind), why: clean(a.why), cites: (Array.isArray(a.cites) ? a.cites : []).map(clean).slice(0, 8) })),
    items_to_watch: (Array.isArray(v.items_to_watch) ? v.items_to_watch : []).map(clean).slice(0, 10),
    innocent_explanation_considered: clean(v.innocent_explanation_considered),
    real_world_context: (Array.isArray(v.real_world_context) ? v.real_world_context : []).slice(0, 5).map((r) => ({ sku: clean(r?.sku).slice(0, 20), summary: clean(r?.summary), urls: (Array.isArray(r?.urls) ? r.urls : []).map(clean).slice(0, 5) })),
    suggested_detector_change: clean(v.suggested_detector_change).slice(0, 300),
  };
}

export interface PulseDeps { creaoOn: () => boolean; takeBudget: () => boolean }

export class PulseRunner {
  private events: PulseEvent[] = [];
  private lastScheduledNote = Date.now();
  private lastSpikeNote = 0;
  private running = false;
  latest: Pulse | null = null;

  constructor(private conn: DbConnection, private deps: PulseDeps) {}

  start(everyMs = 5000) {
    const m = mirrorOf(this.conn);
    this.conn.db.refund.onInsert((_c, r: Refund) => {
      const p = m.purchases.get(r.purchaseId);
      const sku = p?.item ?? -1;
      this.events.push({
        at: Date.now(), sku, name: catalogItem(sku)?.name ?? `SKU-${sku}`, business: r.businessId, businessName: businessDef(r.businessId)?.name ?? `B-${r.businessId}`,
        band: m.agents.get(r.agentId)?.band ?? 'unknown',
      });
    });
    setInterval(() => void this.tick().catch((e) => log('pulse failed', (e as Error).message)), everyMs);
    log(`returns pulse every ${everyMs / 1000} s; Returns Monitor every ${config.returnsMonitor.everyMinutes} min or on a spike`);
  }

  private async tick() {
    const now = Date.now();
    this.events = this.events.filter((e) => e.at > now - 11 * 60_000);
    const pulse = computePulse(this.events, now);
    this.latest = pulse;
    await call('writePulse', this.conn.reducers.writePulse({
      windowSeconds: pulse.windowSeconds, returns: pulse.returns, perSecond: pulse.perSecond, baselinePerSecond: pulse.baselinePerSecond,
      itemsJson: JSON.stringify(pulse.items), businessesJson: JSON.stringify(pulse.businesses), cohortsJson: JSON.stringify(pulse.cohorts), spikes: pulse.spikes,
    }));
    if (pulse.returns === 0) return;
    const spike = pulse.spikes > 0 && now - this.lastSpikeNote > 10 * 60_000;
    const due = now - this.lastScheduledNote > config.returnsMonitor.everyMinutes * 60_000;
    if (spike) this.lastSpikeNote = now;
    if (due) this.lastScheduledNote = now;
    if (spike || due) void this.runMonitor(spike ? 'spike' : 'schedule', pulse).catch((e) => log('Returns Monitor failed', (e as Error).message));
  }

  /** One Returns Monitor run over the given (or latest) window. Returns false when it could not start. */
  async runMonitor(trigger: 'schedule' | 'spike' | 'manual', pulse = this.latest, fixtureIfMissing = false): Promise<boolean> {
    if (!pulse || this.running) return false;
    if (!this.deps.creaoOn()) { log('Returns Monitor: CREAO kill switch is off'); return false; }
    if (!seatAvailable('returns_monitor') && !fixtureIfMissing) { log('Returns Monitor: no saved CREAO agent "Vouch Returns Monitor"'); return false; }
    if (!this.deps.takeBudget()) { log('Returns Monitor: daily CREAO run limit reached'); return false; }
    this.running = true;
    try {
      // Real-world context for the three busiest items only: scrapes are budgeted and cached for a day.
      const top = pulse.items.slice(0, 3);
      const signals = new Map<number, Scrape<Signal>>();
      for (const it of top) signals.set(it.sku, await searchReturnSignals(it.name));
      const prior = [...this.conn.db.monitorNote.iter()].sort((a, b) => Number(b.id - a.id)).slice(0, 3).map((n) => {
        const j = JSON.parse(n.json) as { narrative?: string; anomalies?: unknown[] };
        return { at: n.at.toDate().toISOString(), narrative: String(j.narrative ?? '').slice(0, 300), anomalies: j.anomalies ?? [] };
      });
      const caseJson = {
        trigger,
        simulated_day: this.conn.db.simRun.id.find(1)?.day ?? 0,
        window: { seconds: pulse.windowSeconds, returns: pulse.returns, per_second: pulse.perSecond, baseline_per_second: pulse.baselinePerSecond, spike_factor: config.returnsMonitor.spikeFactor },
        items: pulse.items.map((it) => {
          const s = signals.get(it.sku);
          return {
            sku: `SKU-${it.sku}`, name: it.name, count: it.count, per_second: it.perSecond, baseline_per_second: it.baselinePerSecond, spike: it.spike,
            real_world: s ? { source: s.source === 'brightdata' ? 'bright_data_serp' : 'fixture', fetched_at: s.fetchedAt, cached: s.cached, error: s.error, signals: s.items } : null,
          };
        }),
        businesses: pulse.businesses.map((b) => ({ id: `B-${String(b.id).padStart(3, '0')}`, name: b.name, count: b.count })),
        cohorts: pulse.cohorts,
        prior_notes: prior,
      };
      const fallback: MonitorJson = { narrative: 'The Returns Monitor output could not be read; the pulse numbers stand on their own and nothing is flagged.', anomalies: [], items_to_watch: [] };
      const r = await runSeat<MonitorJson>(this.conn, 'returns_monitor', `pulse-${new Date().toISOString().slice(11, 19)}`, caseJson, fallback,
        (v) => typeof v.narrative === 'string' && Array.isArray(v.anomalies), (s) => log(`Returns Monitor: ${s}`), 'pulse window and web signals sent', fixtureIfMissing);
      const note = { ...guardMonitor(r.value), trigger, given: { window: caseJson.window, items: caseJson.items, businesses: caseJson.businesses, cohorts: caseJson.cohorts } };
      await call('recordMonitorNote', this.conn.reducers.recordMonitorNote({ runId: r.handle.runId, runUrl: r.handle.runUrl, trigger, json: JSON.stringify(note), provenance: r.handle.path === 'fixture' ? 'fixture' : 'live' }));
      log(`Returns Monitor (${trigger}): ${note.anomalies.length} anomaly(ies), ${note.items_to_watch.length} to watch (${r.handle.path})`);
      return true;
    } finally {
      this.running = false;
    }
  }
}
