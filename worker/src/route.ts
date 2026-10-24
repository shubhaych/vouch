import type { Seat } from '@vouch/module/types';

// The Desk Lead is worker code, not an agent: it only routes a case to the
// right seat, so routing spends no credits and an agent never starts itself.

export type CaseEvent =
  | { kind: 'new_customer'; subjectId: string }
  | { kind: 'record_expired'; subjectId: string }
  | { kind: 'incident'; subjectId: string }
  | { kind: 'agent_registered'; agentId: string }
  | { kind: 'agent_order'; agentId: string; orderId: string }
  | { kind: 'contested_claim'; claimId: string }
  | { kind: 'chargeback'; claimId: string }
  | { kind: 'post_payment_review'; claimId: string }
  | { kind: 'nightly' }
  | { kind: 'break'; ref: string };

export interface Route { seat: Seat; caseRef: string }

export function routeCase(e: CaseEvent): Route {
  switch (e.kind) {
    case 'new_customer': case 'record_expired': case 'incident':
      return { seat: 'credit_analyst', caseRef: e.subjectId };
    case 'agent_registered':
      return { seat: 'agent_order', caseRef: e.agentId };
    case 'agent_order':
      return { seat: 'agent_order', caseRef: e.orderId };
    case 'contested_claim': case 'chargeback': case 'post_payment_review':
      return { seat: 'refund_desk', caseRef: e.claimId };
    case 'nightly':
      return { seat: 'reconciler', caseRef: 'nightly' };
    case 'break':
      return { seat: 'reconciler', caseRef: e.ref };
  }
}
