// CREAO API Trigger adapter. Supports both documented paths and picks one
// from the key's prefix (shapes from CREAO's API Trigger and API Paths docs,
// read Oct 24; NOT yet run against a live agent: check with
// scripts/hello-creao.ts):
//
//   account key cr_sk_  https://developer.creao.ai/v1       POST /runs {agent_id, input:{case}, webhook_url}
//   app key     capi_   https://agent.creao.ai/api/v1/apps/{appId}   POST /runs {inputs:{case}, webhookUrl}
//
// Do not mix them: /v1/runs expects agent_id + input, the app path expects inputs.
// Runs take minutes. Polling every 15 s is the primary path (it works from a
// cloud session); webhooks are a best-effort optimisation on the laptop.
import { config, log, type Seat } from './env';
import { fixtureResponse } from './fixtures';

export const AGENT_NAMES: Record<Seat, string> = {
  evidence_analyst: 'Vouch Evidence Analyst',
  refund_investigator: 'Vouch Refund Investigator',
  pattern_analyst: 'Vouch Pattern Analyst',
};

export type ApiPath = 'account' | 'app' | 'fixture';
export interface RunHandle { runId: string; seat: Seat; path: ApiPath; conversationId: string; runUrl: string }
export interface RunResult { status: 'completed' | 'failed' | 'cancelled' | 'running'; text: string | null; raw: unknown }

const ACCOUNT_BASE = process.env.CREAO_ACCOUNT_BASE || 'https://developer.creao.ai/v1';
const APP_BASE = process.env.CREAO_APP_BASE || 'https://agent.creao.ai/api/v1/apps';

export function apiPath(): ApiPath {
  if (config.creao.mode === 'fixture') return 'fixture';
  const k = config.creao.apiKey;
  if (k.startsWith('cr_sk_')) return 'account';
  if (k.startsWith('capi_') || Object.values(config.creao.appKeys).some(Boolean)) return 'app';
  throw new Error('CREAO_MODE=live needs CREAO_API_KEY (cr_sk_ account key) or per-seat capi_ keys and app ids');
}

const resolvedIds: Partial<Record<Seat, string>> = {};

/** Account path: find each saved agent by its exact name unless CREAO_<SEAT>_AGENT_ID is set. Fails loudly if one is missing. */
export async function resolveAgents(): Promise<Record<Seat, string>> {
  const out = {} as Record<Seat, string>;
  const missing: Seat[] = [];
  for (const seat of Object.keys(AGENT_NAMES) as Seat[]) {
    const id = config.creao.agentIds[seat];
    if (id) out[seat] = id;
    else missing.push(seat);
  }
  if (missing.length && apiPath() === 'account') {
    const res = await fetch(`${ACCOUNT_BASE}/agents`, { headers: { Authorization: `Bearer ${config.creao.apiKey}` } });
    if (!res.ok) throw new Error(`GET /v1/agents: ${res.status}`);
    const body = (await res.json()) as unknown;
    const list = (Array.isArray(body) ? body : ((body as { agents?: unknown[]; data?: unknown[] }).agents ?? (body as { data?: unknown[] }).data ?? [])) as { agent_id?: string; id?: string; name?: string }[];
    for (const seat of missing) {
      const hit = list.find((a) => a.name?.trim().toLowerCase() === AGENT_NAMES[seat].toLowerCase());
      if (!hit) throw new Error(`no saved CREAO agent named "${AGENT_NAMES[seat]}" (found: ${list.map((a) => a.name).join(', ') || 'none'})`);
      out[seat] = (hit.agent_id ?? hit.id)!;
    }
  }
  if (apiPath() === 'app') {
    for (const seat of Object.keys(AGENT_NAMES) as Seat[]) {
      if (!config.creao.appIds[seat]) throw new Error(`app path: set CREAO_${seat.toUpperCase()}_APP_ID (the UUID on the saved agent's page)`);
      out[seat] = config.creao.appIds[seat];
    }
  }
  Object.assign(resolvedIds, out);
  log('CREAO agents:', Object.entries(out).map(([s, id]) => `${s}=${id}`).join(' '));
  return out;
}

const appKey = (seat: Seat) => config.creao.appKeys[seat] || config.creao.apiKey;

/** Starts a run. The case is sent as JSON text in one input named "case". */
export async function startRun(seat: Seat, caseJson: unknown, caseRef: string): Promise<RunHandle> {
  const path = apiPath();
  const text = JSON.stringify(caseJson);
  if (path === 'fixture') {
    return { runId: `fixture-${seat}-${caseRef}-${Date.now().toString(36)}`, seat, path, conversationId: '', runUrl: '' };
  }
  if (path === 'account') {
    const agentId = resolvedIds[seat] ?? (await resolveAgents())[seat];
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
  const j = (await res.json()) as { id: string; threadId?: string };
  return { runId: j.id, seat, path, conversationId: j.threadId ?? '', runUrl: '' };
}

/** One poll. Output lives in result.text on the account path; the app path's poll shape is checked defensively. */
export async function pollRun(h: RunHandle, caseJson: unknown): Promise<RunResult> {
  if (h.path === 'fixture') return { status: 'completed', text: JSON.stringify(fixtureResponse(h.seat, caseJson)), raw: { fixture: true } };
  const url = h.path === 'account' ? `${ACCOUNT_BASE}/runs/${h.runId}` : `${APP_BASE}/${config.creao.appIds[h.seat]}/runs/${h.runId}`;
  const key = h.path === 'account' ? config.creao.apiKey : appKey(h.seat);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CREAO poll ${h.seat}: ${res.status}`);
  const raw = (await res.json()) as { status?: string; result?: { text?: string; chatText?: string } | string; output?: string };
  const status = (raw.status ?? 'running') as RunResult['status'];
  const text = typeof raw.result === 'string' ? raw.result : raw.result?.text ?? raw.result?.chatText ?? raw.output ?? null;
  return { status: ['completed', 'failed', 'cancelled'].includes(status) ? status : 'running', text, raw };
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
export function parseVerdict<T extends object>(text: string | null, fallback: T, valid: (v: Record<string, unknown>) => boolean): { value: T; ok: boolean } {
  if (!text) return { value: fallback, ok: false };
  const stripped = text.replace(/```(?:json)?/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return { value: fallback, ok: false };
  try {
    const v = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    return valid(v) ? { value: v as T, ok: true } : { value: fallback, ok: false };
  } catch {
    return { value: fallback, ok: false };
  }
}
