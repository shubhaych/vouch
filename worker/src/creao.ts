// CREAO API Trigger adapter. Supports both documented paths and picks one
// per seat (shapes from CREAO's API Trigger and API Paths docs, read Oct 24;
// check with scripts/hello-creao.ts):
//
//   app key     capi_   https://agent.creao.ai/api/v1/apps/{appId}   POST /runs {inputs:{case}, webhookUrl}; poll GET /api/v1/runs/{id}
//   account key cr_sk_  https://developer.creao.ai/v1       POST /runs {agent_id, input:{case}, webhook_url}
//
// A seat with CREAO_<SEAT>_APP_ID and a capi_ key (CREAO_<SEAT>_KEY) always runs
// on its own app, so no account key is needed. Seats without one fall back to
// the account key if there is one. Do not mix the bodies: /v1/runs expects
// agent_id + input, the app path expects inputs.
// Runs take minutes. Polling every 15 s is the primary path (it works from a
// cloud session); webhooks are a best-effort optimisation on the laptop.
import { OPTIONAL_SEATS, config, log, type Seat } from './env';
import { fixtureResponse } from './fixtures';

export const AGENT_NAMES: Record<Seat, string> = {
  evidence_analyst: 'Vouch Evidence Analyst',
  refund_investigator: 'Vouch Refund Investigator',
  pattern_analyst: 'Vouch Pattern Analyst',
  refund_reviewer: 'Vouch Refund Reviewer',
  customer_liaison: 'Vouch Customer Liaison',
  listing_matcher: 'Vouch Listing Matcher',
  returns_monitor: 'Vouch Returns Monitor',
  policy_checker: 'Vouch Policy Checker',
  risk_scorecard: 'Vouch Risk Scorecard',
  score_reviewer: 'Vouch Score Reviewer',
};

/** True when a live run of this seat can start: fixture mode, its own app, or the saved agent was found (optional seats may be missing). */
export function seatAvailable(seat: Seat): boolean {
  const path = seatPath(seat);
  if (path === 'fixture' || path === 'app') return true;
  if (path === 'none') return false;
  return !!resolvedIds[seat] || !OPTIONAL_SEATS.includes(seat);
}

export type ApiPath = 'account' | 'app' | 'fixture';
export interface RunHandle { runId: string; seat: Seat; path: ApiPath; conversationId: string; runUrl: string }
/** text is the structured result CREAO returns; chat is the agent's own prose answer (result.chatText), used to fill fields the saved output leaves out. */
export interface RunResult { status: 'completed' | 'failed' | 'cancelled' | 'running'; text: string | null; raw: unknown; chat?: string | null }

const ACCOUNT_BASE = process.env.CREAO_ACCOUNT_BASE || 'https://developer.creao.ai/v1';
const APP_BASE = process.env.CREAO_APP_BASE || 'https://agent.creao.ai/api/v1/apps';
// The hackathon API docs poll every run at GET /api/v1/runs/{id}, whichever route started it.
const RUNS_BASE = process.env.CREAO_RUNS_BASE || 'https://agent.creao.ai/api/v1/runs';

const hasAccountKey = () => config.creao.apiKey.startsWith('cr_sk_');
// A cr_sk_ account key is never sent to an app; a shared capi_ key in CREAO_API_KEY is.
const appKey = (seat: Seat) => config.creao.appKeys[seat] || (config.creao.apiKey.startsWith('capi_') ? config.creao.apiKey : '');

/** How this seat runs: its own app when it has an app id and key, else the account key, else 'none' (not configured). */
export function seatPath(seat: Seat): ApiPath | 'none' {
  if (config.creao.mode === 'fixture') return 'fixture';
  if (config.creao.appIds[seat] && appKey(seat)) return 'app';
  return hasAccountKey() ? 'account' : 'none';
}

/** The overall path, for logs: app when any seat has its own app, else account. */
export function apiPath(): ApiPath {
  if (config.creao.mode === 'fixture') return 'fixture';
  if ((Object.keys(AGENT_NAMES) as Seat[]).some((s) => seatPath(s) === 'app')) return 'app';
  if (hasAccountKey()) return 'account';
  throw new Error('CREAO_MODE=live needs CREAO_<SEAT>_APP_ID + CREAO_<SEAT>_KEY (capi_) per agent, or a cr_sk_ account key in CREAO_API_KEY');
}

