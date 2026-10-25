// The Verifier: code, not a model. It only accepts or rejects. An explanation
// counts only if its parts sum to the cluster variance to the cent, every
// proposed entry balances, and every cited id appears in the known set.
import { checkEntry, type DraftEntry } from '@vouch/module/finance/ledger';
import type { ExceptionCluster, ProposedEntry } from './playbooks';

export interface ExplanationInput {
  clusterCents: number;
  parts: { label: string; cents: number }[];
  proposedEntries: ProposedEntry[];
  citedIds: string[];
  knownIds: Set<string>;
}

export interface VerifyResult {
  ok: boolean;
  reasons: string[];
}

/** Re-check a playbook or investigator explanation. Never mutates or "fixes". */
export function verifyExplanation(input: ExplanationInput): VerifyResult {
  const reasons: string[] = [];
  const partsSum = input.parts.reduce((s, p) => s + p.cents, 0);
  if (partsSum !== Math.abs(input.clusterCents)) {
    reasons.push(`parts sum ${partsSum} does not equal cluster variance ${Math.abs(input.clusterCents)} to the cent`);
  }
  for (const entry of input.proposedEntries) {
    const refusal = checkEntry(entry as DraftEntry);
    if (refusal) reasons.push(`proposed entry refused (${refusal.rule}): ${refusal.message}`);
    const entrySum = entry.lines.reduce((s, l) => s + l.debit, 0);
    if (entry.cents !== entrySum) reasons.push(`proposed entry cents ${entry.cents} do not match line debits ${entrySum}`);
  }
  for (const id of input.citedIds) {
    if (!input.knownIds.has(id)) reasons.push(`cited id ${id} does not exist in the input set`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Verify every playbook cluster; demote failures to unexplained. */
export function verifyClusters(clusters: ExceptionCluster[]): {
  clusters: ExceptionCluster[];
  closedByPlaybook: number;
  toInvestigator: number;
  toController: number;
  rejected: number;
} {
  let closedByPlaybook = 0;
  let toInvestigator = 0;
  let toController = 0;
  let rejected = 0;

  const out = clusters.map((c) => {
    const knownIds = new Set(c.sampleRefs.split(',').map((s) => s.trim()).filter(Boolean));
    for (const id of c.orderIds) knownIds.add(`order:${id}`);
    let proposal: ProposedEntry[] = [];
    try { proposal = JSON.parse(c.proposalJson || '[]') as ProposedEntry[]; } catch { proposal = []; }

    if (c.status === 'playbook') {
      const check = verifyExplanation({
        clusterCents: c.cents,
        parts: [{ label: c.cls, cents: Math.abs(c.cents) }],
        proposedEntries: proposal,
        citedIds: c.sampleRefs.split(',').map((s) => s.trim()).filter(Boolean),
        knownIds,
      });
      const proposalTotal = proposal.reduce((s, e) => s + e.cents, 0);
      if (proposal.length && proposalTotal !== Math.abs(c.cents)) {
        check.ok = false;
        check.reasons.push(`proposed entries total ${proposalTotal} does not equal cluster ${Math.abs(c.cents)}`);
      }
      if (!check.ok) {
        rejected += 1;
        toInvestigator += c.orders;
        return { ...c, status: 'unexplained', explanation: `Verifier rejected: ${check.reasons.join('; ')}` };
      }
      closedByPlaybook += c.orders;
      return { ...c, status: 'playbook', explanation: c.explanation || 'Playbook proposal verified to the cent.' };
    }
    if (c.status === 'controller') {
      toController += c.orders;
      return c;
    }
    toInvestigator += c.orders;
    return { ...c, status: 'unexplained' };
  });

  return { clusters: out, closedByPlaybook, toInvestigator, toController, rejected };
}

/** Deliberately wrong explanation for the acceptance test. */
export function deliberatelyWrongExplanation(clusterCents: number): ExplanationInput {
  return {
    clusterCents,
    parts: [{ label: 'invented', cents: Math.abs(clusterCents) + 1 }],
    proposedEntries: [{
      kind: 'clawback', period: '2026-09', memo: 'unbalanced', cents: Math.abs(clusterCents),
      lines: [{ account: '4100', debit: Math.abs(clusterCents), credit: 0 }],
      orderIds: [],
    }],
    citedIds: ['order:999999999'],
    knownIds: new Set(['order:1']),
  };
}
