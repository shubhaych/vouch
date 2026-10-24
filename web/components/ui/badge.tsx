// Hard rule: every number on screen sits next to one of these.
export type Prov = "live" | "simulated" | "fixture" | "replay";

const LABEL: Record<Prov, string> = { live: "Live", simulated: "Simulated", fixture: "Fixture", replay: "Replay of real run" };
const TITLE: Record<Prov, string> = {
  live: "Computed now from SpacetimeDB rows",
  simulated: "Produced by the agent simulation (synthetic agents)",
  fixture: "Recorded test data, not a live run",
  replay: "The stored output of a real CREAO run, replayed",
};

export function Badge({ kind, className = "" }: { kind: Prov; className?: string }) {
  return (
    <span className={`badge badge--${kind} ${className}`} title={TITLE[kind]} data-prov={kind}>
      {LABEL[kind]}
    </span>
  );
}
