import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, log } from '../env';

export const FINANCE_AGENT_NAMES = {
  impact_analyst: 'Finance Impact Analyst',
  impact_reviewer: 'Finance Impact Reviewer',
  close_controller: 'Close Controller',
  advisor: 'Forecast and Drivers Advisor',
  guardian: 'Exposure Guardian',
} as const;
export type FinanceSeat = keyof typeof FINANCE_AGENT_NAMES;
const ENV: Record<FinanceSeat, string> = {
  impact_analyst: 'CREAO_AGENT_IMPACT_ANALYST',
  impact_reviewer: 'CREAO_AGENT_IMPACT_REVIEWER',
  close_controller: 'CREAO_AGENT_CLOSE_CONTROLLER',
  advisor: 'CREAO_AGENT_ADVISOR',
  guardian: 'CREAO_AGENT_GUARDIAN',
};

const EvidenceFlag = z.object({ code: z.string(), reason: z.string(), evidence_ids: z.array(z.string()) }).strict();
const ImpactSuccess = z.object({
  materiality: z.enum(['immaterial', 'watch', 'material']), flags: z.array(EvidenceFlag), controller_must_see: z.boolean(),
  rationale: z.string(), next_quarter_note: z.string(), confidence: z.number().min(0).max(1),
}).strict();
const ImpactError = z.object({ error: z.literal('insufficient_input'), missing: z.array(z.string()) }).strict();
const Schemas = {
  impact_analyst: z.union([ImpactSuccess, ImpactError]),
  impact_reviewer: z.object({ verdict: z.enum(['agree', 'escalate', 'reject']), unsupported_claims: z.array(z.string()), reasons: z.array(z.string()), evidence_ids: z.array(z.string()) }).strict(),
  close_controller: z.object({ may_lock: z.boolean(), conditions: z.array(z.string()), memo: z.string(), unused_fields: z.array(z.string()) }).strict(),
  advisor: z.object({ why_period_moved: z.string(), scenario_picked: z.string(), actions: z.array(z.object({ action: z.string(), owner: z.enum(['finance', 'procurement', 'pricing', 'fraud_ops', 'support']), driver: z.string(), evidence_ids: z.array(z.string()), effect_cents: z.number().int() }).strict()) }).strict(),
  guardian: z.object({ proposed_rung: z.enum(['normal', 'watch', 'hedge', 'pause']), reason: z.string(), evidence_ids: z.array(z.string()), customer_notice_draft: z.string(), expires_in_hours: z.number().int().nonnegative() }).strict(),
} satisfies Record<FinanceSeat, z.ZodTypeAny>;

export type FinanceAgentResult = {
  seat: FinanceSeat; status: 'completed' | 'rejected' | 'unavailable'; mode: 'live' | 'replay' | 'mock';
  label: 'Live' | 'Replay of real run' | 'Simulated (agent not connected)'; output?: unknown; error?: string;
  runId?: string; runUrl?: string; agentId?: string; durationMs: number;
};

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  return JSON.stringify(v);
};
const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
const safeInput = (v: unknown) => stable(v);
const financeDir = resolve(REPO_ROOT, 'worker/fixtures/finance');

function mockOutput(seat: FinanceSeat, input: unknown): unknown {
  const i = input as Record<string, any>;
  if (seat === 'impact_analyst') {
    if (!i.impact?.refund || !i.impact?.vouch || !i.impact?.deltas || !i.impact?.baseline) return { error: 'insufficient_input', missing: ['impact.refund', 'impact.vouch', 'impact.deltas', 'impact.baseline'] };
    return { materiality: 'watch', flags: (i.impact.required_flags ?? []).map((code: string) => ({ code, reason: 'Required by the code-computed control input.', evidence_ids: i.impact.vouch?.evidence_ids ?? [] })), controller_must_see: true, rationale: 'The refund changes the company books and remains subject to the configured controller controls.', next_quarter_note: 'Track the return completion rate against the trailing tier and category baseline.', confidence: 0.5 };
  }
  if (seat === 'impact_reviewer') return { verdict: 'escalate', unsupported_claims: [], reasons: ['Mock reviewer is offline; keep the controller review required by policy.'], evidence_ids: [] };
  if (seat === 'close_controller') return { may_lock: false, conditions: ['Mock close controller is offline; a human controller must review the bridge.'], memo: 'Period close remains open because the finance agent is not connected. Review the bridge and any unexplained amount before locking.', unused_fields: [] };
  if (seat === 'advisor') return { why_period_moved: 'A live drivers advisor is not connected; the code-built driver board remains the source for actions.', scenario_picked: i.scenario_options?.[0] ?? 'UNKNOWN', actions: [] };
  const exposure = i.exposure ?? {};
  const rung = exposure.current_rung ?? 'normal';
  const expiry = exposure.expiry_by_rung?.[rung] ?? exposure.allowed_expiries_hours?.[0] ?? 24;
  return { proposed_rung: rung, reason: 'Guardian agent is not connected; no rung change is proposed.', evidence_ids: [], customer_notice_draft: `Your refund is under review. We will update you within ${expiry} hours.`, expires_in_hours: expiry };
}

