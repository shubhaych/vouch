"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge, type Prov } from "@/components/ui/badge";
import { HudFrame } from "@/components/ui/hud-frame";
import { Tween } from "@/components/ui/num";
import { toast } from "@/components/ui/toast";
import { WORKER_URL } from "@/lib/stdb/config";
import { money } from "@/lib/format";
import { catalogItem } from "@vouch/module/world";

const SHOWCASE = 421;
const STEP_MS = 3500;
const LOOP_MS = 45_000;

interface Step { title: string; detail?: string; done: boolean; prov?: Prov; link?: string; mini?: boolean[] }

/** The showcase agent A-00421's latest buy → verify sequence, read from its real rows. */
function useShowcase() {
  const [purchases] = useTable(tables.purchase.where((r) => r.buyer.eq(SHOWCASE)).where((r) => r.source.eq("showcase")));
  const p = useMemo(() => [...purchases].sort((a, b) => Number(b.id - a.id))[0], [purchases]);
  const [refunds] = useTable(tables.refund.where((r) => r.purchaseId.eq(p?.id ?? 0n)), { enabled: !!p });
  const r = refunds[0];
  const [claims] = useTable(tables.claim.where((x) => x.refundId.eq(r?.id ?? 0n)), { enabled: !!r });
  const c = claims[0];
  const [evidence] = useTable(tables.evidence.where((x) => x.claimId.eq(c?.id ?? 0n)), { enabled: !!c });
  const [verifs] = useTable(tables.verification.where((x) => x.refundId.eq(r?.id ?? 0n)), { enabled: !!r });
  const [decisions] = useTable(tables.decision.where((x) => x.refundId.eq(r?.id ?? 0n)), { enabled: !!r });
  const [credits] = useTable(tables.creditEvent.where((x) => x.causeTable.eq("refund")).where((x) => x.causeId.eq(r?.id ?? 0n)), { enabled: !!r });
  const ea = evidence.find((e) => e.seat === "evidence_analyst");
  const ri = evidence.find((e) => e.seat === "refund_investigator");
  const v = [...verifs].filter((x) => x.status === "done").sort((a, b) => Number(b.id - a.id))[0];
  const d = [...decisions].sort((a, b) => Number(b.id - a.id))[0];
  const credit = credits[0];
  const prov = (s?: string): Prov => (s === "replay" ? "replay" : s === "fixture" ? "fixture" : "live");
  const vSteps = (() => { try { return (JSON.parse(v?.stepsJson ?? "[]") as { ok: boolean }[]).map((s) => s.ok); } catch { return []; } })();
  const item = p ? catalogItem(p.item) : undefined;
  const steps: Step[] = [
    { title: "Purchase recorded", detail: p ? `P-${p.id} · ${item?.name} ${money(p.amount)} · B-002` : undefined, done: !!p },
    { title: "Delivered", detail: p && p.status !== "ordered" ? `inside the refund window (day ${p.deliverDay})` : undefined, done: !!p && p.status !== "ordered" },
    { title: "Refund requested", detail: r ? `R-${r.id} · defective` : undefined, done: !!r },
    { title: "Frames extracted", detail: c?.frameUrls.length ? `${c.frameUrls.length} frames, hashed` : undefined, done: !!c?.frameUrls.length },
    { title: "Evidence Analyst reviewed", detail: "CREAO", done: !!ea, prov: ea ? prov(ea.provenance) : undefined, link: ea?.runUrl || undefined },
    { title: d ? `Investigator recommends ${d.action === "accept" ? `accept ${money(d.amount)}` : d.action.replace("_", " ")}` : "Investigator recommends", detail: "CREAO", done: !!d && !!ri, prov: ri ? prov(ri.provenance) : undefined, link: d?.runUrl || undefined },
    { title: "Credential verified", detail: v ? (v.passed ? "B-019's credential, 5 checks" : `failed at step ${v.failedStep}`) : undefined, done: !!v, mini: vSteps },
    { title: "Business accepted", detail: r?.status === "accepted" ? `${money(r.amount)} to the original payment` : undefined, done: r?.status === "accepted" },
    { title: credit ? `Credit ${credit.before} → ${credit.after}` : "Credit update", done: !!credit },
    { title: "The globe pings Chicago", done: !!credit },
  ];
  return { steps, claim: c, item, credit, complete: !!credit };
}

