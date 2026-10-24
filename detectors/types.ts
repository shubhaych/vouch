// The detector contract. Detectors see behaviour only: purchases, refunds and
// per-agent counts. They never see ground truth, and the coordinated detector
// may not use region or business as a feature (a test shuffles regions).

export interface Purchase {
  id: bigint; buyer: number; business: number; item: number; category: string; amount: number; day: number;
  deliverDay: number; windowEndDay: number; status: string;
}
export interface Refund {
  id: bigint; purchaseId: bigint; agentId: number; businessId: number; amount: number; day: number;
  reasonCode: string; reasonText: string; status: string;
}
export interface AgentLite { id: number; region: number; score: number; purchases: number; refunds: number }

export interface History { day: number; purchases: Purchase[]; refunds: Refund[]; agents: AgentLite[] }

export interface CandidateEvent { table: 'purchase' | 'refund'; id: bigint; day: number; why: string }

export interface Candidate {
  kind: 'false_defect' | 'refund_frequency' | 'coordinated';
  agentIds: number[];
  businessIds: number[];
  events: CandidateEvent[];
  /** Shown on the pattern card and sent to the Pattern Analyst. */
  features: Record<string, number | string>;
}

export interface Detector { id: string; version: number; run(h: History): Candidate[] }