const resolvedIds: Partial<Record<Seat, string>> = {};

/** App seats use their app id. Account seats are found by exact name unless CREAO_<SEAT>_AGENT_ID is set. Fails loudly if a core seat has neither. */
export async function resolveAgents(): Promise<Record<Seat, string>> {
  const out = {} as Record<Seat, string>;
  const missing: Seat[] = [];
  for (const seat of Object.keys(AGENT_NAMES) as Seat[]) {
    const path = seatPath(seat);
    if (path === 'app') out[seat] = config.creao.appIds[seat];
    else if (path === 'none') {
      if (OPTIONAL_SEATS.includes(seat)) continue;
      const S = seat.toUpperCase();
      throw new Error(`${seat} has no CREAO app: set CREAO_${S}_APP_ID and CREAO_${S}_KEY (capi_)`);
    } else if (config.creao.agentIds[seat]) out[seat] = config.creao.agentIds[seat];
    else missing.push(seat);
  }
  if (missing.length && hasAccountKey()) {
    const res = await fetch(`${ACCOUNT_BASE}/agents`, { headers: { Authorization: `Bearer ${config.creao.apiKey}` } });
    if (!res.ok) throw new Error(`GET /v1/agents: ${res.status}`);
    const body = (await res.json()) as unknown;
    const list = (Array.isArray(body) ? body : ((body as { agents?: unknown[]; data?: unknown[] }).agents ?? (body as { data?: unknown[] }).data ?? [])) as { agent_id?: string; id?: string; name?: string }[];
    for (const seat of missing) {
      const hit = list.find((a) => a.name?.trim().toLowerCase() === AGENT_NAMES[seat].toLowerCase());
      if (!hit) {
        if (OPTIONAL_SEATS.includes(seat)) { log(`no saved CREAO agent named "${AGENT_NAMES[seat]}": the ${seat.replace('_', ' ')} seat is offline`); continue; }
        throw new Error(`no saved CREAO agent named "${AGENT_NAMES[seat]}" (found: ${list.map((a) => a.name).join(', ') || 'none'})`);
      }
      out[seat] = (hit.agent_id ?? hit.id)!;
    }
  }
  Object.assign(resolvedIds, out);
  log('CREAO agents:', Object.entries(out).map(([s, id]) => `${s}=${seatPath(s as Seat)}:${id}`).join(' '));
  return out;
}

