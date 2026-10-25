"use client";

import { useTable } from "spacetimedb/react";
import { tables } from "@/module_bindings";
import type { IdentityScreening } from "@/module_bindings/types";
import { Badge } from "@/components/ui/badge";
import { timeAgo, titleCase } from "@/lib/format";

// The CRS screening for one claim, product by product (docs/CRS.md). CRS answers only whether the identity and
// contact details need more verification; it routes that question and never approves or declines a refund,
// so nothing here uses the fraud colour.

/** Mirrors REVIEW_SCORE in worker/src/crs.ts: at or above it, a person reviews the contact details. */
const REVIEW_SCORE = 70;

const ROUTE: Record<string, { label: string; next: string; tone: string }> = {
  refund_investigator: { label: "Clear: no identity check needed", next: "The claim goes on to the Refund Investigator; identity is not part of the question.", tone: "text-honest" },
  merchant_identity_review: { label: "Merchant identity review", next: "A person at the store checks the contact and identity details before or alongside the refund decision.", tone: "text-review" },
  additional_verification: { label: "More verification needed", next: "The shopper is asked for step-up verification. KBA and one-time passcodes are not available in the sandbox, so a person handles it.", tone: "text-review" },
};

// The sandbox returns these texts. 2101 is TransUnion's real address-mismatch code; CRS wrote the others for the hackathon.
const MESSAGE: Record<string, string> = {
  "2101": "Address mismatch",
  "2201": "SSN issued to another name",
  "2202": "SSN issue date inconsistent with date of birth",
  "2401": "Fraud alert on file; additional verification required",
};

const IDENTITY: Record<string, string> = {
  match: "Name, SSN, birth date and address matched",
  discrepancy: "Discrepancies returned",
  additional_verification: "Step-up verification requested",
  unavailable: "No verification returned (never treated as a match)",
};

const parseReasons = (s: string): string[] => { try { const r = JSON.parse(s) as unknown; return Array.isArray(r) ? r.map(String) : []; } catch { return []; } };

export function IdentityPanel({ row }: { row?: IdentityScreening }) {
  const [all] = useTable(tables.identityScreening);
  const prov = row?.source === "sandbox" ? "live" : "fixture";
  const counts = { refund_investigator: 0, merchant_identity_review: 0, additional_verification: 0 } as Record<string, number>;
  for (const s of all) if (!s.failed) counts[s.route] = (counts[s.route] ?? 0) + 1;

  return (
    <section className="glass min-w-0 space-y-3 p-4" data-testid="identity-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="panel-title">Identity screening · CRS {row ? <Badge kind={prov} /> : null}</div>
        {row ? <span className="chip font-mono text-xs" data-testid="identity-source">{row.source === "sandbox" ? "CRS sandbox API" : "fixture"} · checked {timeAgo(Number(row.checkedAt.microsSinceUnixEpoch / 1000n))} ago</span> : null}
      </div>
      <p className="text-sm text-ink-soft-dark">
        One question, asked before the refund investigation: do the identity and contact details with this return need more verification?
        CRS routes that question only. It never decides whether the item is as described and never approves or declines a refund.
      </p>

      {!row ? (
        <p className="text-sm text-ink-soft-dark" data-testid="identity-none">Not screened yet. The Desk Lead screens each real claim before the Risk Scorecard runs.</p>
      ) : row.failed ? (
        <p className="text-sm text-review" data-testid="identity-failed">The CRS call failed, so more proof is requested. A failed call is never a judgement about the shopper.</p>
      ) : (
        <>
          <div data-testid="identity-route">
            <div className={`text-xl font-bold ${ROUTE[row.route]?.tone ?? ""}`}>{ROUTE[row.route]?.label ?? titleCase(row.route)}</div>
            <p className="text-sm">{ROUTE[row.route]?.next}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-line-dark p-3 text-sm" data-testid="identity-fraud-finder">
              <div className="font-semibold">Fraud Finder (AtData) · contact risk</div>
              {row.contactRiskScore < 0 ? (
                <p className="mt-1 text-review">No score returned, so more proof is requested (never treated as risk).</p>
              ) : (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{row.contactRiskScore}</span>
                    <span className="text-ink-soft-dark">/ 100 · {row.contactRiskBand === "review" ? "review" : "low"}</span>
                  </div>
                  <div className="relative mt-1 h-2 rounded bg-line-dark" aria-hidden>
                    <div className={`h-2 rounded ${row.contactRiskScore >= REVIEW_SCORE ? "bg-review" : "bg-honest"}`} style={{ width: `${Math.min(100, row.contactRiskScore)}%` }} />
                    <div className="absolute top-[-3px] h-3.5 w-px bg-ink-soft-dark" style={{ left: `${REVIEW_SCORE}%` }} title={`review at ${REVIEW_SCORE}`} />
                  </div>
                  <p className="mt-1 text-xs text-ink-soft-dark">How risky the email, phone, IP and address look. A person reviews at {REVIEW_SCORE} or above. A contact-risk signal, not a credit score.</p>
                </>
              )}
            </div>

            <div className="rounded-lg border border-line-dark p-3 text-sm" data-testid="identity-truvalidate">
              <div className="font-semibold">TransUnion TruValidate (basic) · identity</div>
              <p className="mt-1">{IDENTITY[row.identityStatus] ?? titleCase(row.identityStatus)}</p>
              {row.messageCodes.length ? (
                <ul className="mt-1 space-y-1">
                  {row.messageCodes.map((c) => (
                    <li key={c} className="flex gap-2"><span className="chip chip--review font-mono">{c}</span><span>{MESSAGE[c] ?? "See the CRS message text"}</span></li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-xs text-ink-soft-dark">No discrepancy messages.</p>}
              <p className="mt-1 text-xs text-ink-soft-dark">A discrepancy is a reason for a person to look, not proof that the return is improper.</p>
            </div>
          </div>

          <div className="text-sm" data-testid="identity-reasons">
            <div className="font-semibold">Why this route (Vouch&apos;s routing rules)</div>
            <ul className="list-disc pl-5">{parseReasons(row.reasonsJson).map((r) => <li key={r}>{r}</li>)}</ul>
          </div>

          <p className="text-xs text-ink-soft-dark">
            Read by the Risk Scorecard as its identity indicator; it never feeds the video evidence score.
            Simulated shopper mapped onto CRS sandbox persona {row.personaId}: the sandbox answers each test persona from a script, and no real person&apos;s data is sent.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line-dark pt-2 text-xs" data-testid="identity-routing-counts">
        <span className="font-semibold">Routing across {all.length} screened claim{all.length === 1 ? "" : "s"}</span> <Badge kind="live" />
        <span className="chip chip--honest">clear {counts.refund_investigator}</span>
        <span className="chip chip--review">merchant review {counts.merchant_identity_review}</span>
        <span className="chip chip--review">more verification {counts.additional_verification}</span>
        <span className="text-ink-soft-dark">routing counts, never a fraud rate</span>
      </div>
    </section>
  );
}
