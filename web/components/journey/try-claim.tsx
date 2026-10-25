"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { claimHref } from "@/lib/claim-link";
import { BUSINESS_A, catalogItem } from "@vouch/module/world";
import { useDemo } from "@/lib/demo/demo-store";
import {
  HANDOFF_LABEL,
  HANDOFF_STEPS,
  isLocalOrigin,
  publicOrigin,
  type HandoffStatus,
} from "@/lib/demo/judge-session";

/** Matches the live handoff purchase (SKU 1 · Lakeshore Audio). */
const DEMO_SKU = 1;

const STEPS = [
  {
    title: "Video + spoken claim",
    detail:
      "Customer films the headphones and explains the mismatch. Evidence on camera — not a confidence number.",
  },
  {
    title: "Order · shipping · policy",
    detail:
      "Merchant systems check what was ordered, delivered, and whether the request is in policy.",
  },
  {
    title: "Confirmed history",
    detail:
      "Prior confirmed refund outcomes for this customer — separate from whether this claim is valid.",
  },
  {
    title: "Approve or human review",
    detail:
      "Clear eligible claims move fast. An AI flag alone never declines — uncertain cases go to a person.",
  },
  {
    title: "Outcome updates Vouch",
    detail:
      "Only the confirmed merchant decision changes the portable score. A flag by itself does not.",
  },
] as const;

