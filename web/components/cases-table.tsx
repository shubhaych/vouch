"use client";

import { useClaims } from "@/lib/data/hooks";
import { usd } from "@/lib/format";
import { EmptyState, NOT_CONNECTED } from "./empty-state";
import { LaneChip } from "./lane-chip";
import { ProvenanceBadge } from "./provenance-badge";

export function CasesTable() {
  const claims = useClaims();
  if (claims.status !== "ready" || claims.rows.length === 0) {
    return <EmptyState title="No cases yet">{claims.status === "disconnected" ? NOT_CONNECTED : "New claims appear here as they are filed."}</EmptyState>;
  }
  return (
    <table className="w-full text-left">
      <thead className="text-sm text-muted">
        <tr><th className="py-2 pr-4 font-medium">Case</th><th className="py-2 pr-4 font-medium">Amount</th><th className="py-2 pr-4 font-medium">Lane</th><th className="py-2 pr-4 font-medium">Reasons</th><th className="py-2 font-medium">Source</th></tr>
      </thead>
      <tbody>
        {claims.rows.map((c) => (
          <tr key={c.id} className="border-t border-line align-top">
            <td className="py-2 pr-4 font-mono">#{c.id}</td>
            <td className="py-2 pr-4">{usd(c.amountCents)}</td>
            <td className="py-2 pr-4">{c.lane ? <LaneChip lane={c.lane} /> : "pending"}</td>
            <td className="py-2 pr-4">{c.reasonCodes.join(", ") || "—"}</td>
            <td className="py-2"><ProvenanceBadge kind={c.provenance} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