export function LiveDemo() {
  const { steps, claim, item, credit, complete } = useShowcase();
  const [shown, setShown] = useState(0);
  const [replaying, setReplaying] = useState(false);

  // While a sequence runs, steps light as rows land. Once complete, replay it on a 45 s loop.
  useEffect(() => {
    if (!complete) { setReplaying(false); setShown(steps.filter((s) => s.done).length); return; }
    setReplaying(true);
    let n = 0;
    setShown(0);
    const tick = setInterval(() => { n++; setShown(n); if (n >= steps.length) clearInterval(tick); }, STEP_MS);
    const loop = setInterval(() => {
      n = 0;
      setShown(0);
      const again = setInterval(() => { n++; setShown(n); if (n >= steps.length) clearInterval(again); }, STEP_MS);
    }, LOOP_MS);
    return () => { clearInterval(tick); clearInterval(loop); };
    // re-run when a new sequence completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, claim?.id]);

  const visible = steps.map((s, i) => ({ ...s, lit: replaying ? i < shown : s.done }));
  const stage = visible.filter((s) => s.lit).length;

  const watchLive = async () => {
    const code = prompt("Controller code (this spends CREAO credits):");
    if (!code) return;
    try {
      const res = await fetch(`${WORKER_URL}/showcase/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const j = (await res.json()) as { message?: string; error?: string };
      toast(j.message ?? j.error ?? `worker answered ${res.status}`, res.ok ? "accent" : "fraud");
    } catch { toast(`The worker at ${WORKER_URL} is not reachable.`, "fraud"); }
  };

  return (
    <HudFrame label={replaying ? "REPLAY OF RECORDED ROWS" : "LIVE"} right={<span className="font-mono">A-00421 · CHICAGO (SIMULATED) <Badge kind="simulated" /></span>} className="mt-8">
      <div className="grid gap-6 p-5 md:grid-cols-[17rem_1fr] md:p-7" data-testid="live-demo">
        <Phone stage={stage} itemName={item?.name ?? "Wireless headphones"} frames={claim?.frameUrls ?? []} credit={credit} />
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="panel-title">Verification</span>
            <span className="text-xs text-ink-soft-dark">each step lights when its SpacetimeDB row arrives</span>
          </div>
          <ol className="space-y-2" data-testid="demo-steps">
            {visible.map((s, i) => (
              <motion.li key={s.title + i} initial={false} animate={{ opacity: s.lit ? 1 : 0.32, x: s.lit ? 0 : -4 }} transition={{ duration: 0.3 }} className="flex items-center gap-3">
                <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.lit ? "bg-honest text-black" : "border border-line-dark text-ink-soft-dark"}`}>{s.lit ? "✓" : i + 1}</span>
                <span className="text-sm font-medium">
                  {i === 8 && s.lit && credit ? <>Credit {credit.before} → <span className="font-mono text-honest"><Tween value={credit.after} duration={1.2} /></span></> : s.title}
                </span>
                {s.detail && s.lit ? <span className="truncate text-xs text-ink-soft-dark">{s.detail}</span> : null}
                {s.prov && s.lit ? <Badge kind={s.prov} /> : null}
                {s.link && s.lit ? <a className="text-xs text-accent underline" href={s.link} target="_blank" rel="noreferrer">run</a> : null}
                {s.mini && s.lit ? <span className="flex gap-0.5">{s.mini.map((ok, k) => <span key={k} className={`h-2 w-2 rounded-full ${ok ? "bg-honest" : "bg-fraud"}`} />)}</span> : null}
                {i === 9 && s.lit ? <MiniGlobe /> : null}
              </motion.li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/shop" className="btn btn--glow btn--sm" data-testid="try-it">Try it yourself</Link>
            <button className="btn btn--ghost-dark btn--sm" onClick={() => void watchLive()}>Watch it live (CREAO, controller)</button>
          </div>
          <p className="mt-3 text-[0.68rem] text-ink-soft-dark">The worker plays A-00421 through the same reducers a shopper uses, once per demo reset. The two CREAO steps show the stored output of the most recent real run (Replay of real run) or a hand-written fixture (Fixture) until a live run is recorded.</p>
        </div>
      </div>
    </HudFrame>
  );
}

function Phone({ stage, itemName, frames, credit }: { stage: number; itemName: string; frames: string[]; credit?: { before: number; after: number } }) {
  const [frameIx, setFrameIx] = useState(0);
  useEffect(() => { const id = setInterval(() => setFrameIx((i) => i + 1), 700); return () => clearInterval(id); }, []);
  const scene = stage <= 1 ? "shop" : stage === 2 ? "delivered" : stage <= 4 ? "record" : stage <= 7 ? "review" : "done";
  return (
    <div className="mx-auto w-[16rem] rounded-[2.2rem] border border-white/15 bg-black p-2 shadow-2xl" aria-label="Showcase phone">
      <div className="relative h-[29rem] overflow-hidden rounded-[1.8rem] bg-bg text-ink">
        <div className="absolute left-1/2 top-2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black" />
        <AnimatePresence mode="wait">
          <motion.div key={scene} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="flex h-full flex-col gap-3 p-4 pt-9">
            {scene === "shop" ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Circuit Yard · B-002</div>
                <div className="flex h-28 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-600 text-4xl">🎧</div>
                <div className="font-bold">{itemName}</div>
                <div className="text-lg font-bold">$249.00</div>
                <div className={`rounded-lg py-2 text-center text-sm font-semibold ${stage >= 1 ? "bg-emerald-500 text-white" : "bg-cyan-500 text-black"}`}>{stage >= 1 ? "Order confirmed ✓" : "Buy"}</div>
              </>
            ) : scene === "delivered" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <motion.div initial={{ rotateX: 90 }} animate={{ rotateX: 0 }} transition={{ duration: 0.6 }} className="rounded-xl border border-line bg-white px-6 py-4 shadow">
                  <div className="text-xs uppercase text-ink-soft">Fast-forward</div>
                  <div className="text-3xl font-bold">Day 18</div>
                  <div className="text-xs text-emerald-700">inside the refund window</div>
                </motion.div>
                <div className="text-sm">Something is wrong: the left ear cup cracked.</div>
              </div>
            ) : scene === "record" ? (
              <>
                <div className="text-sm font-semibold">Record the claim</div>
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black">
                  {frames.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={frames[frameIx % frames.length]} alt="claim frame" className="h-full w-full object-cover" />
                  ) : <div className="flex h-full items-center justify-center text-xs text-white/60">camera</div>}
                  <span className="absolute right-2 top-2 rounded bg-red-600 px-1.5 text-[0.6rem] font-bold text-white">REC</span>
                </div>
                <div className="text-xs text-ink-soft">Hold up the requested fingers at the end.</div>
              </>
            ) : scene === "review" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
                <div className="text-sm font-semibold">Under review</div>
                <div className="text-xs text-ink-soft">AI agents are checking the evidence. A person at the store decides.</div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <div className="text-4xl">✅</div>
                <div className="font-bold">Refund approved</div>
                <div className="text-sm">$249.00 to your card</div>
                {credit ? <div className="mt-2 font-mono text-sm">{credit.before} → <span className="text-2xl font-bold text-emerald-600"><Tween value={credit.after} /></span></div> : null}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A small globe thumbnail that pings Chicago, where A-00421 lives in the simulation. */
function MiniGlobe() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-label="globe ping at Chicago">
      <circle cx="17" cy="17" r="15" fill="#0a1224" stroke="#22d3ee" strokeOpacity="0.5" />
      <ellipse cx="17" cy="17" rx="7" ry="15" fill="none" stroke="#22d3ee" strokeOpacity="0.25" />
      <line x1="2" y1="17" x2="32" y2="17" stroke="#22d3ee" strokeOpacity="0.25" />
      <circle cx="12" cy="11" r="1.6" fill="#34d399" />
      <circle cx="12" cy="11" r="2" fill="none" stroke="#34d399">
        <animate attributeName="r" from="2" to="9" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="1" to="0" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
