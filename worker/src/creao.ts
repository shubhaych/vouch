import type { Seat } from '@vouch/module/types';
import { requireEnv as env } from './env';

// Adapter for the CREAO API Trigger (docs.creao.ai). Type-checked and tested
// against a stand-in server shaped like the documented API; NOT yet run
// against CREAO itself. Confirm with scripts/hello-creao.ts.
const BASE = process.env.CREAO_API_BASE ?? 'https://agent.creao.ai/api/v1/apps';

export type { Seat };
const cfg = (s: Seat) => ({ appId: env(`CREAO_${s.toUpperCase()}_APP_ID`), key: env(`CREAO_${s.toUpperCase()}_KEY`) });

export interface RunRef { seat: Seat; caseRef: string; runId: string; status: string }
export interface Hub { // thin interface over the SpacetimeDB connection
  agentsEnabled(): Promise<boolean>; // the circuit breaker / kill switch row
  recordRun(r: RunRef & { startedAt: Date }): Promise<void>;
  finishRun(runId: string, status: string, resultText: string | null): Promise<void>;
  seenDelivery(id: string): Promise<boolean>; // webhooks are at-least-once: dedupe on X-Creao-Delivery-Id
}

export async function startRun(hub: Hub, seat: Seat, caseRef: string, inputs: Record<string, unknown>, webhookUrl: string): Promise<RunRef | null> {
  if (!(await hub.agentsEnabled())) return null; // kill switch: no run is started, the case stays pending
  const { appId, key } = cfg(seat);
  const res = await fetch(`${BASE}/${appId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, webhookUrl }), // webhookUrl must be public http(s); localhost is rejected
  });
  if (!res.ok) throw new Error(`creao start ${seat}: ${res.status}`);
  const j = (await res.json()) as { id: string; status: string };
  const ref = { seat, caseRef, runId: j.id, status: j.status };
  await hub.recordRun({ ...ref, startedAt: new Date() });
  return ref;
}

// polling is the fallback: webhooks are best-effort and not sent for runs that fail before execution
export async function pollRun(seat: Seat, runId: string): Promise<{ status: string; raw: unknown }> {
  const { appId, key } = cfg(seat);
  const res = await fetch(`${BASE}/${appId}/runs/${runId}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`creao poll ${seat}: ${res.status}`);
  const raw = (await res.json()) as { status: string };
  return { status: raw.status, raw };
}

export interface WebhookBody { runId: string; status: 'completed' | 'failed'; threadId?: string; result?: { text?: string; artifacts?: unknown[]; chatText?: string } }
export async function onWebhook(hub: Hub, deliveryId: string | undefined, body: WebhookBody): Promise<number> {
  if (deliveryId && (await hub.seenDelivery(deliveryId))) return 200; // retry of something already handled
  await hub.finishRun(body.runId, body.status, body.result?.text ?? null);
  return 200;
}

// every agent returns one JSON object; parse defensively and fail closed to "unable_to_verify"
export function parseVerdict<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? (JSON.parse(m[0]) as T) : fallback; } catch { return fallback; }
}
