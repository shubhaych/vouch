"use client";

import { useMerchantPolicy } from "@/lib/data/hooks";
import { usd } from "@/lib/format";
import { ProvenanceBadge } from "./provenance-badge";

export function MerchantPolicyView() {
  const { policy, provenance } = useMerchantPolicy();
  const rows: [string, string][] = [
    ["Return window", `${policy.returnWindowDays} days`],
    ["Lane A cap, Tier 2", usd(policy.instantCapCents[2])],
    ["Lane A cap, Tier 3", usd(policy.instantCapCents[3])],
    ["Hold above", usd(policy.holdThresholdCents)],
    ["Controller approves above", usd(policy.materialityCents)],
    ["Vouch Record lifetime", `${policy.recordExpiryDays} days`],
  ];
  return (
    <div className="space-y-4">
      <ProvenanceBadge kind={provenance} />
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1.5"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

export function RiskDial() {
  const { policy } = useMerchantPolicy();
  // TODO: wire to setMerchantPolicy (controller only) and move the Atlas curve.
  return (
    <div>
      <label className="block">
        <span className="mb-2 block font-medium">Loss you will accept per $1,000 refunded: {usd(policy.riskDialLossPer1000Cents)}</span>
        <input type="range" disabled min={0} max={10_000} step={500} value={policy.riskDialLossPer1000Cents} readOnly className="w-full accent-accent" />
      </label>
      <p className="mt-2 text-sm text-muted">The dial moves the caps and thresholds. The Atlas curve shows speed against loss for each setting.</p>
    </div>
  );
}
