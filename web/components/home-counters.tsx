"use client";

import { useClaims, useRegisteredAgents } from "@/lib/data/hooks";
import { ProvenanceBadge } from "./provenance-badge";

function Counter({ label, value, ready }: { label: string; value: number | null; ready: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-muted">{label}</p>
        {ready && <ProvenanceBadge kind="live" />}
      </div>
      <p className="mt-2 text-4xl font-bold tabular-nums">{value ?? "—"}</p>
      {!ready && <p className="mt-1 text-sm text-muted">No data yet: not connected</p>}
    </div>
  );
}

export function HomeCounters() {
  const claims = useClaims();
  const agents = useRegisteredAgents();
  const ready = claims.status === "ready";
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Counter label="Refunds paid in seconds" value={ready ? claims.rows.filter((c) => c.lane === "A").length : null} ready={ready} />
      <Counter label="Claims held" value={ready ? claims.rows.filter((c) => c.lane === "C" || c.lane === "D").length : null} ready={ready} />
      <Counter label="Agents vouched" value={agents.status === "ready" ? agents.rows.length : null} ready={agents.status === "ready"} />
    </div>
  );
}