/** Starts a run. The case is sent as JSON text in one input named "case". */
/** fixtureIfMissing: a seat with no app key runs on its recorded fixture (labelled fixture) instead of failing. */
export async function startRun(seat: Seat, caseJson: unknown, caseRef: string, fixtureIfMissing = false): Promise<RunHandle> {
  const path = seatPath(seat) === 'none' && fixtureIfMissing ? 'fixture' : seatPath(seat);
  const text = JSON.stringify(caseJson);
  if (path === 'none') throw new Error(`CREAO seat ${seat} has no app id and key`);
  if (path === 'fixture') {
    return { runId: `fixture-${seat}-${caseRef}-${Date.now().toString(36)}`, seat, path, conversationId: '', runUrl: '' };
  }
  if (path === 'account') {
    const agentId = resolvedIds[seat] ?? (await resolveAgents())[seat];
    if (!agentId) throw new Error(`CREAO seat ${seat} has no saved agent`);
    const res = await fetch(`${ACCOUNT_BASE}/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.creao.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, input: { case: text }, ...(config.creao.webhookUrl ? { webhook_url: config.creao.webhookUrl } : {}) }),
    });
    if (!res.ok) throw new Error(`CREAO start ${seat}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { run_id: string; conversation_id?: string; share_url?: string };
    return { runId: j.run_id, seat, path, conversationId: j.conversation_id ?? '', runUrl: j.share_url ?? '' };
  }
  const appId = config.creao.appIds[seat];
  const res = await fetch(`${APP_BASE}/${appId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${appKey(seat)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: { case: text }, ...(config.creao.webhookUrl ? { webhookUrl: config.creao.webhookUrl } : {}) }),
  });
  if (!res.ok) throw new Error(`CREAO start ${seat}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { id?: string; run_id?: string; runId?: string; threadId?: string };
  const runId = j.id ?? j.runId ?? j.run_id;
  if (!runId) throw new Error(`CREAO start ${seat}: no run id in ${JSON.stringify(j).slice(0, 200)}`);
  return { runId, seat, path, conversationId: j.threadId ?? '', runUrl: '' };
}

/** One poll. Output lives in result.text on the account path; the app path's poll shape is checked defensively. */
export async function pollRun(h: RunHandle, caseJson: unknown): Promise<RunResult> {
  if (h.path === 'fixture') return { status: 'completed', text: JSON.stringify(fixtureResponse(h.seat, caseJson)), raw: { fixture: true } };
  const url = h.path === 'account' ? `${ACCOUNT_BASE}/runs/${h.runId}` : `${RUNS_BASE}/${h.runId}`;
  const key = h.path === 'account' ? config.creao.apiKey : appKey(h.seat);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CREAO poll ${h.seat}: ${res.status}`);
  const raw = (await res.json()) as { status?: string; result?: { text?: string; chatText?: string } | string; output?: string };
  // The app path's status words are unconfirmed; map the common synonyms so a finished run never polls to the time limit.
  const s = String(raw.status ?? 'running').toLowerCase();
  const status: RunResult['status'] = ['completed', 'succeeded', 'success', 'done', 'finished'].includes(s) ? 'completed'
    : ['failed', 'error', 'errored'].includes(s) ? 'failed' : ['cancelled', 'canceled'].includes(s) ? 'cancelled' : 'running';
  const text = typeof raw.result === 'string' ? raw.result : raw.result?.text ?? raw.result?.chatText ?? raw.output ?? null;
  const chat = typeof raw.result === 'object' && raw.result ? raw.result.chatText ?? null : null;
  return { status, text, raw, chat };
}

/** Polls until a terminal status or the time limit. Never holds an HTTP request open: this runs in the worker's own loop. */
export async function waitForRun(h: RunHandle, caseJson: unknown, onStep: (s: string) => void, limitMs = 15 * 60_000): Promise<RunResult> {
  const t0 = Date.now();
  let n = 0;
  for (;;) {
    const r = await pollRun(h, caseJson).catch((e: Error) => ({ status: 'running' as const, text: null, raw: { error: e.message } }));
    if (r.status !== 'running') return r;
    if (Date.now() - t0 > limitMs) return { status: 'failed', text: null, raw: { error: 'timed out' } };
    if (++n % 2 === 1) onStep(`waiting for ${h.seat.replace('_', ' ')} (${Math.round((Date.now() - t0) / 1000)} s)`);
    await new Promise((r2) => setTimeout(r2, h.path === 'fixture' ? 1500 : config.creao.pollMs));
  }
}

// ---- webhooks (laptop only): at least once, so dedupe on delivery id or run id.
const seenDeliveries = new Set<string>();
const webhookWaiters = new Map<string, (r: RunResult) => void>();

export function onWebhookCompletion(runId: string, cb: (r: RunResult) => void) {
  webhookWaiters.set(runId, cb);
}

export function handleWebhook(deliveryId: string | undefined, body: { runId?: string; run_id?: string; status?: string; result?: { text?: string } }): number {
  const runId = body.runId ?? body.run_id;
  const key = deliveryId || runId;
  if (!key || !runId) return 400;
  if (seenDeliveries.has(key)) return 200; // a retry of something already handled
  seenDeliveries.add(key);
  const cb = webhookWaiters.get(runId);
  if (cb && (body.status === 'completed' || body.status === 'failed')) {
    webhookWaiters.delete(runId);
    cb({ status: body.status, text: body.result?.text ?? null, raw: body });
  }
  return 200;
}

/** Every agent returns ONE JSON object. Parse defensively and fail closed to the caller's fallback. */
export function parseVerdict<T extends object>(text: string | null, fallback: T, valid: (v: Record<string, unknown>) => boolean, patch?: (v: Record<string, unknown>) => void): { value: T; ok: boolean } {
  if (!text) return { value: fallback, ok: false };
  const stripped = text.replace(/```(?:json)?/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return { value: fallback, ok: false };
  try {
    const v = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    patch?.(v);
    return valid(v) ? { value: v as T, ok: true } : { value: fallback, ok: false };
  } catch {
    return { value: fallback, ok: false };
  }
}

/** The agent's prose answer as a short plain paragraph: code blocks, markdown and a leading "I'll start by…" line removed. */
export function summaryOf(chat: string | null | undefined, max = 700): string {
  if (!chat) return '';
  const t = chat.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`]/g, '').replace(/^\s*I'll [^.]*\.\s*/i, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const ACTIONS = ['accept', 'decline', 'more_evidence'];
const VERDICTS = ['confirm', 'dismiss', 'needs_review'];

/**
 * Saved CREAO agents can return a trimmed set of fields in result.text (the decision without its reasons),
 * with the reasoning only in their prose answer. When the decision field itself is there, fill what is missing
 * from that prose and say so, instead of failing the whole answer. Garbage (no decision field) still fails closed.
 */
export function fillFromChat(seat: Seat, v: Record<string, unknown>, chat: string | null | undefined): void {
  if (typeof v.case === 'string' || (v.case && typeof v.case === 'object')) delete v.case; // some agents echo their input back
  const sum = summaryOf(chat);
  const fromSummary = sum ? [{ text: sum, cites: 'agent:summary' }] : [];
  if (seat === 'refund_investigator' && ACTIONS.includes(String(v.action))) {
    if (!Array.isArray(v.reasons)) {
      v.reasons = fromSummary.length ? fromSummary : [{ text: 'The agent gave no reasons with its recommendation.', cites: 'agent:no_reasons' }];
      v.reasons_from_summary = true;
      // Uncited reasoning is harder to check, so the recommendation reads as less certain.
      v.confidence = Math.min(Number(v.confidence) || 0, 0.8);
    }
    if (typeof v.needs_controller === 'string') v.needs_controller = v.needs_controller === 'true';
    v.what_would_change_my_mind ??= '';
  }
  if (seat === 'evidence_analyst') {
    // Saved agents may send booleans as "true"/"false" and flatten {value} objects into plain strings.
    if (v.unable_to_verify === 'true' || v.unable_to_verify === 'false') v.unable_to_verify = v.unable_to_verify === 'true';
    for (const k of ['item_matches_reference', 'claimed_defect_visible', 'defect_consistent_with_claim']) if (typeof v[k] === 'string') v[k] = { value: v[k] };
    if (!v.challenge && ('challenge_seen' in v || 'challenge_passed' in v)) {
      const seen = Number(v.challenge_seen);
      v.challenge = { seen: v.challenge_seen === '' || v.challenge_seen == null || Number.isNaN(seen) ? null : seen, passed: v.challenge_passed === 'true' ? true : v.challenge_passed === 'false' ? false : null };
    }
    if (typeof v.unable_to_verify === 'boolean' && typeof v.summary !== 'string') v.summary = sum || 'No summary was returned.';
  }
  if (seat === 'pattern_analyst' && VERDICTS.includes(String(v.verdict)) && typeof v.narrative !== 'string') v.narrative = sum || 'No narrative was returned.';
  if (seat === 'refund_reviewer' && typeof v.agrees === 'boolean' && typeof v.businessSummary !== 'string') v.businessSummary = sum || 'No summary was returned.';
  if (seat === 'listing_matcher' && typeof v.same_as_ordered === 'string') {
    // Saved agents may put the verdict at the top level and send the matched listing as a bare index.
    if (!v.eligibility || typeof v.eligibility !== 'object') v.eligibility = { verdict: ['eligible', 'needs_person', 'ineligible'].includes(String(v.verdict)) ? v.verdict : 'needs_person' };
    if (typeof v.matched_listing === 'number') v.matched_listing = { index: v.matched_listing };
    const e = v.eligibility as Record<string, unknown>;
    if (!Array.isArray(e.reasons)) e.reasons = fromSummary;
    if (typeof v.summary !== 'string') v.summary = sum;
  }
  if (seat === 'policy_checker' && typeof v.outcome === 'string') {
    if (!Array.isArray(v.rules)) v.rules = [];
    if (typeof v.summary !== 'string') v.summary = sum;
  }
  if (seat === 'risk_scorecard' && typeof v.caution === 'string') {
    if (!Array.isArray(v.indicators)) v.indicators = [];
    if (typeof v.summary !== 'string') v.summary = sum;
  }
  if (seat === 'returns_monitor' && (typeof v.narrative === 'string' || Array.isArray(v.anomalies))) {
    if (typeof v.narrative !== 'string') v.narrative = sum || 'No narrative was returned.';
    if (!Array.isArray(v.anomalies)) v.anomalies = [];
  }
}
