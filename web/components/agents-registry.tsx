"use client";

import { useRegisteredAgents } from "@/lib/data/hooks";
import { usd } from "@/lib/format";
import { EmptyState, NOT_CONNECTED } from "./empty-state";
import { ProvenanceBadge } from "./provenance-badge";
import { TierChip } from "./lane-chip";

export function AgentsRegistry() {
  const agents = useRegisteredAgents();
  if (agents.status !== "ready" || agents.rows.length === 0) {
    return <EmptyState title="No shopping agents registered">{agents.status === "disconnected" ? NOT_CONNECTED : "Agents register with a principal and a mandate."}</EmptyState>;
  }
  return (
    <table className="w-full text-left">
      <thead className="text-sm text-muted">
        <tr><th className="py-2 pr-4 font-medium">Agent</th><th className="py-2 pr-4 font-medium">Principal</th><th className="py-2 pr-4 font-medium">Tier</th><th className="py-2 pr-4 font-medium">Mandate</th><th className="py-2 font-medium">Source</th></tr>
      </thead>
      <tbody>
        {agents.rows.map((a) => (
          <tr key={a.id} className="border-t border-line align-top">
            <td className="py-2 pr-4 font-mono">{a.id}</td>
            <td className="py-2 pr-4 font-mono">{a.principalId}</td>
            <td className="py-2 pr-4"><TierChip tier={a.tier} /></td>
            <td className="py-2 pr-4">{a.mandate.map((m) => `${m.category} up to ${usd(m.capCents)}`).join("; ")}</td>
            <td className="py-2"><ProvenanceBadge kind={a.provenance} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
