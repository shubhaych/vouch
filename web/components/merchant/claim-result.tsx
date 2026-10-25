"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Claim } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { agentLabel, businessLabel, claimLabel, money, titleCase } from "@/lib/format";
import { catalogItem, businessDef } from "@vouch/module/world";
import { Investigation, parse } from "@/components/business/investigation";
import { DecisionActions, RecommendationCard } from "@/components/business/recommendation";
import { ReportPanel, ReviewingPanel } from "@/components/business/report-panel";
import type { Report } from "@vouch/module/review-types";
import { makeHandoffClaim, formatMoney, scoreLabel, type DemoClaim } from "@/lib/demo/claims";

function orderOf(p: { item: number; amount: number } | undefined, requestedCents: number) {
  if (!p) return undefined;
  const item = catalogItem(p.item);
  return { item: item?.name ?? `SKU-${p.item}`, description: item?.description ?? "", priceCents: p.amount, requestedCents };
}

function acceptCents(json: string): number | undefined {
  const A = parse<Report | null>(json, null)?.factoryAssessment;
  return A?.status === "validated" && A.action === "accept" ? A.amountCents : undefined;
}

export function ClaimResult({ claimId }: { claimId: string }) {
  if (claimId === "fixture") return <FixtureResult />;
  let id: bigint;
  try {
    id = BigInt(claimId);
  } catch {
    return <Missing id={claimId} />;
  }
  return <LiveResult claimId={id} />;
}

function Missing({ id }: { id: string }) {
  return (
    <main className="app-dark mx-auto max-w-3xl px-4 py-16 text-ink-dark" data-testid="merchant-claim-missing">
      <p className="section__eyebrow">Merchant result</p>
      <h1 className="section__title">Claim not found</h1>
      <p className="mt-3 text-ink-soft-dark">No claim with id {id}. Submit one from the home page QR handoff.</p>
      <Link href="/#try" className="btn btn--primary mt-6 inline-flex">Back to try a claim</Link>
    </main>
  );
}

function LiveResult({ claimId }: { claimId: bigint }) {
  const { identity } = useStatus();
  const [roles] = useTable(tables.role);
  const seat = roles.find((r) => r.who.toHexString() === identity && (r.role === "business" || r.role === "controller"));
  const call = useCall();
  const [code, setCode] = useState("");
  const [frame, setFrame] = useState(0);

  const [claims, claimsReady] = useTable(tables.claim.where((r) => r.id.eq(claimId)));
  const claim = claims.find((c) => c.id === claimId);

  if (!claim) {
    return (
      <main className="app-dark mx-auto max-w-3xl px-4 py-16 text-ink-dark">
        <p className="section__eyebrow">Merchant result</p>
        <h1 className="section__title">
          {claimsReady ? `No claim ${claimLabel(claimId)}` : `Loading claim ${claimLabel(claimId)}…`}
        </h1>
        <p className="mt-2 text-sm text-ink-soft-dark">
          <Badge kind="live" />{" "}
          {claimsReady
            ? "Submit a claim from the home-page QR, or open /business for the full queue."
            : "Waiting for SpacetimeDB row"}
        </p>
        <Link href="/#try" className="btn btn--primary mt-6 inline-flex">
          Back to try a claim
        </Link>
      </main>
    );
  }

  return (
    <main className="app-dark mx-auto max-w-5xl space-y-5 px-3 py-6 text-ink-dark sm:px-5" data-testid="merchant-claim">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section__eyebrow">Merchant result · one claim</p>
          <h1 className="section__title">{claimLabel(claim.id)}</h1>
          <p className="mt-1 text-sm text-ink-soft-dark">
            {agentLabel(claim.agentId)} · {titleCase(claim.status)} · <Badge kind="live" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {seat ? (
            <span className={`chip ${seat.role === "controller" ? "chip--credential" : "chip--accent"}`}>
              {seat.role} · {businessDef(seat.businessId)?.name ?? businessLabel(seat.businessId)}
            </span>
          ) : (
            <form
              className="glass flex items-center gap-2 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void call("takeBusinessSeat", (r) => r.takeBusinessSeat({ code }), "You have the business seat");
              }}
            >
              <input
                className="rounded-md border border-line-dark bg-transparent px-2 py-1 text-sm"
                placeholder="demo code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                type="password"
              />
              <button className="btn btn--primary btn--sm">Take seat</button>
            </form>
          )}
          <Link href="/network" className="btn btn--ghost-dark btn--sm">
            Company network →
          </Link>
        </div>
      </header>

      <Selected claim={claim} frame={frame} onFrame={setFrame} seatRole={seat?.role ?? null} seatBusiness={seat?.businessId ?? 0} />
    </main>
  );
}

