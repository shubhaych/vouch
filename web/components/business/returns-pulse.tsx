"use client";

import { useMemo, useState } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/num";
import { toast } from "@/components/ui/toast";
import { WORKER_URL } from "@/lib/stdb/config";
import { timeAgo } from "@/lib/format";
import { parse } from "./investigation";

interface PulseItem { sku: number; name: string; count: number; perSecond: number; baselinePerSecond: number; spike: boolean }
interface Given { items?: { sku: string; name: string; real_world?: { source: string; fetched_at: string; cached: boolean; signals: { title: string; url: string; source: string }[] } | null }[] }
interface Note {
  narrative?: string; anomalies?: { sku: string; kind: string; why: string }[]; items_to_watch?: string[]; innocent_explanation_considered?: string;
  real_world_context?: { sku: string; summary: string; urls: string[] }[]; trigger?: string; given?: Given;
}

const ms = (t?: { microsSinceUnixEpoch: bigint }) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : 0);

/**
 * The returns pulse: refunds per second from live rows (worker arithmetic, badged Live), and the
 * Returns Monitor agent's latest note about it, with the web return signals Bright Data scraped
 * for the busiest items. Counts, not fraud rates; the note names items, never shoppers.
 */
export function ReturnsPulse({ canRun }: { canRun: boolean }) {
  const [pulses] = useTable(tables.returnsPulse);
  const [notes] = useTable(tables.monitorNote);
  const [busy, setBusy] = useState(false);
  const pulse = pulses[0];
  const items = useMemo(() => parse<PulseItem[]>(pulse?.itemsJson, []), [pulse?.itemsJson]);
  const cohorts = useMemo(() => parse<{ band: string; count: number }[]>(pulse?.cohortsJson, []), [pulse?.cohortsJson]);
  const latest = useMemo(() => [...notes].sort((a, b) => Number(b.id - a.id))[0], [notes]);
  const note = useMemo(() => parse<Note>(latest?.json, {}), [latest?.json]);
  const noteProv = latest?.provenance === "fixture" ? "fixture" : "live";
  const scraped = (note.given?.items ?? []).filter((i) => i.real_world?.signals?.length);
  const liveScrape = scraped.some((i) => i.real_world?.source === "bright_data_serp");

  const runNow = async () => {
    const code = prompt("Seat code (business or controller): this spends one CREAO run");
    if (!code) return;
    setBusy(true);
    try {
      const r = await fetch(`${WORKER_URL}/monitor/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = (await r.json()) as { message?: string; error?: string };
      toast(j.message ?? j.error ?? `worker answered ${r.status}`, r.ok ? "accent" : "fraud");
    } catch {
      toast(`The worker at ${WORKER_URL} is not reachable.`, "fraud");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass p-4" data-testid="returns-pulse">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="panel-title">Returns pulse</div>
          <p className="text-xs text-ink-soft-dark">Refunds arriving per second, counted from live rows over a 60 s window. The Returns Monitor agent reads one window and the web signals scraped for its busiest items.</p>
        </div>
        {canRun ? <button className="btn btn--ghost-dark btn--xs" onClick={runNow} disabled={busy} data-testid="monitor-run">{busy ? "Running…" : "Run the Returns Monitor now"}</button> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_minmax(0,2fr)]">
        <Stat label="Returns / s" value={pulse ? pulse.perSecond : null} prov="live" format={(n) => n.toFixed(2)} sub={pulse ? `${pulse.returns} in the last ${pulse.windowSeconds} s` : undefined} testId="pulse-rate" />
        <Stat label="Baseline / s" value={pulse ? pulse.baselinePerSecond : null} prov="live" format={(n) => n.toFixed(3)} sub="the ten minutes before" />
        <Stat label="Items spiking" value={pulse ? pulse.spikes : null} prov="live" sub="≥ 3× baseline, ≥ 5 returns" testId="pulse-spikes" />
        <div className="min-w-0">
          <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wider opacity-70">Busiest items <Badge kind="live" /></div>
          {items.length === 0 ? <p className="text-xs text-ink-soft-dark">No returns in the last minute{pulse ? "" : " (the worker has not written a pulse yet)"}.</p> : (
            <ol className="space-y-1 text-xs">
              {items.slice(0, 5).map((it) => (
                <li key={it.sku} className="flex items-center justify-between gap-2">
                  <span className="truncate">{it.spike ? <span className="text-review">▲ </span> : null}{it.name} <span className="font-mono text-ink-soft-dark">SKU-{it.sku}</span></span>
                  <span className="shrink-0 font-mono text-ink-soft-dark">{it.count} · {it.perSecond.toFixed(2)}/s</span>
                </li>
              ))}
            </ol>
          )}
          {cohorts.length ? <p className="mt-2 text-[0.7rem] text-ink-soft-dark">By shopper band: {cohorts.map((c) => `${c.band} ${c.count}`).join(" · ")} <Badge kind="simulated" /></p> : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-line-dark bg-white/[0.02] p-3 text-sm" data-testid="monitor-note">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold">Returns Monitor</span>
          {latest ? <><Badge kind={noteProv} /><span className="text-xs text-ink-soft-dark">{note.trigger} · {timeAgo(ms(latest.at))}</span></> : <span className="text-xs text-ink-soft-dark">no note yet: it runs on a spike, on its schedule, or from the button</span>}
          {scraped.length ? <span className={`chip ${liveScrape ? "chip--accent" : ""}`} title={liveScrape ? "Web results fetched through Bright Data's SERP API" : "Fixture signals: Bright Data is in fixture mode"}>{liveScrape ? "web signals via Bright Data" : "web signals: fixture"}</span> : null}
        </div>
        {latest ? (
          <>
            <p className="text-ink-dark">{note.narrative}</p>
            {note.anomalies?.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {note.anomalies.map((a, i) => <li key={i}><span className="chip chip--review">{a.kind}</span> <span className="font-mono">{a.sku}</span> · {a.why}</li>)}
              </ul>
            ) : null}
            {note.innocent_explanation_considered ? <p className="mt-2 text-xs text-ink-soft-dark"><span className="font-semibold">Innocent explanation considered:</span> {note.innocent_explanation_considered}</p> : null}
            {scraped.length ? (
              <div className="mt-2 text-xs">
                <div className="text-ink-soft-dark">What the web says about returns of these items (descriptive context, not a rate):</div>
                <ul className="mt-1 space-y-0.5">
                  {scraped.flatMap((i) => (i.real_world!.signals.slice(0, 2).map((s, k) => (
                    <li key={`${i.sku}-${k}`} className="truncate"><span className="font-mono text-ink-soft-dark">{i.sku}</span> · <a className="text-accent underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="text-ink-soft-dark">({s.source || new URL(s.url).hostname})</span></li>
                  ))))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
