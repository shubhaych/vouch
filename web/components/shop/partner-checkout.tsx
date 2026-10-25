"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { money, titleCase } from "@/lib/format";
import { claimHref } from "@/lib/claim-link";
import { HANDOFF_LABEL, HANDOFF_STEPS, publicOrigin, type HandoffStatus } from "@/lib/demo/judge-session";
import { companyById } from "@vouch/module/finance/companies";
import { REASONS } from "@vouch/module/text";

/**
 * One partner product: mock-buy it, or return it. A return runs the same live
 * flow as the home page's demo (purchase, delivered, refund requested, claim)
 * and then shows the claim's QR so a phone can record the video.
 */
export function PartnerCheckout({ companyId, sku, onClose }: { companyId: number; sku: string; onClose: () => void }) {
  const company = companyById(companyId);
  const product = company?.products.find((p) => p.sku === sku);
  const { status } = useStatus();
  const call = useCall();
  const [mine, mineReady] = useTable(tables.myAgent);
  const agentId = mine[0]?.agentId ?? null;
  const [purchases] = useTable(tables.purchase.where((r) => r.buyer.eq(agentId ?? 0)), { enabled: agentId != null });
  const [orders] = useTable(tables.partnerOrder);
  const [refunds] = useTable(tables.refund.where((r) => r.agentId.eq(agentId ?? 0)), { enabled: agentId != null });
  const [busy, setBusy] = useState<"" | "buying" | "returning">("");
  const [wantReturn, setWantReturn] = useState(false);
  const [reason, setReason] = useState<string>("not_as_described");
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const filing = useRef(false);

  useEffect(() => {
    if (status === "live" && mineReady && agentId === null) void call("joinAsShopper", (r) => r.joinAsShopper({ name: "Judge" }));
  }, [status, mineReady, agentId, call]);

  // The newest purchase of this product that has not been returned yet.
  const mineOfThis = useMemo(() => {
    const ids = new Set(orders.filter((o) => o.sku === sku).map((o) => o.purchaseId));
    return [...purchases].filter((p) => ids.has(p.id)).sort((a, b) => Number(b.id - a.id));
  }, [orders, purchases, sku]);
  const returned = (id: bigint) => refunds.some((r) => r.purchaseId === id);
  const open = mineOfThis.find((p) => !returned(p.id));
  const [claimFor, setClaimFor] = useState<bigint | null>(null);
  const refund = claimFor != null ? refunds.find((r) => r.purchaseId === claimFor) : undefined;
  const [claims] = useTable(tables.claim.where((r) => r.refundId.eq(refund?.id ?? 0n)), { enabled: !!refund });
  const claim = claims[0];
  const [jobs] = useTable(tables.analysisJob.where((r) => r.claimId.eq(claim?.id ?? 0n)), { enabled: !!claim });
  const job = [...jobs].sort((a, b) => Number(b.id - a.id))[0];
  const claimPurchase = purchases.find((p) => p.id === claimFor);

  const buy = async () => {
    setNote(null);
    setBusy("buying");
    const ok = await call("buyPartner", (r) => r.buyPartner({ companyId, sku }), `Ordered ${product?.name ?? "the item"}`);
    if (!ok) setNote("The order did not go through. Is the worker connected?");
    setBusy("");
  };

  // Return: buy first if there is nothing to return yet, then deliver and file the refund on the open purchase.
  const startReturn = async () => {
    setNote(null);
    setWantReturn(true);
    if (!open) await buy();
  };
  useEffect(() => {
    if (!wantReturn || !open || filing.current) return;
    filing.current = true;
    setBusy("returning");
    (async () => {
      if (open.status === "ordered" && !(await call("fastForward", (r) => r.fastForward({ purchaseId: open.id })))) { setNote("Could not mark the order delivered."); return; }
      const why = text.trim() || `${titleCase(reason)}: ${product?.name ?? "item"}`;
      if (await call("requestRefund", (r) => r.requestRefund({ purchaseId: open.id, reasonCode: reason, reasonText: why }))) setClaimFor(open.id);
      else setNote("The return could not be filed.");
    })().finally(() => { filing.current = false; setWantReturn(false); setBusy(""); });
  }, [wantReturn, open, call, reason, text, product?.name]);

  const handoff: HandoffStatus = !claim || claim.status === "awaiting_video" ? "waiting_phone"
    : job && !["done", "lanes_only", "failed"].includes(job.status) ? "checking"
    : job ? "result_ready" : "video_received";
  const path = claim ? claimHref(claim, claimPurchase, refund, { companyId, sku }) : "";
  const qr = path ? `${publicOrigin()}${path}` : "";

  if (!company || !product) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={product.name} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose} data-testid="partner-checkout">
      <div className="card-light w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-ink-soft">{company.name} · {company.category}</p>
            <h2 className="text-xl font-bold">{product.name}</h2>
            <p className="mt-1 text-sm text-ink-soft">{product.description}</p>
            <p className="mt-2 text-lg font-bold">{money(product.priceCents)}</p>
          </div>
          <button className="btn btn--ghost btn--xs" onClick={onClose} aria-label="Close">Close ✕</button>
        </div>

        {!claimFor ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn--ghost btn--sm" onClick={() => void buy()} disabled={!!busy || agentId == null} data-testid="partner-buy">{busy === "buying" && !wantReturn ? "Ordering…" : "Mock buy"}</button>
              <span className="text-xs text-ink-soft">{mineOfThis.length ? `You own ${mineOfThis.length} (simulated order${mineOfThis.length === 1 ? "" : "s"})` : agentId == null ? "Connecting your shopper…" : "No order yet"}</span>
            </div>
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-sm font-semibold">I want to return this item</p>
              <div className="grid gap-2 sm:grid-cols-[11rem_1fr]">
                <select className="rounded-lg border border-line px-2 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                  {REASONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                </select>
                <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="What is wrong? (optional)" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => void startReturn()} disabled={!!busy || agentId == null} data-testid="partner-return">
                {busy ? "Starting the return…" : open ? "Return this item" : "Buy and return (demo)"}
              </button>
              <p className="text-xs text-ink-soft">A return opens a live claim: scan the QR with your phone, record a short video, and the merchant result opens here.</p>
            </div>
          </>
        ) : (
          <div className="space-y-3" data-testid="partner-claim">
            {qr ? (
              <div className="flex flex-wrap items-center gap-4">
                <QRCodeSVG value={qr} size={168} marginSize={2} bgColor="#ffffff" fgColor="#1a0a18" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Claim C-{claim!.id.toString()}: scan with your phone</p>
                  <p className="text-ink-soft">Record the {product.name.toLowerCase()} and say what is wrong. At the end, hold up <b>{claim!.fingerCount}</b> fingers.</p>
                  <a className="text-sm text-cyan-800 underline" href={path}>Open on this device →</a>
                </div>
              </div>
            ) : <p className="text-sm text-ink-soft">Opening the claim…</p>}
            <ol className="space-y-1 text-sm">
              {HANDOFF_STEPS.map((s) => (
                <li key={s} className={HANDOFF_STEPS.indexOf(s) <= HANDOFF_STEPS.indexOf(handoff) ? "font-semibold" : "text-ink-soft"}>{HANDOFF_STEPS.indexOf(s) <= HANDOFF_STEPS.indexOf(handoff) ? "✓ " : "· "}{HANDOFF_LABEL[s]}</li>
              ))}
            </ol>
            {claim ? <Link className="btn btn--ghost btn--sm" href={`/merchant/claim/${claim.id.toString()}`}>{handoff === "result_ready" ? "Open the merchant result →" : "Merchant view of this claim →"}</Link> : null}
            <button className="btn btn--ghost btn--xs" onClick={() => setClaimFor(null)}>Start another return</button>
          </div>
        )}
        {note ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{note}</p> : null}
      </div>
    </div>
  );
}
