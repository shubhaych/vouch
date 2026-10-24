"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import { Badge } from "@/components/ui/badge";
import { useCall } from "@/lib/stdb/hooks";
import { businessLabel } from "@/lib/format";
import { parse } from "./investigation";

interface Step { n: number; title: string; ok: boolean; detail: string; bytes: string }

/** Section 11's five checks, animated 400 ms apart, with Tamper and Revoke to show them fail. */
export function CredentialStepper({ refundId }: { refundId: bigint }) {
  const [verifications] = useTable(tables.verification.where((r) => r.refundId.eq(refundId)));
  const [credentials] = useTable(tables.credential);
  const call = useCall();
  const latest = useMemo(() => [...verifications].sort((a, b) => Number(b.id - a.id))[0], [verifications]);
  const cred = latest ? credentials.find((c) => c.id === latest.credentialId) : undefined;
  const steps = parse<Step[]>(latest?.stepsJson, []);
  const revealed = parse<Record<string, unknown>>(latest?.revealedJson, {});
  const [shown, setShown] = useState(0);
  const key = `${latest?.id ?? 0}:${latest?.status ?? ""}`;

  useEffect(() => {
    setShown(0);
    if (!steps.length) return;
    let i = 0;
    const id = setInterval(() => { i++; setShown(i); if (i >= steps.length) clearInterval(id); }, 400);
    return () => clearInterval(id);
    // restart the animation for each new verification row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const again = (tamper: boolean) => cred && call("requestVerification", (r) => r.requestVerification({ credentialId: cred.id, refundId, tamper, verifier: 0 }));
  const revoke = (v: boolean) => cred && call("revokeCredential", (r) => r.revokeCredential({ id: cred.id, revoked: v }), v ? `${cred.id} revoked by ${businessLabel(cred.issuer)}` : `${cred.id} reinstated`);

  return (
    <div className="glass p-3" data-testid="credential-stepper">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">Vouch Credential verification <Badge kind="live" /></span>
        {cred ? (
          <div className="flex gap-1">
            <button className="btn btn--ghost-dark btn--xs" onClick={() => void again(false)} data-testid="cred-verify">Verify</button>
            <button className="btn btn--review btn--xs" onClick={() => void again(true)} data-testid="cred-tamper">Tamper</button>
            <button className="btn btn--fraud btn--xs" onClick={() => void revoke(!cred.revoked)} data-testid="cred-revoke" title={`Only ${businessLabel(cred.issuer)} (or the controller) may revoke: switch to it first`}>{cred.revoked ? "Reinstate" : "Revoke"} as {businessLabel(cred.issuer)}</button>
          </div>
        ) : null}
      </div>
      {!latest ? (
        <p className="text-sm text-ink-soft-dark">No credential presented for this claim.</p>
      ) : latest.status !== "done" ? (
        <p className="text-sm text-ink-soft-dark">Verifying {latest.credentialId}…</p>
      ) : (
        <ol className="space-y-1.5">
          <AnimatePresence>
            {steps.slice(0, shown).map((s) => (
              <motion.li key={`${key}-${s.n}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] font-bold ${s.ok ? "bg-honest text-black" : "bg-fraud text-black"}`}>{s.ok ? "✓" : "✕"}</span>
                  <span className="font-medium">{s.n}. {s.title}</span>
                  <span className="text-xs text-ink-soft-dark">{s.detail}</span>
                </div>
                <div className="ml-7 truncate font-mono text-[0.62rem] text-ink-soft-dark">{s.bytes}</div>
              </motion.li>
            ))}
          </AnimatePresence>
          {shown >= steps.length ? (
            <li className={`mt-1 text-sm font-semibold ${latest.passed ? "text-honest" : "text-fraud"}`} data-testid="cred-result">
              {latest.passed ? `Verified by ${String(revealed.issuer ?? "")}: ${String(revealed.policy ?? "")}` : `Failed at step ${latest.failedStep}${latest.tamper ? " (tampered presentation)" : ""}`}
            </li>
          ) : null}
        </ol>
      )}
      <p className="mt-2 text-[0.65rem] text-ink-soft-dark">Real Ed25519 signatures over salted digests of bands and thresholds; the verifier never sees transactions, video or the raw score. Issuers are simulated; the registry is SpacetimeDB.</p>
    </div>
  );
}
