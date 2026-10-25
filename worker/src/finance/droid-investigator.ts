import { z } from 'zod';
import type { ReconciliationException } from './reconcile';

/** The only inputs the exception investigator may see. Source rows are already
 * selected by code; Droid never gets a database connection or a free-form SQL tool. */
export const InvestigatorInputSchema = z.object({
  clusterId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  cause: z.string().min(1),
  varianceCents: z.number().int(),
  sourceRows: z.array(z.object({
    id: z.string().min(1), source: z.enum(['processor', 'bank', 'warehouse', 'decision log', 'ledger']),
    amountCents: z.number().int(), detail: z.string().min(1),
  })).min(1),
  exceptionRows: z.array(z.object({ orderId: z.number().int(), cause: z.string(), cents: z.number().int(), winner: z.string(), why: z.string() })),
});
export type InvestigatorInput = z.infer<typeof InvestigatorInputSchema>;

export const InvestigatorOutputSchema = z.object({
  cluster_id: z.string().min(1), status: z.enum(['explained', 'needs_controller', 'needs_more_evidence']),
  explanation: z.string().min(1), parts: z.array(z.object({ label: z.string().min(1), cents: z.number().int() })),
  cited_ids: z.array(z.string()), proposed_entries: z.array(z.object({ kind: z.string(), cents: z.number().int(), source_ref: z.string(), memo: z.string() })),
  controls_added: z.array(z.enum(['controller_review', 'hold_period', 'request_more_evidence'])),
});
export type InvestigatorOutput = z.infer<typeof InvestigatorOutputSchema>;

export type InvestigatorMode = 'mock' | 'replay' | 'live';
export interface InvestigatorResult { mode: InvestigatorMode; output: InvestigatorOutput; transcript: string[]; note?: string }

/** Fence for the exception investigator. It has no write tools and may only
 * inspect the preselected evidence bundle. A refusal is visible in the log. */
export function decideInvestigatorTool(tool: { type: string; name?: string; path?: string; command?: string }): { outcome: 'allow' | 'cancel'; why: string } {
  if (tool.type === 'read' && !!tool.path && tool.path.startsWith('evidence/')) return { outcome: 'allow', why: 'read selected evidence only' };
  return { outcome: 'cancel', why: 'exception investigator has no tool for database writes, shell, network, or arbitrary files' };
}

function mockInvestigation(input: InvestigatorInput): InvestigatorOutput {
  const amount = Math.abs(input.varianceCents);
  const known = new Set(input.sourceRows.map((r) => r.id));
  const parts = input.sourceRows.filter((r) => Math.abs(r.amountCents) > 0).map((r) => ({ label: r.source, cents: Math.abs(r.amountCents) }));
  const total = parts.reduce((sum, p) => sum + p.cents, 0);
  if (total !== amount || !known.size) {
    return { cluster_id: input.clusterId, status: 'needs_more_evidence', explanation: 'The selected source rows do not tie to the variance; a person must provide more evidence.', parts: [{ label: 'unexplained variance', cents: amount }], cited_ids: [], proposed_entries: [], controls_added: ['request_more_evidence'] };
  }
  return { cluster_id: input.clusterId, status: 'needs_controller', explanation: `Source rows explain ${amount} cents, but the investigator never posts or closes a controller decision.`, parts, cited_ids: [...known], proposed_entries: [], controls_added: ['controller_review'] };
}

/** Mock/replay path used until FACTORY_API_KEY is available. Live integration
 * can replace only this function; schema and control checks remain identical. */
export function investigateException(input: unknown, mode: InvestigatorMode = 'mock', recording?: unknown): InvestigatorResult {
  const parsed = InvestigatorInputSchema.parse(input);
  const candidate = mode === 'replay' && recording !== undefined ? InvestigatorOutputSchema.parse(recording) : mockInvestigation(parsed);
  const cited = new Set(parsed.sourceRows.map((r) => r.id));
  if (candidate.cluster_id !== parsed.clusterId || candidate.cited_ids.some((id) => !cited.has(id))) throw new Error('investigator output rejected: unknown cluster or cited source id');
  const parts = candidate.parts.reduce((sum, p) => sum + p.cents, 0);
  if (candidate.status === 'explained' && parts !== Math.abs(parsed.varianceCents)) throw new Error('investigator output rejected: parts do not tie to variance');
  return { mode, output: candidate, transcript: [`${mode === 'mock' ? 'Simulated' : mode === 'replay' ? 'Replay of real run' : 'Live'} exception investigation`, 'No ledger mutation permitted'], note: mode === 'mock' ? 'UNVERIFIED-LIVE: factory: exception investigator ran in mock mode' : undefined };
}

export function inputFromExceptions(clusterId: string, period: string, cause: string, rows: ReconciliationException[]): InvestigatorInput {
  return { clusterId, period, cause, varianceCents: rows.reduce((sum, row) => sum + row.cents, 0), sourceRows: rows.map((row) => ({ id: `order:${row.orderId}`, source: row.winner === 'processor' ? 'processor' : row.winner === 'bank' ? 'bank' : row.winner === 'warehouse' ? 'warehouse' : row.winner === 'decision log' ? 'decision log' : 'ledger', amountCents: row.cents, detail: row.why })), exceptionRows: rows };
}