function containsInputReference(input: unknown, output: unknown): boolean {
  const src = safeInput(input);
  const numberTokens = (text: string) => (text.match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) ?? []).map((token) => token.replaceAll(',', ''));
  const inputNumbers: number[] = [];
  const collectNumbers = (v: unknown) => {
    if (typeof v === 'number') inputNumbers.push(v);
    else if (Array.isArray(v)) v.forEach(collectNumbers);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(collectNumbers);
  };
  collectNumbers(input);
  const allowedNumbers = new Set(inputNumbers.flatMap((n) => Number.isInteger(n)
    ? [String(n), (n / 100).toFixed(2), new Intl.NumberFormat('en-US', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100), new Intl.NumberFormat('en-US').format(n)]
    : [String(n)]).map((n) => n.replaceAll(',', '')));
  for (const n of numberTokens(src)) allowedNumbers.add(n);
  const visit = (v: unknown, key = ''): boolean => {
    if (typeof v === 'number') return key === 'confidence' || src.includes(String(v));
    if (typeof v === 'string') {
      if (key === 'evidence_ids') return src.includes(JSON.stringify(v));
      const numbers = numberTokens(v);
      if (numbers.some((n) => !allowedNumbers.has(n))) return false;
      return true;
    }
    if (Array.isArray(v)) return v.every((x) => visit(x, key));
    if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).every(([k, x]) => visit(x, k));
    return true;
  };
  return visit(output);
}

function validate(seat: FinanceSeat, input: unknown, raw: unknown): { output?: unknown; error?: string } {
  const parsed = Schemas[seat].safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') };
  if (!containsInputReference(input, parsed.data)) return { error: 'output contains a number or evidence id that was not present in the agent input' };
  const data = parsed.data as Record<string, any>;
  if (seat === 'impact_analyst' && Array.isArray(data.flags)) {
    const required = new Set(((input as any)?.impact?.required_flags ?? []) as string[]);
    const returned = new Set(data.flags.map((f: { code: string }) => f.code));
    if ([...required].some((code) => !returned.has(code))) return { error: 'agent attempted to remove a required control flag' };
  }
  if (seat === 'close_controller' && data.may_lock && (input as any)?.code_may_lock === false) return { error: 'agent attempted to lift a code-required hold on period close' };
  if (seat === 'advisor' && !((input as any)?.scenario_options ?? []).includes(data.scenario_picked)) return { error: 'scenario_picked is not one of the code-computed scenarios' };
  if (seat === 'guardian') {
    const e = (input as any).exposure;
    if (!e?.allowed_rungs?.includes(data.proposed_rung)) return { error: 'Guardian proposed a rung disallowed by code' };
    const rungs = ['normal', 'watch', 'hedge', 'pause'];
    if (Math.abs(rungs.indexOf(data.proposed_rung) - rungs.indexOf(e.current_rung)) > 1) return { error: 'Guardian moved more than one rung' };
    if (!e.allowed_expiries_hours?.includes(data.expires_in_hours) || e.expiry_by_rung?.[data.proposed_rung] !== data.expires_in_hours) return { error: 'Guardian expiry is not the code-configured value for that rung' };
    if (!/under review/i.test(data.customer_notice_draft) || !new RegExp(`\\b(?:within|in)\\s+${data.expires_in_hours}\\s+hours?\\b`, 'i').test(data.customer_notice_draft)) return { error: 'Guardian notice must say the refund is under review and give the configured update time' };
    if (/\b(denied|declined|rejected)\b/i.test(data.customer_notice_draft)) return { error: 'Guardian notice may not deny the customer' };
  }
  return { output: parsed.data };
}