export function TryClaim() {
  const item = catalogItem(DEMO_SKU);

  return (
    <section className="section journey-section" id="try" data-testid="try-claim">
      <p className="section__eyebrow">How Vouch works</p>
      <h2 className="section__title">One claim, five steps.</h2>
      <p className="claim-path__lede">
        Claim validity and customer history stay separate. For this headphones mismatch, the merchant
        should see what was ordered beside what was observed — not a black-box score.
      </p>

      <ol className="claim-path">
        {STEPS.map((s, i) => (
          <li key={s.title} className="claim-path__item">
            <span className="claim-path__rail" aria-hidden>
              <span className="claim-path__node">{String(i + 1).padStart(2, "0")}</span>
              {i < STEPS.length - 1 ? <span className="claim-path__stem" /> : null}
            </span>
            <div className="claim-path__copy">
              <h3 className="claim-path__title">{s.title}</h3>
              <p className="claim-path__body">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <LiveHandoff />

      <div className="evidence-example" data-testid="evidence-example">
        <div>
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Ordered
          </span>
          <p className="evidence-example__line">
            {item?.name ?? "Noise-cancelling headphones"} · Matte black
          </p>
        </div>
        <div className="evidence-example__arrow" aria-hidden>
          →
        </div>
        <div>
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
            Observed &amp; described
          </span>
          <p className="evidence-example__line evidence-example__line--flag">
            Different colour and size in the box
          </p>
        </div>
        <p className="evidence-example__note">
          Mismatch flags the case for human review with evidence attached. The flag alone never lowers
          the Vouch score — only a confirmed merchant outcome does.
        </p>
      </div>
    </section>
  );
}

function LiveHandoff() {
  const router = useRouter();
  const { status } = useStatus();
  const call = useCall();
  const { setLiveMerchantClaimId } = useDemo();
  const [mine, mineReady] = useTable(tables.myAgent);
  const agentId = mine[0]?.agentId ?? null;

  const [phase, setPhase] = useState<"idle" | "buying" | "ready" | "fixture">("idle");
  const [claimId, setClaimId] = useState<bigint | null>(null);
  const [claimPath, setClaimPath] = useState("");
  const [fixtureStatus, setFixtureStatus] = useState<HandoffStatus>("waiting_phone");
  const [note, setNote] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const started = useRef(false);
  const navigated = useRef(false);
  const refunding = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const purchaseFloor = useRef<bigint>(0n);
  const [purchases] = useTable(
    tables.purchase.where((r) => r.buyer.eq(agentId ?? 0)),
    { enabled: agentId != null },
  );
  /** Prefer the purchase created by this handoff, not an older order. */
  const newestPurchase = useMemo(() => {
    const mine = [...purchases]
      .filter((p) => p.id > purchaseFloor.current && p.item === DEMO_SKU)
      .sort((a, b) => Number(b.id - a.id));
    return (
      mine[0] ??
      [...purchases]
        .filter((p) => p.id > purchaseFloor.current)
        .sort((a, b) => Number(b.id - a.id))[0]
    );
  }, [purchases]);
  const [refunds] = useTable(
    tables.refund.where((r) => r.agentId.eq(agentId ?? 0)),
    { enabled: agentId != null },
  );
  const targetRefund = useMemo(() => {
    if (!newestPurchase) return undefined;
    return [...refunds].find((r) => r.purchaseId === newestPurchase.id);
  }, [newestPurchase, refunds]);
  const [claims] = useTable(
    tables.claim.where((r) => r.refundId.eq(targetRefund?.id ?? 0n)),
    { enabled: !!targetRefund },
  );
  const claim = claims[0];
  const [jobs] = useTable(
    tables.analysisJob.where((r) => r.claimId.eq(claim?.id ?? 0n)),
    { enabled: !!claim },
  );
  const job = [...jobs].sort((a, b) => Number(b.id - a.id))[0];

  const origin = mounted ? publicOrigin() : "";
  const phoneReachable = mounted && !!origin && !isLocalOrigin(origin);
  const qrUrl = claimPath && phoneReachable ? `${origin}${claimPath}` : "";
  const fixture = phase === "fixture";

  useEffect(() => {
    if (status === "live" && mineReady && agentId === null && !started.current) {
      void call("joinAsShopper", (r) => r.joinAsShopper({ name: "Judge" }));
    }
  }, [status, mineReady, agentId, call]);

  useEffect(() => {
    if (status === "live" || status === "connecting") return;
    setPhase("fixture");
  }, [status]);

  const bootstrap = useCallback(async () => {
    if (started.current || agentId == null) return;
    started.current = true;
    setPhase("buying");
    setNote(null);
    const maxId = purchases.reduce((m, p) => (p.id > m ? p.id : m), 0n);
    purchaseFloor.current = maxId;
    const ok = await call("buy", (r) => r.buy({ businessId: BUSINESS_A, sku: DEMO_SKU }));
    if (!ok) {
      setPhase("fixture");
      setNote("Live order unavailable — continue on this device, or open the fixture result later.");
      return;
    }
  }, [agentId, call, purchases]);

  useEffect(() => {
    if (status === "live" && agentId != null && phase === "idle") void bootstrap();
  }, [status, agentId, phase, bootstrap]);

  useEffect(() => {
    if (phase !== "buying" || !newestPurchase || targetRefund || refunding.current) return;
    const purchaseId = newestPurchase.id;
    const needsDeliver = newestPurchase.status === "ordered";
    const sku = newestPurchase.item;
    refunding.current = true;
    let cancelled = false;
    (async () => {
      if (needsDeliver) {
        const okFf = await call("fastForward", (r) => r.fastForward({ purchaseId }));
        if (cancelled) {
          refunding.current = false;
          return;
        }
        if (!okFf) {
          setPhase("fixture");
          setNote("Could not prepare delivery — continue on this device.");
          return;
        }
      }
      if (cancelled) {
        refunding.current = false;
        return;
      }
      const item = catalogItem(sku);
      const okRf = await call("requestRefund", (r) =>
        r.requestRefund({
          purchaseId,
          reasonCode: "not_as_described",
          reasonText: item
            ? `Ordered ${item.name}; the box contains a different colour and size`
            : "Item not as described",
        }),
      );
      if (cancelled) {
        refunding.current = false;
        return;
      }
      if (!okRf) {
        refunding.current = false;
        setPhase("fixture");
        setNote("Could not open a live claim — continue on this device.");
      }
    })();
    return () => {
      cancelled = true;
      refunding.current = false;
    };
  }, [phase, newestPurchase, targetRefund, call]);

  useEffect(() => {
    if (!claim || claimId != null) return;
    setClaimId(claim.id);
    setClaimPath(claimHref(claim, newestPurchase, targetRefund));
    setPhase("ready");
    setLiveMerchantClaimId(claim.id.toString());
  }, [claim, claimId, newestPurchase, targetRefund, setLiveMerchantClaimId]);

  const liveStatus: HandoffStatus = useMemo(() => {
    if (fixture) return fixtureStatus;
    if (!claim) return "waiting_phone";
    if (claim.status === "awaiting_video") return "waiting_phone";
    if (job && !["done", "lanes_only", "failed"].includes(job.status)) return "checking";
    if (job || ["ready", "decided", "reviewed"].includes(claim.status)) return "result_ready";
    if (claim.videoUrl || claim.frameUrls.length > 0) return "video_received";
    return "waiting_phone";
  }, [fixture, fixtureStatus, claim, job]);

  useEffect(() => {
    if (!fixture) return;
    const timers = [
      window.setTimeout(() => setFixtureStatus("video_received"), 4500),
      window.setTimeout(() => setFixtureStatus("checking"), 9000),
      window.setTimeout(() => setFixtureStatus("result_ready"), 14000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [fixture]);

  useEffect(() => {
    if (liveStatus !== "result_ready" || navigated.current) return;
    navigated.current = true;
    const href =
      fixture || !claimId ? "/merchant/claim/fixture" : `/merchant/claim/${claimId.toString()}`;
    const t = window.setTimeout(() => router.push(href), 1000);
    return () => window.clearTimeout(t);
  }, [liveStatus, fixture, claimId, router]);

  const item = catalogItem(DEMO_SKU);

  return (
    <div className="try-handoff" id="demo" data-testid="live-handoff">
      <div className="try-handoff__copy">
        <p className="section__eyebrow">Try it on your phone</p>
        <h3 className="try-handoff__title">Submit the same claim.</h3>
        <p className="try-handoff__product">
          Demo order: <strong>{item?.name ?? "Noise-cancelling headphones"}</strong>
          <span className="try-handoff__product-meta"> · Lakeshore Audio · not as described</span>
        </p>

        {!mounted ? (
          <p className="try-handoff__soft-note">Preparing the shared claim…</p>
        ) : phoneReachable ? (
          <ol className="try-handoff__howto">
            <li>Scan the QR with your phone</li>
            <li>Record a short video of the item</li>
            <li>This desktop opens the merchant result for the same claim</li>
          </ol>
        ) : (
          <div className="try-handoff__unavailable" data-testid="qr-unavailable">
            <p className="try-handoff__unavailable-title">Phone handoff isn’t reachable from here</p>
            <p className="try-handoff__unavailable-body">
              This page is on a local address phones cannot open. Use “Open on this device” to walk the
              claim on this computer, then continue to the merchant result.
            </p>
          </div>
        )}

        {note ? <p className="try-handoff__soft-note">{note}</p> : null}

        <ol className="try-handoff__status" data-testid="handoff-status">
          {HANDOFF_STEPS.map((s) => {
            const idx = HANDOFF_STEPS.indexOf(s);
            const cur = HANDOFF_STEPS.indexOf(liveStatus);
            return (
              <li
                key={s}
                className={`try-handoff__step ${idx <= cur ? "is-on" : ""} ${idx === cur ? "is-active" : ""}`}
              >
                <span className="try-handoff__dot" />
                {HANDOFF_LABEL[s]}
              </li>
            );
          })}
        </ol>

        {mounted ? (
          <p className="try-handoff__badge-row">
            {fixture ? (
              <>
                <span className="badge badge--fixture">Fixture</span>
                <span>Presentation path while live data is offline.</span>
              </>
            ) : phoneReachable ? (
              <>
                <span className="badge badge--live">Live</span>
                <span>Same claim ID on QR, phone, and desktop.</span>
              </>
            ) : (
              <>
                <span className="badge badge--fixture">Local only</span>
                <span>Phone scan unavailable — desktop claim still works.</span>
              </>
            )}
          </p>
        ) : null}
      </div>

      <div className="try-handoff__qr-wrap">
        {!mounted || (!qrUrl && !claimPath && !fixture) ? (
          <div className="try-handoff__qr-pending">Preparing shared claim…</div>
        ) : qrUrl ? (
          <>
            <QRCodeSVG value={qrUrl} size={240} marginSize={2} bgColor="#ffffff" fgColor="#1a0a18" />
            <a className="try-handoff__device-link" href={claimPath} data-testid="open-claim-this-device">
              Open on this device →
            </a>
            {claimId ? (
              <p className="font-mono text-[0.65rem] text-ink-soft">C-{claimId.toString()}</p>
            ) : null}
          </>
        ) : claimPath ? (
          <>
            <div className="try-handoff__qr-pending try-handoff__qr-pending--idle" data-testid="qr-localhost-warn">
              <span>Phone scan unavailable</span>
              <span className="try-handoff__qr-sub">Use the link below</span>
            </div>
            <a className="try-handoff__device-link" href={claimPath} data-testid="open-claim-this-device">
              Open claim on this device →
            </a>
            {claimId ? (
              <p className="font-mono text-[0.65rem] text-ink-soft">C-{claimId.toString()}</p>
            ) : null}
          </>
        ) : (
          <div className="try-handoff__qr-pending try-handoff__qr-pending--idle">
            <span>Fixture path</span>
            <span className="try-handoff__qr-sub">Not a live phone claim</span>
          </div>
        )}
      </div>
    </div>
  );
}
