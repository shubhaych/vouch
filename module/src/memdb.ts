// An in-memory SimDb with the same accessor shape as SpacetimeDB's ctx.db.
// Used by module tests and by the detector evaluator to grow fresh, held-out
// worlds without a server. Returns copies so callers must update() to write,
// exactly as with the real database.
import type { SimDb } from './simdb';

type Key = string | number | bigint | boolean;

class MemTable<R extends object> {
  private rows = new Map<Key, R>();
  private idx = new Map<keyof R, Map<Key, Set<Key>>>();
  private seq = 0n;

  constructor(private pk: keyof R, indexCols: (keyof R)[], private autoInc = false) {
    for (const c of indexCols) this.idx.set(c, new Map());
  }

  insert(row: R): R {
    const r = { ...row };
    if (this.autoInc) {
      this.seq += 1n;
      (r as Record<keyof R, unknown>)[this.pk] = this.seq;
    }
    const k = r[this.pk] as Key;
    if (this.rows.has(k)) throw new Error(`duplicate primary key ${String(k)}`);
    this.rows.set(k, r);
    this.index(r, k);
    return { ...r };
  }

  find(k: Key): R | undefined {
    const r = this.rows.get(k);
    return r ? { ...r } : undefined;
  }

  update(row: R): R {
    const k = row[this.pk] as Key;
    const old = this.rows.get(k);
    if (!old) throw new Error(`update of missing row ${String(k)}`);
    this.unindex(old, k);
    const r = { ...row };
    this.rows.set(k, r);
    this.index(r, k);
    return { ...r };
  }

  delete(k: Key): boolean {
    const old = this.rows.get(k);
    if (!old) return false;
    this.unindex(old, k);
    return this.rows.delete(k);
  }

  filter(col: keyof R, v: Key): R[] {
    const ks = this.idx.get(col)?.get(v);
    return ks ? [...ks].map((k) => ({ ...this.rows.get(k)! })) : [];
  }

  *iter(): Iterable<R> {
    for (const r of this.rows.values()) yield { ...r };
  }

  count(): bigint {
    return BigInt(this.rows.size);
  }

  clear(): bigint {
    const n = this.count();
    this.rows.clear();
    for (const m of this.idx.values()) m.clear();
    return n;
  }

  private index(r: R, k: Key) {
    for (const [col, m] of this.idx) {
      const v = r[col] as Key;
      let s = m.get(v);
      if (!s) m.set(v, (s = new Set()));
      s.add(k);
    }
  }

  private unindex(r: R, k: Key) {
    for (const [col, m] of this.idx) m.get(r[col] as Key)?.delete(k);
  }

  /** The accessor shape: table.<pk>.find / update / delete. */
  unique() {
    return { find: (k: Key) => this.find(k), update: (r: R) => this.update(r), delete: (k: Key) => this.delete(k) };
  }

  by(col: keyof R) {
    return { filter: (v: Key) => this.filter(col, v) };
  }

  base() {
    return { insert: (r: R) => this.insert(r), iter: () => this.iter(), count: () => this.count(), clear: () => this.clear() };
  }
}

export function createMemDb(): SimDb {
  const t = <R extends object>(pk: keyof R, idx: (keyof R)[], autoInc = false) => new MemTable<R>(pk, idx, autoInc);
  type Row<T> = T extends { insert(r: infer R): unknown } ? R & object : never;
  const simRun = t<Row<SimDb['simRun']>>('id', []);
  const agent = t<Row<SimDb['agent']>>('id', ['region']);
  const agentTruth = t<Row<SimDb['agentTruth']>>('agentId', ['ringId']);
  const business = t<Row<SimDb['business']>>('id', []);
  const purchase = t<Row<SimDb['purchase']>>('id', ['buyer', 'deliverDay', 'windowEndDay'], true);
  const refundIntent = t<Row<SimDb['refundIntent']>>('purchaseId', ['claimDay']);
  const refund = t<Row<SimDb['refund']>>('id', ['purchaseId', 'agentId', 'decideDay', 'resolveDay'], true);
  const creditEvent = t<Row<SimDb['creditEvent']>>('id', ['agentId'], true);
  const eventFeed = t<Row<SimDb['eventFeed']>>('slot', []);
  const regionStat = t<Row<SimDb['regionStat']>>('regionId', []);
  const merchantFlowDay = t<Row<SimDb['merchantFlowDay']>>('key', ['businessId', 'day']);

  return {
    simRun: { ...simRun.base(), id: simRun.unique() },
    agent: { ...agent.base(), id: agent.unique(), region: agent.by('region') },
    agentTruth: { ...agentTruth.base(), agentId: agentTruth.unique(), ringId: agentTruth.by('ringId') },
    business: { ...business.base(), id: business.unique() },
    purchase: {
      ...purchase.base(), id: purchase.unique(), buyer: purchase.by('buyer'),
      deliverDay: purchase.by('deliverDay'), windowEndDay: purchase.by('windowEndDay'),
    },
    refundIntent: { ...refundIntent.base(), purchaseId: refundIntent.unique(), claimDay: refundIntent.by('claimDay') },
    refund: {
      ...refund.base(), id: refund.unique(), purchaseId: refund.by('purchaseId'), agentId: refund.by('agentId'),
      decideDay: refund.by('decideDay'), resolveDay: refund.by('resolveDay'),
    },
    creditEvent: { ...creditEvent.base(), id: creditEvent.unique(), agentId: creditEvent.by('agentId') },
    eventFeed: { ...eventFeed.base(), slot: eventFeed.unique() },
    regionStat: { ...regionStat.base(), regionId: regionStat.unique() },
    merchantFlowDay: {
      ...merchantFlowDay.base(), key: merchantFlowDay.unique(),
      businessId: merchantFlowDay.by('businessId'), day: merchantFlowDay.by('day'),
    },
  } as unknown as SimDb;
}
