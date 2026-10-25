"use client";

import { useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/num";
import { int } from "@/lib/format";

// CRS usage, from SpacetimeDB rows the worker writes on every CRS request (crs_call) and every
// identity screening (identity_screening, crs_stat). No row holds identity data (docs/CRS.md).
const parse = (s: string | undefined) => { try { return JSON.parse(s || "{}") as Record<string, number>; } catch { return {}; } };
const ROUTE_LABEL: Record<string, string> = { refund_investigator: "matched → investigator", merchant_identity_review: "person checks identity", additional_verification: "step-up proof" };

export function CrsPanel() {
  const [stats] = useTable(tables.crsStat);
  const [calls] = useTable(tables.crsCall);
  const s = stats[0];
  const recent = useMemo(() => [...calls].sort((a, b) => Number(b.id - a.id)).slice(0, 8), [calls]);
  const p50 = useMemo(() => {
    const ok = calls.filter((c) => c.status > 0 && c.status < 300 && c.product !== "login").map((c) => c.latencyMs).sort((a, b) => a - b);
    return ok.length ? ok[Math.floor(ok.length / 2)]! : null;
  }, [calls]);
  const routes = parse(s?.routesJson);
  const sim = parse(s?.simRoutesJson);
  const products = parse(s?.productsJson);

  return (
    <section className="glass p-4" data-testid="crs-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">CRS sandbox: identity step-up (AtData Fraud Finder + TransUnion TruValidate) <Badge kind="live" /></span>
        <span className="text-xs text-ink-soft-dark">health {s?.lastHealthStatus ? `HTTP ${s.lastHealthStatus}` : "not checked"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Requests to CRS" value={s ? Number(s.calls) : 0} prov="live" format={int} testId="crs-calls" />
        <Stat label="Failed requests" value={s ? Number(s.failedCalls) : 0} prov="live" format={int} />
        <Stat label="Claims screened" value={s ? Number(s.screenings) : 0} prov="live" format={int} testId="crs-screenings" />
        <Stat label="Simulated refunds routed" value={s ? Number(s.simRefundsScreened) : 0} prov="simulated" format={int} />
        <Stat label="Median latency (ms)" value={p50} prov="live" format={int} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div>
          <div className="panel-title mb-1">Requests by product</div>
          {Object.keys(products).length ? Object.entries(products).map(([k, v]) => <div key={k} className="flex justify-between font-mono"><span>{k}</span><span>{int(v)}</span></div>) : <p className="text-xs text-ink-soft-dark">No request yet: set CRS_MODE=sandbox (docs/CRS.md).</p>}
        </div>
        <div>
          <div className="panel-title mb-1">Claim screenings by route</div>
          {Object.entries(routes).map(([k, v]) => <div key={k} className="flex justify-between"><span>{ROUTE_LABEL[k] ?? k}</span><span className="font-mono">{int(v)}</span></div>)}
          {Object.entries(sim).length ? <div className="panel-title mb-1 mt-2">Simulated refunds by route <Badge kind="simulated" /></div> : null}
          {Object.entries(sim).map(([k, v]) => <div key={k} className="flex justify-between"><span>{ROUTE_LABEL[k] ?? k}</span><span className="font-mono">{int(v)}</span></div>)}
        </div>
        <div>
          <div className="panel-title mb-1">Latest requests</div>
          {recent.map((c) => (
            <div key={String(c.id)} className="flex justify-between font-mono text-xs">
              <span>{c.product}</span><span className={c.status > 0 && c.status < 300 ? "text-honest" : "text-fraud"}>{c.status || "no answer"}</span><span>{int(c.latencyMs)} ms</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[0.65rem] text-ink-soft-dark">Every request is metered by product, HTTP status and latency only. Simulated refunds are mapped onto CRS&apos;s four scripted test personas and answered from a 10-minute cache, so thousands of refunds cost at most four requests per persona window.</p>
    </section>
  );
}
