"use client";

import { useVouchRecord } from "@/lib/data/hooks";
import { EmptyState, NOT_CONNECTED } from "./empty-state";
import { ProvenanceBadge } from "./provenance-badge";
import { RunLink } from "./run-link";
import { TierChip } from "./lane-chip";

// TODO: replace the empty subject id with the signed-in shopper.
export function VouchRecordView() {
  const rec = useVouchRecord("");
  const r = rec.rows[0];
  if (!r) return <EmptyState title="No Vouch Record yet">{rec.status === "disconnected" ? NOT_CONNECTED : "A new customer starts at Tier 0 and is asked to verify; a Credit Analyst run builds the record."}</EmptyState>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3"><TierChip tier={r.tier} /><ProvenanceBadge kind={r.provenance} /><span className="text-muted">expires {r.expiresAt.toLocaleDateString()}</span></div>
      <ul className="list-disc space-y-1 pl-5">{r.reasons.map((x) => <li key={x.text}>{x.text} <span className="text-muted">({x.field})</span></li>)}</ul>
      {r.notFound.length > 0 && <p className="text-muted">Not found: {r.notFound.join(", ")}</p>}
      <RunLink url={r.runUrl} />
    </div>
  );
}
