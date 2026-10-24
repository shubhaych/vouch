"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTable } from "spacetimedb/react";
import type { FraudPattern } from "@/module_bindings/types";
import { tables as t } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { patternLabel, timeAgo, titleCase } from "@/lib/format";

const KINDS = ["coordinated", "false_defect", "refund_frequency"] as const;
const STATUSES = ["detected", "reviewing", "confirmed", "dismissed"] as const;

export const STATUS_CHIP: Record<string, string> = {
  detected: "chip--review", reviewing: "chip--accent", confirmed: "chip--fraud", dismissed: "chip--honest", needs_review: "chip--credential", awaiting_review: "chip",
};
export const STATUS_LABEL: Record<string, string> = {
  detected: "Detected", reviewing: "Under review", confirmed: "Confirmed", dismissed: "Dismissed", needs_review: "Needs review", awaiting_review: "Awaiting review",
};


export function PatternsRail({ patterns, selectedId, onOpen }: { patterns: readonly FraudPattern[]; selectedId: number | null; onOpen: (id: number) => void }) {
  const [kind, setKind] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [runs] = useTable(t.agentRun.where((r) => r.seat.eq("pattern_analyst")));
  const shown = useMemo(
    () => [...patterns].filter((p) => (!kind || p.kind === kind) && (!status || p.status === status || (status === "reviewing" && p.status === "needs_review"))).sort((a, b) => b.id - a.id),
    [patterns, kind, status],
  );
  const running = new Map(runs.filter((r) => r.status === "running").map((r) => [r.caseRef, r]));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="glass flex min-h-0 flex-1 flex-col" data-testid="patterns-rail">
        <div className="border-b border-line-dark px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="panel-title">Fraud patterns</span>
            <span className="text-xs text-ink-soft-dark">{patterns.length} <Badge kind="live" /></span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(kind === k ? null : k)} className={`chip ${kind === k ? "chip--accent" : ""}`}>
                {titleCase(k)} {patterns.filter((p) => p.kind === k).length}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(status === s ? null : s)} className={`chip ${status === s ? STATUS_CHIP[s] : ""}`}>
                {STATUS_LABEL[s]} {patterns.filter((p) => p.status === s).length}
              </button>
            ))}
          </div>
        </div>
        <ol className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {shown.length === 0 ? (
            <li className="px-1 py-2 text-xs text-ink-soft-dark">No patterns yet. The worker runs the detectors every 5 simulated days and flags behaviour (timing, repetition, claim similarity, refund ratio), never region.</li>
          ) : null}
          {shown.map((p) => {
            const run = running.get(patternLabel(p.id));
            return (
              <li key={p.id}>
                <button onClick={() => onOpen(p.id)} data-testid={`pattern-${p.id}`}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition hover:border-accent/50 ${selectedId === p.id ? "border-accent/70 bg-accent/5" : "border-line-dark bg-white/[0.02]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">{patternLabel(p.id)}</span>
                    <span className={`chip ${STATUS_CHIP[p.status] ?? ""}`}>{STATUS_LABEL[p.status] ?? p.status}{run ? ` ${timeAgo(Number(run.startedAt.microsSinceUnixEpoch / 1000n))}` : ""}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft-dark">
                    {titleCase(p.kind)} · {p.agentIds.length} agents · days {p.firstDay}–{p.lastDay} · {p.detectorId} v{p.detectorVersion}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <DroidMini />
    </div>
  );
}

function DroidMini() {
  const [jobs] = useTable(t.labJob);
  const last = [...jobs].sort((a, b) => b.id - a.id)[0];
  return (
    <Link href="/lab" className="glass block px-3 py-2 transition hover:border-accent/40" data-testid="droid-mini">
      <div className="flex items-center justify-between">
        <span className="panel-title">Droid Detector Lab</span>
        <Badge kind="live" />
      </div>
      {last ? (
        <div className="mt-1 text-xs">
          <span className="font-mono">Job {last.id}</span> · {last.trigger} trigger · <span className="text-accent">{titleCase(last.status)}</span>
          <div className="truncate text-ink-soft-dark">{last.goal}</div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-ink-soft-dark">No lab jobs yet.</div>
      )}
    </Link>
  );
}
