import type { Hub, RunRef } from './creao';
import { config } from './env';

/**
 * In-memory Hub so the worker runs before SpacetimeDB bindings exist and so
 * tests need no database. Replace with a SpacetimeDB-backed Hub once
 * `npm run stdb:generate` has produced worker/module_bindings: recordRun ->
 * recordRun reducer, finishRun -> finishRun reducer, seenDelivery ->
 * markDelivery reducer, agentsEnabled -> the `creao_enabled` config row.
 */
export function createMemoryHub(initiallyEnabled = config.creaoEnabled) {
  let enabled = initiallyEnabled;
  const runs = new Map<string, RunRef & { startedAt: Date; finishedAt?: Date; resultText?: string | null }>();
  const deliveries = new Set<string>();
  const hub: Hub = {
    agentsEnabled: async () => enabled,
    recordRun: async (r) => { runs.set(r.runId, r); },
    finishRun: async (runId, status, resultText) => {
      const r = runs.get(runId);
      if (r) Object.assign(r, { status, resultText, finishedAt: new Date() });
    },
    seenDelivery: async (id) => { const seen = deliveries.has(id); deliveries.add(id); return seen; },
  };
  return { hub, runs, setEnabled: (v: boolean) => { enabled = v; } };
}
