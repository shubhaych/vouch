"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { Tween } from "@/components/ui/num";
import { WORKER_URL } from "@/lib/stdb/config";
import { money, titleCase } from "@/lib/format";
import { businessDef, catalogItem } from "@vouch/module/world";

const MAX_SECONDS = 20;

export function ClaimView() {
  const params = useParams<{ id: string }>();
  const id = /^\d+$/.test(params.id ?? "") ? BigInt(params.id) : 0n;
  const [claims, ready] = useTable(tables.claim.where((r) => r.id.eq(id)));
  const claim = claims[0];
  const [refunds] = useTable(tables.refund.where((r) => r.id.eq(claim?.refundId ?? 0n)), { enabled: !!claim });
  const refund = refunds[0];
  const [purchases] = useTable(tables.purchase.where((r) => r.id.eq(refund?.purchaseId ?? 0n)), { enabled: !!refund });
  const purchase = purchases[0];
  const [runs] = useTable(tables.agentRun.where((r) => r.caseRef.eq(`C-${id}`)));
  const [decisions] = useTable(tables.decision.where((r) => r.refundId.eq(claim?.refundId ?? 0n)), { enabled: !!claim });
  const [credits] = useTable(tables.creditEvent.where((r) => r.causeTable.eq("refund")).where((r) => r.causeId.eq(claim?.refundId ?? 0n)), { enabled: !!claim });
  const item = purchase ? catalogItem(purchase.item) : undefined;

  if (!ready) return <Shell><div className="skeleton h-40 w-full" /></Shell>;
  if (!claim) return <Shell><p className="text-sm text-ink-soft">No claim C-{params.id}. Open the claim from the QR code on the shop page.</p></Shell>;

  const ev = runs.find((r) => r.seat === "evidence_analyst");
  const inv = runs.find((r) => r.seat === "refund_investigator");
  const proposal = [...decisions].sort((a, b) => Number(b.id - a.id))[0];
  const decided = refund && ["accepted", "declined"].includes(refund.status);
  const stage = decided ? 6 : proposal ? 5 : inv ? 4 : ev ? 3 : claim.frameUrls.length ? 2 : claim.status === "awaiting_video" ? 0 : 1;
  const steps = [
    { title: "Uploaded", on: stage >= 1 },
    { title: "Frames extracted", on: stage >= 2, sub: claim.frameUrls.length ? `${claim.frameUrls.length} frames` : undefined },
    { title: "Evidence Analyst reviewing", on: stage >= 3, active: ev?.status === "running", sub: ev ? `CREAO · ${ev.mode}` : undefined },
    { title: "Investigator recommending", on: stage >= 4, active: inv?.status === "running", sub: inv ? `CREAO · ${inv.mode}` : undefined },
    { title: "Business deciding", on: stage >= 5, active: stage === 5 },
    { title: "Decision", on: stage >= 6 },
  ];

  return (
    <Shell>
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Claim C-{claim.id.toString()} <Badge kind="live" /></div>
        <h1 className="text-xl font-bold">{item?.name ?? "Your item"}</h1>
        <p className="text-sm text-ink-soft">{refund ? `${titleCase(refund.reasonCode)} · ${money(refund.amount)}` : ""}{purchase ? ` · ${businessDef(purchase.business)?.name}` : ""}</p>
      </div>
      {claim.status === "offline" ? <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">The investigators are offline right now. The business can only ask you for more evidence; nothing is declined automatically.</div> : null}

      {stage === 0 || claim.status === "more_evidence" ? (
        <Recorder claimId={claim.id} nonce={claim.nonce} fingers={claim.fingerCount} />
      ) : null}

      <ol className="space-y-2" data-testid="claim-stepper">
        {steps.map((s, i) => (
          <motion.li key={s.title} initial={false} animate={{ opacity: s.on || s.active ? 1 : 0.4 }} className="flex items-center gap-3">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.on ? "bg-emerald-500 text-white" : s.active ? "animate-pulse bg-cyan-400 text-white" : "bg-slate-200 text-slate-500"}`}>{s.on ? "✓" : i + 1}</span>
            <span className="text-sm font-medium">{s.title}</span>
            {s.sub ? <span className="text-xs text-ink-soft">{s.sub}</span> : null}
          </motion.li>
        ))}
      </ol>

      <AnimatePresence>
        {decided && refund ? <DecisionCard status={refund.status} amount={refund.amount} method={proposal?.method ?? ""} credit={credits[0]} /> : null}
      </AnimatePresence>

      <p className="pt-2 text-[0.65rem] text-ink-soft">Challenge nonce {claim.nonce}. Video checks are internally consistent, not proof of authenticity; doubtful claims go to a person.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="light min-h-screen bg-bg px-4 py-6 text-ink" data-testid="claim">
      <div className="card-light mx-auto max-w-md space-y-5 p-5">{children}</div>
    </main>
  );
}

function DecisionCard({ status, amount, method, credit }: { status: string; amount: number; method: string; credit?: { before: number; after: number } }) {
  const ok = status === "accepted";
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={`rounded-xl p-4 ${ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`} data-testid="claim-decision">
      <div className="text-lg font-bold">{ok ? `Refund approved: ${money(amount)}` : "Refund declined"}</div>
      {ok ? <div className="text-sm">{method === "store_credit" ? "As store credit." : "To your original payment method."}</div> : <div className="text-sm">A person at the store made this decision.</div>}
      {credit ? (
        <div className="mt-3 text-sm">Your score: <span className="font-mono">{credit.before}</span> → <span className="font-mono text-2xl font-bold"><Tween value={credit.after} duration={1.4} /></span> <Badge kind="live" /></div>
      ) : null}
    </motion.div>
  );
}

function Recorder({ claimId, nonce, fingers }: { claimId: bigint; nonce: string; fingers: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) rec.current?.stop();
    }, 100);
    return () => clearInterval(id);
  }, [recording]);

  const upload = (blob: Blob, name: string) => {
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("video", blob, name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${WORKER_URL}/upload/${claimId}?nonce=${encodeURIComponent(nonce)}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let msg = "";
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? ""; } catch { msg = xhr.statusText; }
      if (xhr.status >= 200 && xhr.status < 300) setProgress(1);
      else { setProgress(null); setError(msg || `Upload failed (${xhr.status})`); }
    };
    xhr.onerror = () => { setProgress(null); setError(`Could not reach the upload server at ${WORKER_URL}.`); };
    xhr.send(form);
  };

  const start = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      setStream(s);
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      const type = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
      const r = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 2_500_000 });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        setRecording(false);
        s.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type });
        upload(blob, type === "video/mp4" ? "claim.mp4" : "claim.webm");
      };
      rec.current = r;
      r.start(250);
      setRecording(true);
    } catch {
      setError("Camera unavailable here. Use the file picker below (it opens the camera on most phones).");
    }
  };

  const ring = useMemo(() => {
    const pct = Math.min(1, elapsed / MAX_SECONDS);
    const c = 2 * Math.PI * 26;
    return { dash: c, offset: c * (1 - pct) };
  }, [elapsed]);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg p-4" data-testid="recorder">
      <div className="text-sm">Record 10 to 20 seconds with the rear camera. Show the whole item, then the problem up close. <b>At the end, hold up {fingers} fingers next to the item.</b></div>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
        {recording ? (
          <svg className="absolute right-3 top-3" width="64" height="64" aria-label="recording progress">
            <circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.3)" strokeWidth="5" fill="none" />
            <circle cx="32" cy="32" r="26" stroke="#ef4444" strokeWidth="5" fill="none" strokeDasharray={ring.dash} strokeDashoffset={ring.offset} transform="rotate(-90 32 32)" />
            <text x="32" y="37" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">{Math.ceil(MAX_SECONDS - elapsed)}</text>
          </svg>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {canRecord ? (
          recording ? <button className="btn btn--fraud btn--sm text-red-700" onClick={() => rec.current?.stop()} data-testid="stop-recording">Stop and upload</button>
            : <button className="btn btn--primary btn--sm" onClick={start} disabled={progress !== null && progress < 1} data-testid="start-recording">Record video</button>
        ) : null}
        <label className="btn btn--ghost btn--sm cursor-pointer">
          Use the camera app
          <input type="file" accept="video/*" capture="environment" className="hidden" data-testid="claim-video-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, f.name); e.target.value = ""; }} />
        </label>
      </div>
      {progress !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" data-testid="upload-progress">
          <div className="h-full bg-cyan-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {progress === 1 ? <div className="text-sm text-emerald-700">Uploaded. Extracting frames…</div> : null}
      {error ? <div className="rounded-lg bg-red-50 p-2 text-sm text-red-800" data-testid="upload-error">{error}</div> : null}
    </div>
  );
}
