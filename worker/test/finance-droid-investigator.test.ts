import { describe, expect, it } from 'vitest';
import { decideInvestigatorTool, investigateException } from '../src/finance/droid-investigator';

const input = { clusterId: 'cluster-1', period: '2026-09', cause: 'settlement timing', varianceCents: 125, sourceRows: [{ id: 'order:7', source: 'processor', amountCents: 125, detail: 'processor settled refund' }], exceptionRows: [{ orderId: 7, cause: 'settlement timing', cents: 125, winner: 'processor', why: 'processor is authoritative' }] };

describe('finance Droid exception investigator', () => {
  it('returns a schema-valid mock that escalates instead of posting', () => {
    const result = investigateException(input);
    expect(result.mode).toBe('mock');
    expect(result.output.status).toBe('needs_controller');
    expect(result.output.proposed_entries).toEqual([]);
    expect(result.output.controls_added).toContain('controller_review');
  });
  it('rejects an output that cites an id outside the evidence bundle', () => {
    expect(() => investigateException(input, 'replay', { ...investigateException(input).output, cited_ids: ['order:999'] })).toThrow(/unknown cluster or cited source id/);
  });
  it('fences arbitrary reads, shell and writes', () => {
    expect(decideInvestigatorTool({ type: 'read', path: 'evidence/order:7.json' }).outcome).toBe('allow');
    expect(decideInvestigatorTool({ type: 'exec', command: 'cat secrets' }).outcome).toBe('cancel');
    expect(decideInvestigatorTool({ type: 'write', path: 'evidence/order:7.json' }).outcome).toBe('cancel');
  });
});