export const validateFinanceOutput = validate;

function mock(input: unknown, seat: FinanceSeat, started: number, extraError?: string): FinanceAgentResult {
  const valid = validate(seat, input, mockOutput(seat, input));
  const error = extraError ?? valid.error;
  log(`WAITING FOR HUMAN: create ${FINANCE_AGENT_NAMES[seat]} in CREAO and set ${ENV[seat]}`);
  return { seat, status: error ? 'rejected' : 'unavailable', mode: 'mock', label: 'Simulated (agent not connected)', ...(valid.output ? { output: valid.output } : {}), ...(error ? { error } : {}), durationMs: Date.now() - started };
}

function replayFile(seat: FinanceSeat) { return resolve(financeDir, `${seat}.jsonl`); }
function findReplay(seat: FinanceSeat, input: unknown) {
  const file = replayFile(seat);
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean).reverse()) {
    try { const r = JSON.parse(line) as { inputHash: string; output: unknown; runId?: string; runUrl?: string; agentId?: string }; if (r.inputHash === hash(input)) return r; } catch { /* ignore a partial final record */ }
  }
  return undefined;
}

export type FinanceRunStarted = { runId: string; runUrl: string; agentId: string };

async function liveRun(seat: FinanceSeat, input: unknown, agentId: string, onStarted?: (run: FinanceRunStarted) => Promise<void> | void) {
  const key = process.env.CREAO_API_KEY?.trim();
  if (!key) throw new Error('CREAO_API_KEY is not set in the worker environment');
  const base = (process.env.CREAO_ACCOUNT_BASE || 'https://developer.creao.ai/v1').replace(/\/$/, '');
  const started = await fetch(`${base}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ agent_id: agentId, input: { case: JSON.stringify(input) } }) });
  if (!started.ok) throw new Error(`CREAO start failed (${started.status})`);
  const body = await started.json() as { run_id?: string; share_url?: string };
  if (!body.run_id) throw new Error('CREAO response did not include run_id');
  const run = { runId: body.run_id, runUrl: body.share_url ?? '', agentId };
  await onStarted?.(run);
  return { ...run, raw: await waitForLiveRun(run.runId) };
}

async function waitForLiveRun(runId: string) {
  const key = process.env.CREAO_API_KEY?.trim();
  if (!key) throw new Error('CREAO_API_KEY is not set in the worker environment');
  const base = (process.env.CREAO_ACCOUNT_BASE || 'https://developer.creao.ai/v1').replace(/\/$/, '');
  const deadline = Date.now() + Number(process.env.FINANCE_CREAO_TIMEOUT_MS || 15 * 60_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Number(process.env.CREAO_POLL_MS || 15_000)));
    const response = await fetch(`${base}/runs/${runId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) continue;
    const result = await response.json() as { status?: string; result?: { text?: string }; output?: string };
    if (result.status === 'failed' || result.status === 'cancelled') throw new Error(`CREAO run ${result.status}`);
    if (result.status !== 'completed') continue;
    const text = result.result?.text ?? result.output;
    if (!text) throw new Error('CREAO completed without output text');
    const trimmed = text.replace(/```(?:json)?/g, '');
    const start = trimmed.indexOf('{'); const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('CREAO output was not a JSON object');
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
  throw new Error('CREAO finance run timed out');
}

export async function resumeFinanceAgentRun(seat: FinanceSeat, input: unknown, run: FinanceRunStarted): Promise<FinanceAgentResult> {
  const startedAt = Date.now();
  try {
    const raw = await waitForLiveRun(run.runId);
    const checked = validate(seat, input, raw);
    if (checked.error) return { seat, status: 'rejected', mode: 'live', label: 'Live', error: checked.error, ...run, durationMs: Date.now() - startedAt };
    if (process.env.RECORD_FINANCE_CREAO === '1') {
      mkdirSync(financeDir, { recursive: true });
      appendFileSync(replayFile(seat), `${JSON.stringify({ inputHash: hash(input), input, output: checked.output, ...run })}\n`);
    }
    return { seat, status: 'completed', mode: 'live', label: 'Live', output: checked.output, ...run, durationMs: Date.now() - startedAt };
  } catch (e) {
    return { seat, status: 'rejected', mode: 'live', label: 'Live', error: (e as Error).message, ...run, durationMs: Date.now() - startedAt };
  }
}

export async function runFinanceAgent(seat: FinanceSeat, input: unknown, onStarted?: (run: FinanceRunStarted) => Promise<void> | void): Promise<FinanceAgentResult> {
  const startedAt = Date.now();
  const mode = (process.env.FINANCE_CREAO_MODE || 'mock').toLowerCase();
  const agentId = process.env[ENV[seat]]?.trim() || '';
  if (mode === 'replay') {
    const replay = findReplay(seat, input);
    if (!replay) return mock(input, seat, startedAt, 'no recorded output matches this input');
    const checked = validate(seat, input, replay.output);
    return checked.error ? { seat, status: 'rejected', mode: 'replay', label: 'Replay of real run', error: checked.error, runId: replay.runId, runUrl: replay.runUrl, agentId: replay.agentId, durationMs: Date.now() - startedAt }
      : { seat, status: 'completed', mode: 'replay', label: 'Replay of real run', output: checked.output, runId: replay.runId, runUrl: replay.runUrl, agentId: replay.agentId, durationMs: Date.now() - startedAt };
  }
  if (mode !== 'live' || !agentId || !process.env.CREAO_API_KEY?.trim()) return mock(input, seat, startedAt);
  try {
    const run = await liveRun(seat, input, agentId, onStarted);
    const checked = validate(seat, input, run.raw);
    if (checked.error) return { seat, status: 'rejected', mode: 'live', label: 'Live', error: checked.error, runId: run.runId, runUrl: run.runUrl, agentId, durationMs: Date.now() - startedAt };
    const result: FinanceAgentResult = { seat, status: 'completed', mode: 'live', label: 'Live', output: checked.output, runId: run.runId, runUrl: run.runUrl, agentId, durationMs: Date.now() - startedAt };
    if (process.env.RECORD_FINANCE_CREAO === '1') {
      mkdirSync(financeDir, { recursive: true });
      appendFileSync(replayFile(seat), `${JSON.stringify({ inputHash: hash(input), input, output: checked.output, runId: run.runId, runUrl: run.runUrl, agentId })}\n`);
    }
    return result;
  } catch (e) {
    return { seat, status: 'rejected', mode: 'live', label: 'Live', error: (e as Error).message, agentId, durationMs: Date.now() - startedAt };
  }
}

export function financeCreaoEnvStatus() {
  return (Object.keys(FINANCE_AGENT_NAMES) as FinanceSeat[]).map((seat) => ({ seat, name: FINANCE_AGENT_NAMES[seat], env: ENV[seat], configured: !!process.env[ENV[seat]]?.trim(), keyConfigured: !!process.env.CREAO_API_KEY?.trim() }));
}

export async function checkFinanceCreaoAgents() {
  const status = financeCreaoEnvStatus();
  const accountKey = process.env.CREAO_API_KEY?.trim();
  if (!accountKey) return status.map((s) => ({ ...s, found: false, nameMatches: false, checked: false }));
  const base = (process.env.CREAO_ACCOUNT_BASE || 'https://developer.creao.ai/v1').replace(/\/$/, '');
  const response = await fetch(`${base}/agents`, { headers: { Authorization: `Bearer ${accountKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CREAO GET /v1/agents failed (${response.status})`);
  const body = await response.json() as unknown;
  const list = Array.isArray(body) ? body : (body as { agents?: unknown[]; data?: unknown[] }).agents ?? (body as { data?: unknown[] }).data ?? [];
  const agents = (list as { agent_id?: string; id?: string; name?: string }[]).map((a) => ({ id: a.agent_id ?? a.id ?? '', name: a.name ?? '' }));
  return status.map((s) => {
    const id = process.env[s.env]?.trim() ?? '';
    const found = agents.find((a) => id ? a.id === id : a.name.trim().toLowerCase() === s.name.toLowerCase());
    return { ...s, found: !!found, nameMatches: !!found && found.name.trim().toLowerCase() === s.name.toLowerCase(), checked: true };
  });
}
