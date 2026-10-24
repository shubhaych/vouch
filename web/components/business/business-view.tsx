"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { agentLabel, businessLabel, claimLabel, money, timeAgo, titleCase } from "@/lib/format";
import { BUSINESS_A, BUSINESS_B, businessDef } from "@vouch/module/world";
import { Investigation } from "./investigation";
import { RecommendationCard } from "./recommendation";
import { OrgChart } from "./org-chart";

export function BusinessView() {
  return (
    <Suspense fallback={<main className="app-dark min-h-screen" />}>
      <BusinessInner />
    </Suspense>
  );
}

const STATUS_CHIP: Record<string, string> = {
  awaiting_video: "chip", frames_ready: "chip chip--accent", investigating: "chip chip--accent", recommended: "chip chip--review", offline: "chip chip--fraud",
  more_evidence: "chip chip--review", decided: "chip chip--honest", review_only: "chip",
};

function BusinessInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { identity } = useStatus();
  const [roles] = useTable(tables.role);
  const [claims] = useTable(tables.claim);
  const seat = roles.find((r) => r.who.toHexString() === identity && (r.role === "business" || r.role === "controller"));
  const call = useCall();
  const [code, setCode] = useState("");
  const [frame, setFrame] = useState(0);

  const sorted = useMemo(() => [...claims].sort((a, b) => Number(b.id - a.id)), [claims]);
  const wanted = params.get("refund");
  const selected = (wanted ? sorted.find((c) => c.refundId.toString() === wanted) : undefined) ?? sorted[0];
  const select = (c: Claim) => { setFrame(0); router.replace(`/business?refund=${c.refundId}`, { scroll: false }); };

  return (
    <main className="app-dark mx-auto max-w-[1600px] space-y-4 px-3 py-4 text-ink-dark sm:px-5" data-testid="business">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section__eyebrow">Business dashboard</p>
          <h1 className="section__title">Refund investigations</h1>
        </div>
        {seat ? (
          <div className="glass flex items-center gap-2 p-1" data-testid="business-switcher">
            {[BUSINESS_A, BUSINESS_B].map((b) => (
              <button key={b} onClick={() => void call("switchBusiness", (r) => r.switchBusiness({ businessId: b }))}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${seat.businessId === b ? "bg-accent text-black" : "text-ink-soft-dark hover:text-ink-dark"}`}>
                {b === BUSINESS_A ? "Business A" : "Business B"} · {businessDef(b)?.name}
              </button>
            ))}
            <span className={`chip ${seat.role === "controller" ? "chip--credential" : "chip--accent"}`}>{seat.role}</span>
          </div>
        ) : (
          <form className="glass flex items-center gap-2 p-2" onSubmit={(e) => { e.preventDefault(); void call("takeBusinessSeat", (r) => r.takeBusinessSeat({ code }), "You have the business seat"); }} data-testid="seat-gate">
            <span className="text-sm">Take the business seat</span>
            <input className="rounded-md border border-line-dark bg-transparent px-2 py-1 text-sm" placeholder="demo code" value={code} onChange={(e) => setCode(e.target.value)} data-testid="seat-code" type="password" />
            <button className="btn btn--primary btn--sm" data-testid="seat-submit">Enter</button>
          </form>
        )}
      </header>

      <OrgChart canToggle={!!seat} />

      <div className="grid gap-4 xl:grid-cols-[18rem_1fr_22rem]">
        <aside className="glass flex max-h-[80vh] flex-col" data-testid="queue">
          <div className="flex items-center justify-between border-b border-line-dark px-3 py-2">
            <span className="panel-title">Queue</span>
            <span className="text-xs text-ink-soft-dark">{claims.length} <Badge kind="live" /></span>
          </div>
          <ol className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {sorted.length === 0 ? <li className="p-2 text-xs text-ink-soft-dark">No claims yet. File one from /shop, or open a simulated refund from an agent on /world.</li> : null}
            {sorted.map((c) => <QueueItem key={c.id.toString()} c={c} active={selected?.id === c.id} onClick={() => select(c)} />)}
          </ol>
        </aside>
        {selected ? <Selected claim={selected} frame={frame} onFrame={setFrame} seatRole={seat?.role ?? null} seatBusiness={seat?.businessId ?? 0} /> : <div className="glass p-6 text-sm text-ink-soft-dark xl:col-span-2">Pick a claim from the queue.</div>}
      </div>
    </main>
  );
}

function QueueItem({ c, active, onClick }: { c: Claim; active: boolean; onClick: () => void }) {
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(c.refundId)));
  const r = refunds[0];
  return (
    <li>
      <button onClick={onClick} className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${active ? "border-accent/70 bg-accent/5" : "border-line-dark hover:border-accent/40"}`} data-testid={`queue-${c.id}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-bold">{claimLabel(c.id)}</span>
          <span className={STATUS_CHIP[c.status] ?? "chip"}>{titleCase(c.status)}</span>
        </div>
        <div className="mt-0.5 text-xs text-ink-soft-dark">
          {agentLabel(c.agentId)} · {r ? `${money(r.amount)} · ${businessLabel(r.businessId)}` : "…"} · {c.kind} · {timeAgo(Number(c.createdAt.microsSinceUnixEpoch / 1000n))} ago
        </div>
      </button>
    </li>
  );
}

function Selected({ claim, frame, onFrame, seatRole, seatBusiness }: { claim: Claim; frame: number; onFrame: (i: number) => void; seatRole: string | null; seatBusiness: number }) {
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(claim.refundId)));
  const refund = refunds[0];
  const [purchases] = useTable(tables.purchase.where((r) => r.id.eq(refund?.purchaseId ?? 0n)), { enabled: !!refund });
  const [evidence] = useTable(tables.evidence.where((r) => r.claimId.eq(claim.id)));
  const [decisions] = useTable(tables.decision.where((r) => r.refundId.eq(claim.refundId)));
  if (!refund) return <div className="skeleton h-96 xl:col-span-2" />;
  return (
    <>
      <Investigation claim={claim} refund={refund} purchase={purchases[0]} evidence={[...evidence]} frame={frame} onFrame={onFrame} />
      <div className="space-y-4">
        <RecommendationCard claim={claim} refund={refund} decisions={decisions} evidence={evidence} seatRole={seatRole} seatBusiness={seatBusiness} onFrame={onFrame} />
      </div>
    </>
  );
}
