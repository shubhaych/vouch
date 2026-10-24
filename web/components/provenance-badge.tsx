import type { Provenance } from "@vouch/module/types";

// Hard rule: every number and record in the UI carries one of these.
const STYLE: Record<Provenance, string> = {
  live: "border-accent bg-accent text-white",
  seeded: "border-muted/60 bg-surface text-foreground",
  simulated: "border-dashed border-muted bg-surface text-muted",
};
const LABEL: Record<Provenance, string> = { live: "Live", seeded: "Seeded", simulated: "Simulated" };

export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  return (
    <span
      title={`${LABEL[kind]} data`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLE[kind]}`}
    >
      {LABEL[kind]}
    </span>
  );
}
