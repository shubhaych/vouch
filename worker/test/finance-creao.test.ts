import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runFinanceAgent, validateFinanceOutput } from '../src/finance/creao';

const ENV = ['FINANCE_CREAO_MODE', 'CREAO_API_BASE', 'CREAO_POLL_MS', 'CREAO_FINANCE_IMPACT_ANALYST_APP_ID', 'CREAO_FINANCE_IMPACT_ANALYST_API_KEY', 'CREAO_FINANCE_IMPACT_REVIEWER_APP_ID', 'CREAO_FINANCE_IMPACT_REVIEWER_API_KEY', 'CREAO_FINANCE_CLOSE_CONTROLLER_APP_ID', 'CREAO_FINANCE_CLOSE_CONTROLLER_API_KEY', 'CREAO_FINANCE_ADVISOR_APP_ID', 'CREAO_FINANCE_ADVISOR_API_KEY', 'CREAO_FINANCE_GUARDIAN_APP_ID', 'CREAO_FINANCE_GUARDIAN_API_KEY'] as const;
const saved = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV) { saved.set(key, process.env[key]); delete process.env[key]; }
  process.env.FINANCE_CREAO_MODE = 'mock';
});
afterEach(() => {
  for (const key of ENV) { const v = saved.get(key); if (v === undefined) delete process.env[key]; else process.env[key] = v; }
  globalThis.fetch = originalFetch;
});

const impactInput = {
  impact: {
    refund: { decision_id: 'D-1', amount_cents: 1000, tier: 'T2', legs: [{ leg: 1, amount_cents: 600, condition: 'approved' }] },
    vouch: { score: 700, band: 'good', formula_version: 'v1', evidence_ids: ['A-1'] },
    deltas: { revenue_cents: -600, cash_cents: -600, receivable_cents: 400, reserve_cents: 200 },
    baseline: { refund_rate_30d: 0.1, materiality_cents: 5000, tier_completion_rate: 0.8 },
    required_flags: ['reserve_watch'],
  },
};

describe('finance CREAO adapter before live agents exist', () => {
  it('returns a schema-valid, labelled mock and preserves code-required flags', async () => {
    const r = await runFinanceAgent('impact_analyst', impactInput);
    expect(r.status).toBe('unavailable');
    expect(r.label).toBe('Simulated (agent not connected)');
    expect(r.output).toMatchObject({ flags: [{ code: 'reserve_watch' }], controller_must_see: true });
  });

  it('returns insufficient_input for incomplete analyst input', async () => {
    const r = await runFinanceAgent('impact_analyst', { impact: { refund: {} } });
    expect(r.output).toEqual({ error: 'insufficient_input', missing: ['impact.refund', 'impact.vouch', 'impact.deltas', 'impact.baseline'] });
  });

  it('all five seats produce mock outputs that pass their own schemas', async () => {
    const cases = [
      ['impact_reviewer', { impact: impactInput.impact, analyst: { materiality: 'watch' } }],
      ['close_controller', { close_summary: { period: '2026-09', totals: { ledger: 100, processor: 100, bank: 100 }, bridge_lines: [], unexplained_cents: 0 }, code_may_lock: false }],
      ['advisor', { drivers: {}, scenario_options: ['reconciliation_variance'] }],
      ['guardian', { exposure: { current_rung: 'normal', allowed_rungs: ['normal'], allowed_expiries_hours: [24], expiry_by_rung: { normal: 24 }, evidence_ids: [] } }],
    ] as const;
    for (const [seat, input] of cases) {
      const result = await runFinanceAgent(seat, input);
      expect(result.output, seat).toBeDefined();
      expect(validateFinanceOutput(seat, input, result.output).error, seat).toBeUndefined();
    }
  });

  it('starts on the app route and polls the documented run route using that seat’s app key', async () => {
    process.env.FINANCE_CREAO_MODE = 'live';
    process.env.CREAO_API_BASE = 'https://creao.test/api/v1';
    process.env.CREAO_POLL_MS = '1';
    process.env.CREAO_FINANCE_IMPACT_REVIEWER_APP_ID = 'reviewer-app';
    process.env.CREAO_FINANCE_IMPACT_REVIEWER_API_KEY = 'capi-reviewer';
    const calls: { url: string; method: string; authorization: string | null; body?: unknown }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, authorization: new Headers(init?.headers).get('authorization'), ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}) });
      if (method === 'POST') return new Response(JSON.stringify({ id: 'run-123' }), { status: 202 });
      return new Response(JSON.stringify({ status: 'completed', result: { text: JSON.stringify({ verdict: 'agree', unsupported_claims: [], reasons: [], evidence_ids: [] }) } }), { status: 200 });
    }) as typeof fetch;

    const result = await runFinanceAgent('impact_reviewer', { impact: { evidence_ids: [] } });
    expect(result.status).toBe('completed');
    expect(result.mode).toBe('live');
    expect(calls.map((x) => [x.method, x.url])).toEqual([
      ['POST', 'https://creao.test/api/v1/apps/reviewer-app/runs'],
      ['GET', 'https://creao.test/api/v1/runs/run-123'],
    ]);
    expect(calls.every((x) => x.authorization === 'Bearer capi-reviewer')).toBe(true);
    expect(calls[0]?.body).toEqual({ inputs: { case: JSON.stringify({ impact: { evidence_ids: [] } }) } });
  });

  it('rejects an agent output that lifts the code-required close hold', () => {
    expect(validateFinanceOutput('close_controller', { code_may_lock: false }, { may_lock: true, conditions: [], memo: '', unused_fields: [] }).error)
      .toContain('lift a code-required hold');
  });

  it('accepts comma-grouped dollar amounts only when their cents value is in the input', () => {
    const input = { code_may_lock: false, close_summary: { totals: { ledger: 123456 } } };
    const accepted = validateFinanceOutput('close_controller', input, { may_lock: false, conditions: [], memo: 'Ledger total: $1,234.56', unused_fields: [] });
    const rejected = validateFinanceOutput('close_controller', input, { may_lock: false, conditions: [], memo: 'Unprovided total: $9.99', unused_fields: [] });
    expect(accepted.error).toBeUndefined();
    expect(rejected.error).toContain('number or evidence id');
  });

  it('does not propose a Guardian rung that is not allowed by the code input', async () => {
    const r = await runFinanceAgent('guardian', { exposure: { current_rung: 'normal', allowed_rungs: ['normal'], allowed_expiries_hours: [24], expiry_by_rung: { normal: 24 }, evidence_ids: [] } });
    expect(r.status).toBe('unavailable');
    expect(r.output).toMatchObject({ proposed_rung: 'normal', expires_in_hours: 24 });
    expect(validateFinanceOutput('guardian', { exposure: { current_rung: 'normal', allowed_rungs: ['normal'], allowed_expiries_hours: [24], expiry_by_rung: { normal: 24 }, evidence_ids: [] } }, { proposed_rung: 'pause', reason: 'jumped', evidence_ids: [], customer_notice_draft: 'Under review.', expires_in_hours: 24 }).error)
      .toContain('disallowed by code');
  });
});
