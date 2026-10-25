"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BUSINESSES,
  CATEGORIES,
  CATALOG,
  type BusinessDef,
  type Category,
  catalogItem,
  regionById,
} from "@vouch/module/world";
import { Badge } from "@/components/ui/badge";

const COUNT = BUSINESSES.length;

/** Illustrative portable history — no raw videos or private purchase lines. */
const SAMPLE_HISTORY = [
  { merchant: "Harbor Threads", outcome: "Wrong size · approved", when: "2026-08" },
  { merchant: "Circuit Yard", outcome: "Defective · approved", when: "2026-05" },
  { merchant: "Nest Lane", outcome: "Never received · declined after carrier proof", when: "2026-01" },
] as const;

export function NetworkView() {
  const [category, setCategory] = useState<Category | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(BUSINESSES[18]?.id ?? 1);
  const [productSku, setProductSku] = useState<number | null>(null);

  const filtered = useMemo(
    () => (category === "all" ? BUSINESSES : BUSINESSES.filter((b) => b.category === category)),
    [category],
  );
  const selected = BUSINESSES.find((b) => b.id === selectedId) ?? filtered[0];
  const products = useMemo(
    () => (selected ? CATALOG.filter((c) => c.category === selected.category).slice(0, 8) : []),
    [selected],
  );
  const product = productSku != null ? catalogItem(productSku) : products[0];

  return (
    <main className="network-page" data-testid="network">
      <header className="network-page__hero">
        <p className="section__eyebrow">Merchant network</p>
        <h1 className="section__title">
          {COUNT} companies · products and policies you can explore
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Verified refund history can inform decisions across merchants without exposing customers’
          raw videos or private purchase details. Counts come from the simulation catalog (
          <Badge kind="simulated" />), not live retailer APIs.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-soft" data-testid="network-count">
          BUSINESSES.length = {COUNT}
        </p>
      </header>

      <div className="network-filters" role="tablist" aria-label="Category">
        <button
          type="button"
          className={`network-filters__chip ${category === "all" ? "is-on" : ""}`}
          onClick={() => setCategory("all")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`network-filters__chip ${category === c ? "is-on" : ""}`}
            onClick={() => {
              setCategory(c);
              const first = BUSINESSES.find((b) => b.category === c);
              if (first) {
                setSelectedId(first.id);
                setProductSku(null);
              }
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="network-grid">
        <aside className="network-list" data-testid="network-list">
          <ol>
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={`network-list__row ${selected?.id === b.id ? "is-on" : ""}`}
                  onClick={() => {
                    setSelectedId(b.id);
                    setProductSku(null);
                  }}
                  data-testid={`network-biz-${b.id}`}
                >
                  <span className="font-mono text-[0.65rem] text-ink-soft">B-{String(b.id).padStart(3, "0")}</span>
                  <span className="network-list__name">{b.name}</span>
                  <span className="network-list__meta">{b.category}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        {selected ? (
          <CompanyDetail
            business={selected}
            products={products}
            product={product}
            onProduct={(sku) => setProductSku(sku)}
          />
        ) : null}
      </div>

      <section className="network-portable" data-testid="portable-history">
        <div>
          <p className="section__eyebrow">Across merchants</p>
          <h2 className="text-xl font-bold tracking-tight">Portable history — not the raw case file.</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Another merchant sees confirmed outcomes and a Vouch signal. They do not receive the customer’s
            video, packing slip, or full order line from the previous store.
          </p>
        </div>
        <ul className="network-portable__list">
          {SAMPLE_HISTORY.map((h) => (
            <li key={h.when + h.merchant}>
              <span className="font-mono text-[0.65rem] text-ink-soft">{h.when}</span>
              <strong>{h.merchant}</strong>
              <span className="text-sm text-ink-soft">{h.outcome}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-soft">
          <Badge kind="fixture" /> Illustrative outcomes for the pitch — live score changes come from confirmed
          decisions in SpacetimeDB.
        </p>
      </section>

      <p className="network-page__next">
        Next:{" "}
        <Link href="/simulation" className="underline">
          watch 10,000 simulated agents →
        </Link>
      </p>
    </main>
  );
}

function CompanyDetail({
  business,
  products,
  product,
  onProduct,
}: {
  business: BusinessDef;
  products: ReturnType<typeof CATALOG.filter>;
  product: ReturnType<typeof catalogItem>;
  onProduct: (sku: number) => void;
}) {
  const region = regionById(business.regionId);
  const p = business.policy;

  return (
    <article className="network-detail" data-testid="network-detail">
      <header>
        <p className="font-mono text-xs text-ink-soft">B-{String(business.id).padStart(3, "0")}</p>
        <h2 className="text-2xl font-bold tracking-tight">{business.name}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {business.category} · {region?.name ?? `Region ${business.regionId}`} (simulated)
        </p>
      </header>

      <div className="network-detail__policy">
        <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
          Refund policy
        </span>
        <ul>
          <li>{p.windowDays}-day return window</li>
          <li>Video required over ${(p.needsVideoOverCents / 100).toFixed(0)}</li>
          {p.restockingFeePct > 0 ? <li>{p.restockingFeePct}% restocking fee</li> : <li>No restocking fee</li>}
          <li>{p.storeCreditAllowed ? "Store credit allowed" : "Refund to original payment only"}</li>
          {p.notes ? <li>{p.notes}</li> : null}
        </ul>
      </div>

      <div>
        <span className="panel-title" style={{ color: "var(--ink-soft)" }}>
          Category products
        </span>
        <ul className="network-products">
          {products.map((item) => (
            <li key={item.sku}>
              <button
                type="button"
                className={`network-products__item ${product?.sku === item.sku ? "is-on" : ""}`}
                onClick={() => onProduct(item.sku)}
              >
                <span>{item.name}</span>
                <span className="font-mono text-xs">${(item.priceCents / 100).toFixed(0)}</span>
              </button>
            </li>
          ))}
        </ul>
        {product ? (
          <p className="mt-3 text-sm text-ink-soft" data-testid="network-product">
            {product.description}
          </p>
        ) : null}
      </div>
    </article>
  );
}
