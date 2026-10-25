"use client";

import { useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";

// The CRS identity step-up for this claim (worker/src/identity.ts, docs/CRS.md). Redacted rows only:
// persona id, bands, message codes and route. Identity is shown apart from the item on purpose:
// it tells a person whether to check who is claiming, never whether the item is defective.
const ROUTE: Record<string, { label: string; tone: string }> = {
  refund_investigator: { label: "Identity matched: counts as verified", tone: "text-honest" },
  merchant_identity_review: { label: "A person checks identity", tone: "text-review" },
  additional_verification: { label: "Step-up proof requested", tone: "text-review" },
};
const TRIGGER: Record<string, string> = {
  thin_history: "thin history", over_limit: "over the store's auto-approve limit", no_credential: "no verified credential",
  showcase: "home demo", manual: "re-screened by a person",
};

export function IdentityCard({ refundId }: { refundId: bigint }) {
  const [rows] = useTable(tables.identityScreening.where((r) => r.refundId.eq(refundId)));
  const latest = useMemo(() => [...rows].sort((a, b) => Number(b.id - a.id))[0], [rows]);

  return (
    <div className="glass p-3" data-testid="identity-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">Identity step-up · CRS sandbox</span>
        {latest ? <Badge kind={latest.source === "sandbox" ? "live" : "fixture"} /> : null}
      </div>
      {!latest ? (
        <p className="text-sm text-ink-soft-dark">Not screened: an established shopper with a verified credential, under the store limit, needs no identity step-up.</p>
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className={`font-semibold ${ROUTE[latest.route]?.tone ?? ""}`} data-testid="identity-route">{ROUTE[latest.route]?.label ?? latest.route}</div>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-ink-soft-dark">Why screened</dt><dd>{TRIGGER[latest.trigger] ?? latest.trigger}</dd>
            <dt className="text-ink-soft-dark">Contact risk</dt>
            <dd><span className="font-mono">{latest.contactRiskScore < 0 ? "unavailable" : latest.contactRiskScore}</span> ({latest.contactRiskBand}) · AtData Fraud Finder</dd>
            <dt className="text-ink-soft-dark">Identity</dt>
            <dd>{latest.identityStatus.replaceAll("_", " ")}{JSON.parse(latest.messageCodes || "[]").length ? ` · codes ${(JSON.parse(latest.messageCodes) as string[]).join(", ")}` : ""} · TransUnion TruValidate</dd>
            <dt className="text-ink-soft-dark">Test persona</dt><dd className="font-mono">{latest.personaId}{latest.cached ? " · from the 10-minute cache" : ""} · {latest.latencyMs} ms</dd>
          </dl>
          <ul className="list-disc pl-5 text-xs text-ink-soft-dark">
            {(JSON.parse(latest.reasonsJson || "[]") as string[]).map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[0.65rem] text-ink-soft-dark">Sandbox answers are real CRS API responses to scripted test personas; no real person is looked up. Identity never approves or declines a refund.</p>
    </div>
  );
}
