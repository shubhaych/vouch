// The slice of the database the simulation engine touches, written as the
// same shape SpacetimeDB gives reducers (ctx.db.<table>.<index>.find/filter).
// The module passes ctx.db; tests and the detector evaluator pass memdb.ts.
// Row types here must match schema.ts column for column.

export interface SimRunRow {
  id: number; seed: bigint; day: number; cursor: number; agentsPerTick: number; tickMicros: bigint;
  running: boolean; rngState: bigint; population: number; seeded: boolean; maxDay: number; eventSeq: bigint; startDay: number; rings: number;
}
export interface AgentRow {
  id: number; region: number; lat: number; lng: number; homeRegionName: string; cash: bigint; score: number; band: string;
  purchases: number; refunds: number; refundsAccepted: number; isLive: boolean; lastActiveDay: number;
  keptWindowStart: number; keptInWindow: number; serialPenaltyDay: number;
}
export interface TruthRow { agentId: number; kind: string; ringId: number }
export interface BusinessRow {
  id: number; name: string; region: number; lat: number; lng: number; category: string; balance: bigint; inventory: number;
  policy: string; issuerPublicKey: string; sales: number; refundsPaid: number;
}
export interface PurchaseRow {
  id: bigint; buyer: number; business: number; item: number; category: string; amount: number; day: number;
  deliverDay: number; windowEndDay: number; status: string; source: string;
}
/** Private: a simulated agent's plan to claim, and whether the claim is true. Never sent to clients. */
export interface IntentRow { purchaseId: bigint; claimDay: number; reasonCode: string; reasonText: string; falseClaim: boolean }
export interface RefundRow {
  id: bigint; purchaseId: bigint; agentId: number; businessId: number; amount: number; day: number; reasonCode: string;
  reasonText: string; status: string; decidedDay: number; source: string; decideDay: number; resolveDay: number; path: string;
}
export interface CreditEventRow {
  id: bigint; agentId: number; day: number; kind: string; delta: number; before: number; after: number; causeTable: string; causeId: bigint;
}
export interface FeedRow { slot: number; seq: bigint; day: number; kind: string; agentId: number; businessId: number; amount: number; refId: bigint; line: string }
export interface RegionStatRow {
  regionId: number; name: string; lat: number; lng: number; agents: number; purchases: number; salesCents: bigint; refundsRequested: number;
  accepted: number; declined: number; pending: number; lossCents: bigint; honestDeclines: number; fraudFlags: number; scoreHist: number[];
}
/** businessId 0 = all-merchants rollup. purchaseCents / refundPaidCents are authoritative for charts. */
export interface MerchantFlowDayRow {
  key: string; businessId: number; day: number; purchaseCents: bigint; refundPaidCents: bigint; purchases: number; refundsPaid: number;
}
/** Sentinel businessId for the all-merchants daily rollup. */
export const ALL_MERCHANTS_FLOW_ID = 0;

interface Unique<R, K> { find(key: K): R | undefined; update(row: R): R; delete(key: K): boolean }
interface Indexed<R, K> { filter(key: K): Iterable<R> }
interface Table<R> { insert(row: R): R; iter(): Iterable<R>; count(): bigint; clear(): bigint }

export interface SimDb {
  simRun: Table<SimRunRow> & { id: Unique<SimRunRow, number> };
  agent: Table<AgentRow> & { id: Unique<AgentRow, number>; region: Indexed<AgentRow, number> };
  agentTruth: Table<TruthRow> & { agentId: Unique<TruthRow, number>; ringId: Indexed<TruthRow, number> };
  business: Table<BusinessRow> & { id: Unique<BusinessRow, number> };
  purchase: Table<PurchaseRow> & {
    id: Unique<PurchaseRow, bigint>; buyer: Indexed<PurchaseRow, number>; deliverDay: Indexed<PurchaseRow, number>; windowEndDay: Indexed<PurchaseRow, number>;
  };
  refundIntent: Table<IntentRow> & { purchaseId: Unique<IntentRow, bigint>; claimDay: Indexed<IntentRow, number> };
  refund: Table<RefundRow> & {
    id: Unique<RefundRow, bigint>; purchaseId: Indexed<RefundRow, bigint>; agentId: Indexed<RefundRow, number>;
    decideDay: Indexed<RefundRow, number>; resolveDay: Indexed<RefundRow, number>;
  };
  creditEvent: Table<CreditEventRow> & { id: Unique<CreditEventRow, bigint>; agentId: Indexed<CreditEventRow, number> };
  eventFeed: Table<FeedRow> & { slot: Unique<FeedRow, number> };
  regionStat: Table<RegionStatRow> & { regionId: Unique<RegionStatRow, number> };
  merchantFlowDay: Table<MerchantFlowDayRow> & {
    key: Unique<MerchantFlowDayRow, string>;
    businessId: Indexed<MerchantFlowDayRow, number>;
    day: Indexed<MerchantFlowDayRow, number>;
  };
}
