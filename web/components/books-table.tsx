"use client";

import { useDecisions } from "@/lib/data/hooks";
import { usd } from "@/lib/format";
import { EmptyState, NOT_CONNECTED } from "./empty-state";
import { RunLink } from "./run-link";

export function BooksTable() {
  const decisions = useDecisions();
  if (decisions.status !== "ready" || decisions.rows.length === 0) {
    return <EmptyState title="No proposals yet">{decisions.status === "disconnected" ? NOT_CONNECTED : "Proposals, approvals and postings appear here."}</EmptyState>;
  }
  return (
    <table className="w-full text-left">
      <thead className="text-sm text-muted">
        <tr><th className="py-2 pr-4 font-medium">Decision</th><th className="py-2 pr-4 font-medium">Amount</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2 pr-4 font-medium">Rule</th><th className="py-2 font-medium">Run</th></tr>
      </thead>
      <tbody>
        {decisions.rows.map((d) => (
          <tr key={d.id} className="border-t border-line align-top">
            <td className="py-2 pr-4">{d.kind} <span className="text-muted">{d.caseRef}</span></td>
            <td className="py-2 pr-4">{usd(d.amountCents)}</td>
            <td className="py-2 pr-4 font-medium">{d.status}</td>
            <td className="py-2 pr-4 font-mono text-sm">{d.rule}</td>
            <td className="py-2"><RunLink url={d.runUrl} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
