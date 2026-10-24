"use client";

import { useCreaoEnabled, useLedger, useMerchantPolicy } from "@/lib/data/hooks";
import { EmptyState, NOT_CONNECTED } from "./empty-state";
import { ProvenanceBadge } from "./provenance-badge";
import { usd } from "@/lib/format";

export function KillSwitchRow() {
  const enabled = useCreaoEnabled();
  const label = enabled === null ? "State unknown: not connected" : enabled ? "On: agents are running" : "Off: every new case waits in Lane C, \"underwriter offline\"";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">CREAO agents</p>
        <p className="text-muted">{label}</p>
      </div>
      {/* TODO: controller-only toggle calling the setCreaoEnabled reducer */}
      <button disabled className="rounded-lg border border-line px-4 py-2 font-semibold text-muted disabled:cursor-not-allowed">Switch off (controller)</button>
    </div>
  );
}

export function LedgerFeed() {
  const ledger = useLedger();
  if (ledger.status !== "ready") return <EmptyState title="No ledger events yet">{NOT_CONNECTED}</EmptyState>;
  return (
    <ol className="space-y-2 font-mono text-sm">
      {ledger.rows.map((e) => (
        <li key={e.seq} className="flex gap-3"><span className="text-muted">#{e.seq}</span><span>{e.kind}</span><span className="truncate text-muted">{e.hash}</span></li>
      ))}
    </ol>
  );
}

/** Placeholder for the speed-versus-loss curve. Replace with a small chart library; keep the Simulated badge. */
export function SpeedLossCurve() {
  const { policy, provenance } = useMerchantPolicy();
  return (
    <div>
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-line bg-background text-muted">Speed-versus-loss curve goes here</div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-muted">
        Current dial: accepts up to {usd(policy.riskDialLossPer1000Cents)} loss per $1,000 refunded <ProvenanceBadge kind={provenance} />
      </p>
    </div>
  );
}
