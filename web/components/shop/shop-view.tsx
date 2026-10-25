"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { Purchase } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { useCall, useStatus } from "@/lib/stdb/hooks";
import { agentLabel, businessLabel, money, titleCase } from "@/lib/format";
import { BUSINESS_A, BUSINESS_B, CATALOG, businessDef, catalogItem, type CatalogItem } from "@vouch/module/world";
import { REASONS } from "@vouch/module/text";
import { claimHref } from "@/lib/claim-link";
import { DISCLAIMER } from "@vouch/module/finance/companies";

const BAND_TEXT: Record<string, string> = { red: "text-red-600", amber: "text-amber-600", neutral: "text-slate-600", green: "text-emerald-600" };
const SHOPS = [BUSINESS_A, BUSINESS_B];

export function ShopView() {
  return (
    <main className="light min-h-screen bg-bg pb-16 text-ink" data-testid="shop">
      <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6">
        <header>
          <div>
            <p className="section__eyebrow">Simulated partner network · SpacetimeDB</p>
            <h1 className="section__title">Explore 100 shops</h1>
            <p className="mt-1 max-w-xl text-sm text-ink-soft">Browse sample products from the simulated shops and open any shop’s Refund Finance Desk.</p>
          </div>
        </header>
        <PartnerDirectory />
      </div>
    </main>
  );
}