function Selected({
  claim,
  frame,
  onFrame,
  seatRole,
  seatBusiness,
}: {
  claim: Claim;
  frame: number;
  onFrame: (i: number) => void;
  seatRole: string | null;
  seatBusiness: number;
}) {
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(claim.refundId)));
  const refund = refunds[0];
  const [purchases] = useTable(tables.purchase.where((r) => r.id.eq(refund?.purchaseId ?? 0n)), { enabled: !!refund });
  const purchase = purchases[0];
  const [evidence] = useTable(tables.evidence.where((r) => r.claimId.eq(claim.id)));
  const [decisions] = useTable(tables.decision.where((r) => r.refundId.eq(claim.refundId)));
  const [reports] = useTable(tables.report.where((r) => r.claimId.eq(claim.id)));
  const [jobs] = useTable(tables.analysisJob.where((r) => r.claimId.eq(claim.id)));
  const [agents] = useTable(tables.agent.where((r) => r.id.eq(claim.agentId)));
  const [credits] = useTable(tables.creditEvent.where((r) => r.agentId.eq(claim.agentId)));
  const report = [...reports].sort((a, b) => Number(b.id - a.id))[0];
  const job = [...jobs].sort((a, b) => Number(b.id - a.id))[0];
  const agent = agents[0];
  const lastCredit = useMemo(
    () => [...credits].sort((a, b) => Number(b.id - a.id))[0],
    [credits],
  );
  const item = purchase ? catalogItem(purchase.item) : undefined;
  const biz = refund ? businessDef(refund.businessId) : undefined;

  if (!refund) return <div className="skeleton h-96" />;

  const open = ["requested", "investigating", "recommended", "awaiting_controller", "more_evidence"].includes(refund.status);
  const decided = !open;
  const reviewPending = open && (!!job || ["investigating", "recommended", "frames_ready"].includes(claim.status));
  const waitingVideo = claim.status === "awaiting_video";
  const jobRunning = !!job && job.status === "running";

  return (
    <div className="space-y-4">
      <section className="glass grid gap-4 p-4 sm:grid-cols-2" data-testid="claim-order">
        <div>
          <span className="panel-title">Product &amp; order</span>
          <h2 className="mt-1 text-xl font-bold">{item?.name ?? `SKU-${purchase?.item ?? "?"}`}</h2>
          <p className="mt-1 text-sm text-ink-soft-dark">{item?.description}</p>
          <p className="mt-2 text-sm">
            {biz?.name ?? businessLabel(refund.businessId)} · {money(refund.amount)} · {titleCase(refund.reasonCode)}
          </p>
          <p className="mt-1 text-xs text-ink-soft-dark">
            Policy: {biz?.policy.windowDays ?? "—"}-day window
            {biz?.policy.notes ? ` · ${biz.policy.notes}` : ""}
          </p>
          {purchase ? (
            <p className="mt-2 text-xs text-ink-soft-dark">
              Order P-{purchase.id.toString()} · status {titleCase(purchase.status)}
            </p>
          ) : null}
        </div>
        <div>
          <span className="panel-title">Confirmed Vouch history</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold" data-testid="claim-score">
              {agent?.score ?? "—"}
            </span>
            <span className="text-sm text-ink-soft-dark">/ 1000 · {agent?.band ?? "…"}</span>
            <Badge kind="live" />
          </div>
          {reviewPending || waitingVideo ? (
            <p className="mt-2 text-sm text-review">
              Review pending — score unchanged until a confirmed merchant decision.
            </p>
          ) : lastCredit && lastCredit.causeTable === "refund" && lastCredit.causeId === refund.id ? (
            <p className="mt-2 text-sm text-honest">
              Score updated after confirmed outcome: {lastCredit.before} → {lastCredit.after}
            </p>
          ) : decided ? (
            <p className="mt-2 text-sm text-ink-soft-dark">Decision recorded. Score updates only on confirmed outcomes.</p>
          ) : (
            <p className="mt-2 text-sm text-ink-soft-dark">No score change yet for this claim.</p>
          )}
        </div>
      </section>

      {waitingVideo ? (
        <section className="glass space-y-3 p-5" data-testid="claim-waiting-video">
          <span className="panel-title">Customer video / transcript</span>
          <p className="text-sm text-ink-soft-dark">
            Waiting for the phone submission on this claim. The QR and this desktop share claim{" "}
            <span className="font-mono">{claimLabel(claim.id)}</span>.
          </p>
          <p className="mt-2 text-sm italic text-ink-soft-dark">“{refund.reasonText}”</p>
          <div className="mt-4 border-t border-line-dark pt-3">
            <span className="panel-title">Recommendation</span>
            <p className="mt-2 text-sm text-ink-soft-dark">
              Evidence and policy checks start after the video arrives. An AI flag alone never lowers the score.
              Refund status: {titleCase(refund.status || "unknown")}.
            </p>
          </div>
        </section>
      ) : report || job ? (
        <div>
          {report && (!jobRunning || report.jobId === job?.id) ? (
            <ReportPanel
              claim={claim}
              row={report}
              order={orderOf(purchase, refund.amount)}
              actions={
                <DecisionActions
                  claim={claim}
                  refund={refund}
                  decisions={decisions}
                  seatRole={seatRole}
                  seatBusiness={seatBusiness}
                  acceptCents={acceptCents(report.json)}
                />
              }
            />
          ) : job ? (
            <ReviewingPanel job={job} />
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Investigation
            claim={claim}
            refund={refund}
            purchase={purchase}
            evidence={[...evidence]}
            frame={frame}
            onFrame={onFrame}
          />
          <RecommendationCard
            claim={claim}
            refund={refund}
            decisions={decisions}
            evidence={evidence}
            seatRole={seatRole}
            seatBusiness={seatBusiness}
            onFrame={onFrame}
          />
        </div>
      )}

      <p className="text-center text-sm text-ink-soft-dark">
        Next:{" "}
        <Link href="/network" className="underline">
          explore the merchant network
        </Link>{" "}
        ·{" "}
        <Link href="/simulation" className="underline">
          see the simulation at scale
        </Link>
      </p>
    </div>
  );
}

function FixtureResult() {
  const claim: DemoClaim = makeHandoffClaim();
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8" data-testid="merchant-claim-fixture">
      <header>
        <p className="section__eyebrow">Merchant result · presentation fixture</p>
        <h1 className="section__title">{claim.id}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {claim.customerName} · {claim.storyTag} · <Badge kind="fixture" />
        </p>
      </header>

      <section className="claim-grid" style={{ padding: 0 }}>
        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Ordered
          </span>
          <p className="evidence-example__line">{claim.itemOrdered}</p>
          <p className="mt-2 text-sm text-ink-soft">
            {claim.orderId} · {formatMoney(claim.amountCents)}
          </p>
        </div>
        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Observed
          </span>
          <p className="evidence-example__line evidence-example__line--flag">{claim.itemObserved}</p>
          {claim.analysisFlag ? (
            <p className="mt-2 text-sm text-ink-soft">AI flag → human review · score unchanged by the flag alone</p>
          ) : null}
        </div>
      </section>

      <div className="claim-panel claim-panel--wide" style={{ margin: 0 }}>
        <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
          Customer video / transcript
        </span>
        <p className="mt-1 text-xs text-ink-soft">{claim.videoLabel}</p>
        <p className="claim-transcript">“{claim.transcript}”</p>
      </div>

      <div className="claim-grid" style={{ padding: 0 }}>
        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Policy
          </span>
          <p className="mt-2 text-sm">{claim.policyResult.summary}</p>
        </div>
        <div className="claim-panel">
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Confirmed history
          </span>
          <p className="mt-2 text-2xl font-bold">{scoreLabel(claim.scoreBefore)}</p>
          <p className="mt-1 text-sm text-ink-soft">Review pending — score unchanged until a confirmed outcome.</p>
        </div>
      </div>

      <div className="claim-panel" style={{ margin: 0 }}>
        <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
          Recommendation
        </span>
        <p className="mt-2 text-sm">{claim.decisionNote}</p>
        <p className="mt-3 text-xs text-ink-soft">
          <Badge kind="fixture" /> Not a live SpacetimeDB claim — open after a phone submission for Live data.
        </p>
      </div>

      <p className="text-center text-sm text-ink-soft">
        <Link href="/network" className="underline">
          Company network →
        </Link>
      </p>
    </main>
  );
}
