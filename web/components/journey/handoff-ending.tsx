"use client";

import { QRCodeSVG } from "qrcode.react";
import { useDemo } from "@/lib/demo/demo-store";
import { CUSTOMER_APP_LABEL, CUSTOMER_APP_URL } from "@/lib/demo/config";
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function HandoffEnding() {
  const { simulateIncoming, claims, handoffClaimId, approvalDurationMs } = useDemo();
  const handoff = claims.find((c) => c.id === handoffClaimId);
  const approved = handoff?.status === "approved";
  const appUrl = CUSTOMER_APP_URL || "https://customer.vouch.demo";

  return (
    <section className="section journey-section" id="handoff" data-testid="handoff-ending">
      <p className="section__eyebrow">Customer handoff</p>
      <h2 className="section__title">The customer records the claim in a separate app.</h2>
      <p className="mt-3 max-w-2xl text-ink-soft">
        This website stays the merchant control room. A button or QR sends the judge to the customer app
        (demo order preloaded). Until that app is wired, use <strong>Simulate incoming claim</strong> —
        the inbox updates live the same way.
      </p>

      <div className="handoff-card">
        <div className="handoff-card__actions">
          {CUSTOMER_APP_URL ? (
            <a
              className="btn btn--primary"
              href={CUSTOMER_APP_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="open-customer-app"
            >
              {CUSTOMER_APP_LABEL}
            </a>
          ) : (
            <button type="button" className="btn btn--primary" disabled title="Set NEXT_PUBLIC_CUSTOMER_APP_URL">
              {CUSTOMER_APP_LABEL}
            </button>
          )}
          <button
            type="button"
            className="btn btn--glow"
            onClick={() => {
              simulateIncoming();
              document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" });
            }}
            data-testid="simulate-from-handoff"
          >
            Simulate incoming claim
          </button>
          <p className="text-sm text-ink-soft">
            Configure later with <code className="font-mono text-xs">NEXT_PUBLIC_CUSTOMER_APP_URL</code>.
          </p>
        </div>
        <div className="handoff-card__qr" aria-label="Customer app QR placeholder">
          <QRCodeSVG value={appUrl} size={132} bgColor="#ffffff" fgColor="#111820" />
          <span className="mt-2 block text-center font-mono text-[0.65rem] text-ink-soft">
            {CUSTOMER_APP_URL ? "Scan to open customer app" : "QR placeholder · URL pending"}
          </span>
        </div>
      </div>

      <div className="ending-story" data-testid="ending-story">
        <p className="section__eyebrow">End on the person behind the ticket</p>
        <h3 className="text-2xl font-bold tracking-tight">She should not wait in a queue while life keeps moving.</h3>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Illustrative customer: a single parent who ordered the wrong-size raincoat for her kid.
          She films the tag, explains the mismatch, and needs a decision while she works and cares for her children —
          not hours on tickets or support calls.
        </p>

        <div className="ending-metrics">
          <div>
            <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Demo submission → refund approval</span>
            <div className="ending-metrics__value" data-testid="approval-time">
              {approvalDurationMs != null && approved
                ? formatDuration(approvalDurationMs)
                : handoff
                  ? approved
                    ? "—"
                    : "Approve the handoff claim in the demo to measure"
                  : "Simulate a claim, then approve it"}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Exact about outcomes: <strong>refund approved</strong> can be immediate.
              Money back in her account still depends on payment processing — we do not claim settlement here.
            </p>
          </div>
          <div>
            <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Merchant evidence trail</span>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>Video + spoken claim received</li>
              <li>Ordered vs observed compared</li>
              <li>Policy checked · history consulted</li>
              <li>Confirmed decision recorded · score updated</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
