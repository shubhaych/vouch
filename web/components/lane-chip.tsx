import type { Lane, Tier } from "@vouch/module/types";
import { LANES, TIER_LABELS } from "@/lib/product";

export function LaneChip({ lane }: { lane: Lane }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 text-sm font-medium">
      <span className="font-bold text-accent">Lane {lane}</span>
      <span className="text-muted">{LANES[lane].name}</span>
    </span>
  );
}

export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-0.5 text-sm font-medium text-accent">
      <span className="font-bold">Tier {tier}</span>
      <span>{TIER_LABELS[tier]}</span>
    </span>
  );
}