function PartnerDirectory() {
  const [companies] = useTable(tables.financeCompany);
  const [products] = useTable(tables.financeProduct);
  const [states] = useTable(tables.financeCompanyState);
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => [...new Set(companies.map((c) => c.category))].sort(), [companies]);
  const visible = useMemo(() => [...companies]
    .filter((c) => category === "all" || c.category === category)
    .sort((a, b) => a.id - b.id), [companies, category]);

  return (
    <section className="space-y-4" data-testid="partner-directory">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section__eyebrow">The partner network · SpacetimeDB</p>
          <h2 className="text-2xl font-bold">100 simulated shops</h2>
          <p className="mt-1 text-sm text-ink-soft">Every shop has a four-product catalog and live portfolio activity. Select one to inspect its Refund Finance Desk.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-soft"><Badge kind="simulated" /> {companies.length} stores · {products.length} products</span>
          <select aria-label="Filter shops by category" className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {companies.length === 0 ? <div className="card-light p-4 text-sm text-ink-soft">Partner catalog is loading. Start the worker with FINANCE_DESK=1 to seed the 100 shops.</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((company) => {
          const catalog = products.filter((p) => p.companyId === company.id);
          const state = states.find((s) => s.companyId === company.id);
          return (
            <article className="card-light flex flex-col gap-3 p-4" key={company.id} data-testid={`partner-${company.slug}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{company.name.slice(0, 2).toUpperCase()}</span>
                  <div><h3 className="font-bold">{company.name}</h3><p className="text-xs text-ink-soft">{company.category} · partner {String(company.id).padStart(3, "0")}</p></div>
                </div>
                {company.featured ? <span className="chip">Featured book</span> : null}
              </div>
              <p className="text-sm text-ink-soft">{company.tagline}</p>
              <div className="grid grid-cols-2 gap-2">
                {catalog.slice(0, 4).map((p) => <div key={p.sku} className="rounded-lg border border-line/70 p-2"><p className="truncate text-xs font-semibold">{p.name}</p><p className="mt-1 text-xs text-ink-soft">{money(p.priceCents)}</p></div>)}
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-line/70 pt-3 text-xs text-ink-soft">
                <span><Badge kind="simulated" /> {state ? `${state.orders.toLocaleString()} orders · ${state.flags.toLocaleString()} flags` : "Awaiting first finance tick"}</span>
                <Link className="font-semibold text-cyan-800 underline" href={`/desk?company=${company.id}`}>Finance desk</Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgentCard({ agentId }: { agentId: number }) {
  const [rows] = useTable(tables.agent.where((r) => r.id.eq(agentId)));
  const a = rows[0];
  return (
    <div className="card-light flex items-center gap-5 px-5 py-4" data-testid="agent-card">
      <div>
        <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">Your agent <Badge kind="live" /></div>
        <div className="font-mono text-lg font-bold">{agentLabel(agentId)}</div>
        <div className="text-xs text-ink-soft">Home region: {a?.homeRegionName ?? "…"} (simulated)</div>
      </div>
      <div className="text-right">
        <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">Score</div>
        <div className={`text-3xl font-bold ${BAND_TEXT[a?.band ?? "neutral"]}`} data-testid="my-score">{a ? <Tween value={a.score} /> : "…"}</div>
        <div className="text-xs text-ink-soft">{a?.band ?? ""} · / 1000</div>
      </div>
    </div>
  );
}

function Catalog() {
  const [checkout, setCheckout] = useState<{ item: CatalogItem; shop: number } | null>(null);
  const items = useMemo(() => CATALOG.filter((c) => c.category === "electronics"), []);
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-lg font-bold">Products</h2>
        <span className="text-xs text-ink-soft">Business A ({businessDef(BUSINESS_A)?.name}, {businessLabel(BUSINESS_A)}) and Business B ({businessDef(BUSINESS_B)?.name}, {businessLabel(BUSINESS_B)})</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <article key={item.sku} className="feature--telemetry flex flex-col justify-between" data-testid={`product-${item.sku}`}>
            <div>
              <div className="feature__kicker">{`SKU ${item.sku} · ${item.category}`}</div>
              <h3 className="feature__title">{item.name}</h3>
              <p className="feature__body text-sm">{item.description}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-lg font-bold">{money(item.priceCents)}</span>
              <div className="flex gap-1">
                {SHOPS.map((s) => (
                  <button key={s} className="btn btn--ghost btn--xs" onClick={() => setCheckout({ item, shop: s })} data-testid={`buy-${item.sku}-${s}`}>{s === BUSINESS_A ? "Buy at A" : "Buy at B"}</button>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      <AnimatePresence>{checkout ? <Checkout {...checkout} onClose={() => setCheckout(null)} /> : null}</AnimatePresence>
    </section>
  );
}

function Checkout({ item, shop, onClose }: { item: CatalogItem; shop: number; onClose: () => void }) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    const ok = await call("buy", (r) => r.buy({ businessId: shop, sku: item.sku }), `Ordered ${item.name} from ${businessDef(shop)?.name}`);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="card-light w-full max-w-md rounded-b-none p-6 sm:rounded-b-xl" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()} data-testid="checkout">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Checkout</h3>
          <Badge kind="simulated" />
        </div>
        <p className="mt-1 text-sm text-ink-soft">{item.name} from {businessDef(shop)?.name} ({businessLabel(shop)})</p>
        <div className="mt-4 space-y-2 rounded-lg border border-line bg-bg p-3 font-mono text-sm">
          <div className="flex justify-between"><span>Card</span><span>4242 4242 4242 4242</span></div>
          <div className="flex justify-between"><span>Expiry</span><span>12/29</span></div>
          <div className="flex justify-between font-sans font-bold"><span>Total</span><span>{money(item.priceCents)}</span></div>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Simulated payment: no money moves. The order is a real row in SpacetimeDB.</p>
        <div className="mt-4 flex gap-2">
          <button className="btn btn--primary flex-1" disabled={busy} onClick={pay} data-testid="pay">{busy ? "Paying…" : `Pay ${money(item.priceCents)}`}</button>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Orders({ agentId }: { agentId: number }) {
  const [purchases] = useTable(tables.purchase.where((r) => r.buyer.eq(agentId)));
  const [refunds] = useTable(tables.refund.where((r) => r.agentId.eq(agentId)));
  const sorted = useMemo(() => [...purchases].sort((a, b) => Number(b.id - a.id)), [purchases]);
  if (!sorted.length) return <section className="card-light px-5 py-4 text-sm text-ink-soft">No orders yet. Buy something below.</section>;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">Your orders <Badge kind="live" /></h2>
      {sorted.map((p) => <OrderCard key={p.id.toString()} p={p} refund={refunds.find((r) => r.purchaseId === p.id)} />)}
    </section>
  );
}

function OrderCard({ p, refund }: { p: Purchase; refund?: { id: bigint; status: string; amount: number; reasonCode: string } }) {
  const call = useCall();
  const item = catalogItem(p.item);
  const [flip, setFlip] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<string>("defective");
  const [text, setText] = useState("");
  const [claims] = useTable(tables.claim.where((r) => r.refundId.eq(refund?.id ?? 0n)), { enabled: !!refund });
  const claim = claims[0];
  const steps = ["Ordered", "Shipped", "Delivered"];
  const at = p.status === "ordered" ? 1 : 2;

  const fastForward = async () => {
    setFlip(true);
    await call("fastForward", (r) => r.fastForward({ purchaseId: p.id }), "Fast-forwarded: delivered and inside the refund window");
    setTimeout(() => setFlip(false), 900);
  };
  const ask = async () => {
    const ok = await call("requestRefund", (r) => r.requestRefund({ purchaseId: p.id, reasonCode: reason, reasonText: text || `${titleCase(reason)}: ${item?.name}` }));
    if (ok) setAsking(false);
  };
  // The link carries the claim's details so the phone shows the upload box before its live connection is up.
  const claimPath = claim ? claimHref(claim, p, refund) : "";
  const claimUrl = claim && typeof window !== "undefined" ? `${window.location.origin}${claimPath}` : "";

  return (
    <article className="card-light p-4" data-testid={`order-${p.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{item?.name} · {money(p.amount)}</div>
          <div className="text-xs text-ink-soft">P-{p.id.toString()} · {businessDef(p.business)?.name} ({businessLabel(p.business)}) · day {p.day}</div>
        </div>
        <ol className="flex items-center gap-2 text-xs">
          {steps.map((s, i) => (
            <li key={s} className={`flex items-center gap-1 ${i <= at ? "text-ink" : "text-ink-soft/50"}`}>
              <span className={`h-2 w-2 rounded-full ${i <= at ? "bg-emerald-500" : "bg-slate-300"}`} />{s}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.status === "ordered" ? (
          <button className="btn btn--primary btn--sm" onClick={fastForward} data-testid="fast-forward">
            <motion.span animate={flip ? { rotateX: [0, 180, 360] } : {}} transition={{ duration: 0.8 }} className="inline-block">📅</motion.span>
            Fast-forward to refund window
          </button>
        ) : null}
        {p.status === "delivered" && !refund && !asking ? <button className="btn btn--ghost btn--sm" onClick={() => setAsking(true)} data-testid="request-refund">Request a refund</button> : null}
        {refund ? <span className="chip border-line text-ink">Refund R-{refund.id.toString()}: {titleCase(refund.status)}</span> : null}
        {p.status === "kept" ? <span className="text-xs text-ink-soft">Kept past the window.</span> : null}
      </div>
      {asking ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
          <select className="rounded-lg border border-line px-2 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="refund-reason">
            {REASONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </select>
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="What is wrong? (a sentence)" value={text} onChange={(e) => setText(e.target.value)} data-testid="refund-text" />
          <button className="btn btn--primary btn--sm" onClick={ask} data-testid="submit-refund">Start claim</button>
        </div>
      ) : null}
      {claim ? (
        <div className="mt-4 flex flex-wrap items-center gap-5 rounded-lg border border-line bg-bg p-4" data-testid="claim-qr">
          <QRCodeSVG value={claimUrl} size={168} marginSize={2} />
          <div className="space-y-1 text-sm">
            <div className="font-semibold">Claim C-{claim.id.toString()}: record the video on your phone</div>
            <div className="text-ink-soft">Scan the code, or <Link className="text-cyan-700 underline" href={claimPath} data-testid="use-this-device">use this device</Link>. At the end, hold up <b>{claim.fingerCount}</b> fingers next to the item.</div>
            <div className="text-xs text-ink-soft">Status: {titleCase(claim.status)} <Badge kind="live" /></div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
