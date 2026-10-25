"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { FeedEvent } from "@/components/world/use-world";

const KIND_CLASS: Record<string, string> = {
  purchase: "is-inflow",
  refund: "is-request",
  refund_accepted: "is-outflow",
  refund_declined: "is-declined",
  credit: "is-score",
  claim: "is-claim",
  decision: "is-decision",
  delivery: "is-muted",
  join: "is-muted",
  pattern: "is-declined",
  system: "is-muted",
};

/**
 * Slim event rail: recent real feed rows with one highlighted causal chain.
 * Selecting an event focuses agent + merchant in every panel.
 */
export function EventRail({
  events,
  selectedSeq,
  chainAgentId,
  onSelect,
  running,
}: {
  events: FeedEvent[];
  selectedSeq: bigint | null;
  chainAgentId: number | null;
  onSelect: (e: FeedEvent) => void;
  running: boolean | null;
}) {
  const chain = useMemo(() => {
    if (chainAgentId === null) return findLatestChain(events);
    return events.filter((e) => e.agentId === chainAgentId).slice(0, 12);
  }, [events, chainAgentId]);

  const chainSeqs = useMemo(() => new Set(chain.map((e) => e.seq.toString())), [chain]);
  const shown = useMemo(() => events.slice(0, 36), [events]);

  return (
    <div className="sim-rail" data-testid="sim-event-rail">
      <div className="sim-rail__head">
        <div className="flex items-center gap-2 min-w-0">
          <span className="sim-panel__eyebrow" style={{ margin: 0 }}>
            Shared state
          </span>
          <Badge kind="live" />
          {running === false ? <span className="chip chip--review-light">Paused — no fake updates</span> : null}
        </div>
        <p className="sim-rail__blurb">
          One committed event updates the globe, trust timeline, and merchant flow together.
        </p>
      </div>
      <ol className="sim-rail__list" data-lenis-prevent>
        {shown.length === 0 ? (
          <li className="sim-rail__empty">Waiting for the first live event…</li>
        ) : (
          shown.map((e) => {
            const inChain = chainSeqs.has(e.seq.toString());
            const selected = selectedSeq !== null && e.seq === selectedSeq;
            return (
              <li key={e.seq.toString()}>
                <button
                  type="button"
                  className={`sim-rail__item ${KIND_CLASS[e.kind] ?? ""} ${inChain ? "in-chain" : ""} ${selected ? "is-selected" : ""}`}
                  onClick={() => onSelect(e)}
                  data-testid="sim-rail-item"
                >
                  <span className="sim-rail__kind">{e.kind.replaceAll("_", " ")}</span>
                  <span className="sim-rail__line">{e.line}</span>
                </button>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}

/** Prefer a recent purchase → accepted refund chain for the same agent. */
function findLatestChain(events: FeedEvent[]): FeedEvent[] {
  const accepted = events.find((e) => e.kind === "refund_accepted");
  if (!accepted || !accepted.agentId) {
    const purchase = events.find((e) => e.kind === "purchase");
    return purchase ? [purchase] : events.slice(0, 3);
  }
  const agentId = accepted.agentId;
  const related = events.filter(
    (e) =>
      e.agentId === agentId &&
      (e.kind === "purchase" ||
        e.kind === "refund" ||
        e.kind === "refund_accepted" ||
        e.kind === "refund_declined" ||
        e.kind === "credit"),
  );
  return related.slice(0, 8);
}
