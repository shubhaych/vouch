"use client";

import { useState, type ReactNode, type RefObject, type VideoHTMLAttributes } from "react";
import type { AgentRun, Claim, Decision, Evidence, IdentityScreening, ScoreReview } from "@/module_bindings/types";
import { Badge, type Prov } from "@/components/ui/badge";
import { money, pct, titleCase } from "@/lib/format";
import type { Report } from "@vouch/module/review-types";
import { TIER_LABEL } from "@vouch/module/review-score";
import { parse, type EvidenceJson } from "./investigation";

// The business page tells one story per claim: which agents looked at it, what each found, where in the
// video it found it, and which number on the page that finding moved. Only agents that produced a usable
// result are listed: a skipped, offline or unreadable seat did not form any metric, so it is left out.

export interface Moment { t: number; tEnd?: number; text: string; tone?: Tone; frame?: number; findingId?: number }
type Tone = "supports" | "contradicts" | "integrity" | "neutral";

export interface Contributor {
  key: string;
  name: string;
  sponsor: "CREAO" | "Factory Droid";
  /** What the agent is for, in one line. */
  role: string;
  prov: Prov;
  runUrl?: string;
  /** Its conclusion, in its own words where it gave some. */
  insight: string;
  details: ReactNode[];
  moments: Moment[];
  /** For agents that do not watch the footage: what they work from instead. */
  source?: string;
  /** The metric keys this agent's output feeds, with how. */
  feeds: { metric: string; how: string }[];
}

export interface Metric {
  key: string;
  label: string;
  value: string;
  tone: "honest" | "fraud" | "review" | "neutral";
  /** 0..1 when the metric is a proportion. */
  bar?: number;
  /** Contributor keys, or "check" for a deterministic check that is not an agent. */
  from: string[];
  note?: string;
  prov: Prov;
}

// Agent colours come from the site kit only, so the business page reads as the same product as the rest.
const PALETTE = ["var(--marigold)", "var(--credential)", "var(--honest)", "var(--ice)", "var(--neutral)", "color-mix(in srgb, var(--marigold) 55%, var(--ice))"];
const TONE_TEXT = { honest: "text-honest", fraud: "text-fraud", review: "text-review", neutral: "text-ink-dark" } as const;
const TONE_DOT: Record<Tone, string> = { supports: "var(--honest)", contradicts: "var(--fraud)", integrity: "var(--review)", neutral: "var(--neutral)" };
const provOf = (p: string | undefined): Prov => (p === "fixture" ? "fixture" : p === "replay" ? "replay" : "live");

export const hms = (t: number) => {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.max(0, t) - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

export const colorOf = (contributors: Contributor[], key: string) => {
  const i = contributors.findIndex((c) => c.key === key);
  return i < 0 ? "var(--neutral)" : PALETTE[i % PALETTE.length]!;
};

// ---- the CREAO seat path (claims the video reviewer does not own) ----

interface ListingJson {
  matched_listing?: { title?: string; seller?: string; price?: number | null; url?: string } | null;
  same_as_ordered?: string; confidence?: number; differences?: string[]; summary?: string; skipped?: boolean;
  eligibility?: { verdict?: string; reasons?: { text: string; cites: string }[] };
  scraped_listings?: { source?: string; fetched_at?: string; cached?: boolean; items?: unknown[] };
}
interface PolicyJson { outcome?: string; rules?: { rule: string; result: string; detail: string }[]; refund_shape?: { max_amount?: number; restocking_fee_pct?: number; store_credit_only?: boolean }; summary?: string; skipped?: boolean }
interface CardJson { caution?: string; indicators?: { name: string; value: unknown; reading: string; why: string }[]; innocent_explanation_considered?: string; summary?: string; skipped?: boolean }
interface InvJson { what_would_change_my_mind?: string; history_considered?: string; offline?: boolean }
interface Reason { text: string; cites: string }

/** The shopper's live Vouch score and the CREAO runs on this claim, for the score section. */
export interface ScoreContext { review?: ScoreReview; shopper?: { score: number; band: string }; runs: readonly AgentRun[]; identity?: IdentityScreening }

export function seatFlow({ claim, evidence, proposal, review, shopper, runs, identity }: { claim: Claim; evidence: readonly Evidence[]; proposal?: Decision } & ScoreContext) {
  const checks = parse<{ frame_times?: number[] }>(claim.checksJson, {});
  const timeOf = (frame: number) => checks.frame_times?.[frame];
  const row = (seat: string) => evidence.find((e) => e.seat === seat);
  const out: Contributor[] = [];
  const metrics: Metric[] = [];

  const ea = row("evidence_analyst");
  const ev = parse<EvidenceJson>(ea?.json, {});
  if (ea && ev.summary && !ev.unable_to_verify && !ev.offline && !ev.no_video) {
    const moments: Moment[] = (ev.frames ?? []).flatMap((f) => {
      const t = timeOf(f.index);
      return t === undefined || !f.observation ? [] : [{ t, frame: f.index, text: f.observation, tone: (ev.claimed_defect_visible?.frames ?? []).includes(f.index) ? "supports" as const : "neutral" as const }];
    });
    const visible = ev.claimed_defect_visible?.value;
    out.push({
      key: "evidence_analyst", name: "Evidence Analyst", sponsor: "CREAO", prov: provOf(ea.provenance), runUrl: ea.runUrl || undefined,
      role: "Watches the sampled frames and says what is visibly there: the item, the claimed problem, the finger challenge.",
      insight: ev.summary, moments,
      details: [
        ev.item_matches_reference ? <>Item matches the order: <b>{String(ev.item_matches_reference.value)}</b></> : null,
        visible !== undefined ? <>Claimed problem visible: <b>{String(visible)}</b></> : null,
        ev.defect_consistent_with_claim ? <>Consistent with the claim: <b>{String(ev.defect_consistent_with_claim.value)}</b>{ev.defect_consistent_with_claim.damage_type ? ` (${ev.defect_consistent_with_claim.damage_type})` : ""}</> : null,
        ev.challenge ? <>Finger challenge: <b>{ev.challenge.passed ? "passed" : "not passed"}</b></> : null,
      ].filter(Boolean),
      feeds: [{ metric: "footage", how: "its frame observations are the footage evidence" }, { metric: "feasibility", how: "the Refund Investigator cites its frames" }],
    });
    metrics.push({
      key: "footage", label: "Footage evidence", from: ["evidence_analyst"], prov: provOf(ea.provenance),
      value: visible === undefined ? "Reviewed" : String(visible) === "true" ? "Problem visible" : String(visible) === "false" ? "Problem not visible" : titleCase(String(visible)),
      tone: String(visible) === "true" ? "honest" : String(visible) === "false" ? "review" : "neutral",
      bar: ev.claimed_defect_visible?.confidence, note: `${moments.length} timestamped observation${moments.length === 1 ? "" : "s"}`,
    });
  }

  const lmRow = row("listing_matcher");
  const lm = parse<ListingJson>(lmRow?.json, {});
  if (lmRow && !lm.skipped && (lm.summary || lm.eligibility?.verdict)) {
    const s = lm.scraped_listings;
    const live = s?.source === "bright_data_serp";
    out.push({
      key: "listing_matcher", name: "Listing Matcher", sponsor: "CREAO", prov: provOf(lmRow.provenance), runUrl: lmRow.runUrl || undefined,
      role: "Compares what the frames show with product listings to say whether it is the item that was ordered.",
      insight: lm.summary ?? titleCase(lm.eligibility?.verdict ?? ""), moments: [],
      source: s ? (live ? `${s.items?.length ?? 0} listings via Bright Data, fetched ${s.fetched_at}${s.cached ? " (cached)" : ""}` : `${s.items?.length ?? 0} fixture listings built from the catalogue`) : "The order and product listings",
      details: [
        lm.matched_listing?.title ? <>Closest listing: <b>{lm.matched_listing.title}</b>{lm.matched_listing.price != null ? ` at ${money(Math.round(Number(lm.matched_listing.price) * 100))}` : ""}</> : null,
        lm.differences?.length ? <>Differences: {lm.differences.join("; ")}</> : null,
        ...(lm.eligibility?.reasons ?? []).map((r) => <>{r.text} <span className="font-mono text-ink-soft-dark">[{r.cites}]</span></>),
      ].filter(Boolean),
      feeds: [{ metric: "item", how: "decides whether the item matches the order" }],
    });
    metrics.push({
      key: "item", label: "Item matches order", from: ["listing_matcher"], prov: provOf(lmRow.provenance),
      value: lm.same_as_ordered ? titleCase(lm.same_as_ordered) : titleCase(lm.eligibility?.verdict ?? "–"),
      tone: lm.same_as_ordered === "yes" ? "honest" : lm.same_as_ordered === "no" ? "fraud" : "review", bar: lm.confidence,
    });
  }

  const pcRow = row("policy_checker");
  const pc = parse<PolicyJson>(pcRow?.json, {});
  if (pcRow && !pc.skipped && pc.outcome) {
    const mark = (r: string) => (r === "pass" ? "✓" : r === "fail" ? "✕" : r === "unclear" ? "?" : "–");
    out.push({
      key: "policy_checker", name: "Policy Checker", sponsor: "CREAO", prov: provOf(pcRow.provenance), runUrl: pcRow.runUrl || undefined,
      role: "Checks the claim rule by rule against the store's return policy: window, reason, video, fees.",
      insight: pc.summary ?? titleCase(pc.outcome), moments: [], source: "The store's return policy and the order dates",
      details: (pc.rules ?? []).filter((r) => r.result !== "not_applicable").map((r) => <><span className="font-mono">{mark(r.result)}</span> {titleCase(r.rule)}: {r.detail}</>),
      feeds: [{ metric: "eligibility", how: "sets whether the return is allowed and its maximum amount" }],
    });
    metrics.push({
      key: "eligibility", label: "Return eligibility", from: ["policy_checker"], prov: provOf(pcRow.provenance),
      value: titleCase(pc.outcome), tone: pc.outcome === "eligible" ? "honest" : pc.outcome === "not_eligible" ? "fraud" : "review",
      note: pc.refund_shape?.max_amount ? `up to ${money(Math.round(Number(pc.refund_shape.max_amount) * 100))}${pc.refund_shape.store_credit_only ? ", store credit" : ""}` : undefined,
    });
  }

  const rsRow = row("risk_scorecard");
  const rs = parse<CardJson>(rsRow?.json, {});
  if (rsRow && !rs.skipped && rs.caution) {
    out.push({
      key: "risk_scorecard", name: "Risk Scorecard", sponsor: "CREAO", prov: provOf(rsRow.provenance), runUrl: rsRow.runUrl || undefined,
      role: "Reads the shopper's purchase and refund history as context. It never declines on its own.",
      insight: rs.summary ?? `Caution ${rs.caution}`, moments: [], source: "The shopper's purchase and refund history",
      details: [
        ...(rs.indicators ?? []).map((i) => <>{i.reading === "supports" ? "▲" : i.reading === "caution" ? "▼" : "•"} {titleCase(i.name)} <span className="font-mono text-ink-soft-dark">{String(i.value)}</span> · {i.why}</>),
        rs.innocent_explanation_considered ? <><b>Innocent explanation considered:</b> {rs.innocent_explanation_considered}</> : null,
      ].filter(Boolean),
      feeds: [{ metric: "caution", how: "weighs history as context for the recommendation" }],
    });
    metrics.push({
      key: "caution", label: "History caution", from: ["risk_scorecard"], prov: provOf(rsRow.provenance),
      value: titleCase(rs.caution), tone: rs.caution === "low" ? "honest" : rs.caution === "high" ? "fraud" : "review", note: "context, never a reason to decline",
    });
  }

  const ri = row("refund_investigator");
  const inv = parse<InvJson>(ri?.json, {});
  if (ri && proposal && !inv.offline && claim.status !== "offline") {
    const reasons = parse<Reason[]>(proposal.reasonsJson, []);
    const moments: Moment[] = reasons.flatMap((r) => {
      const m = r.cites.match(/^frame:(\d+)/);
      const t = m ? timeOf(Number(m[1])) : undefined;
      return t === undefined ? [] : [{ t, frame: Number(m![1]), text: r.text, tone: "neutral" as const }];
    });
    const used = out.map((c) => c.name);
    out.push({
      key: "refund_investigator", name: "Refund Investigator", sponsor: "CREAO", prov: provOf(ri.provenance), runUrl: proposal.runUrl || ri.runUrl || undefined,
      role: "Weighs every agent's result above and proposes accept, decline or more evidence, citing each reason.",
      insight: `${titleCase(proposal.action)}${proposal.action === "accept" ? ` ${money(proposal.amount)}` : ""}`, moments,
      source: used.length ? `The results of the ${used.join(", ")}` : undefined,
      details: [
        ...reasons.map((r) => <>{r.text} <span className="font-mono text-ink-soft-dark">[{r.cites}]</span></>),
        inv.what_would_change_my_mind ? <><b>What would change its mind:</b> {inv.what_would_change_my_mind}</> : null,
      ].filter(Boolean),
      feeds: [{ metric: "feasibility", how: "its proposal and confidence are the feasibility score" }],
    });
    metrics.unshift({
      key: "feasibility", label: "Return feasibility", from: ["refund_investigator", ...out.filter((c) => c.key !== "refund_investigator").map((c) => c.key)],
      prov: provOf(ri.provenance), value: `${titleCase(proposal.action)}${proposal.action === "accept" ? ` ${money(proposal.amount)}` : ""}`,
      tone: proposal.action === "accept" ? "honest" : proposal.action === "decline" ? "fraud" : "review", bar: proposal.confidence, note: `confidence ${pct(proposal.confidence)}`,
    });
  }

  identityMetric(identity, metrics);
  scoreContributor({ review, shopper, runs, identity }, null, out, metrics);
  return { contributors: out, metrics };
}

// ---- the video reviewer path ----

export function reportFlow(report: Report, { review, shopper, runs, identity }: ScoreContext) {
  const out: Contributor[] = [];
  const metrics: Metric[] = [];
  const S = report.score;
  const C = S.components;
  const sign = (v: number | undefined) => (v === undefined ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
  const droid = report.method.droidSessions.filter((s) => s.mode === "live" || s.mode === "replay");
  const audited = report.findings.filter((f) => f.auditStatus === "passed");
  const A = report.factoryAssessment;

  if (droid.length && audited.length) {
    out.push({
      key: "droid", name: droid.map((s) => s.name).join(" · ") || "Case Analyst", sponsor: "Factory Droid", prov: droid.some((s) => s.mode === "live") ? "live" : "replay",
      role: "Investigates the footage itself: checks each thing the customer said against what the video shows, and cites the exact seconds.",
      insight: A && A.status === "validated" ? A.rationale : `${audited.length} audited finding${audited.length === 1 ? "" : "s"} on the footage.`,
      moments: audited.map((f) => ({ t: f.tStart, tEnd: f.tEnd, text: f.observation, tone: f.kind as Tone, findingId: f.id })),
      details: [],
      feeds: [
        { metric: "evidence", how: `its findings set evidence support (${sign(C.evidence)} to the score)` },
        { metric: "coverage", how: `covering the customer's statements adds ${sign(C.coverage)}` },
      ],
    });
  }

  const cr = report.creaoReview;
  if (cr && cr.provenance !== "offline") {
    out.push({
      key: "refund_reviewer", name: "Refund Reviewer", sponsor: "CREAO", prov: provOf(cr.provenance),
      role: "Reads the finished report and agrees or disagrees with its tier. Only agreement unlocks an automatic pay-out.",
      insight: cr.businessSummary, moments: [], source: "The finished report: findings, score and tier",
      details: cr.concerns.map((c) => <>Concern: {c}</>),
      feeds: [{ metric: "review", how: cr.agrees ? "agreed, so the tier stands" : "disagreed, so a person decides" }],
    });
    metrics.push({ key: "review", label: "Reviewer check", from: ["refund_reviewer"], prov: provOf(cr.provenance), value: cr.agrees ? "Agrees" : "Disagrees", tone: cr.agrees ? "honest" : "review", note: cr.agrees ? "tier confirmed" : "a person decides" });
  }

  const evidenceFrom = out.some((c) => c.key === "droid") ? ["droid"] : ["check"];
  metrics.unshift(
    { key: "feasibility", label: "Return feasibility", from: [...evidenceFrom, "check"], prov: "live", value: `${Math.round(S.pLegit * 100)}%`, tone: S.pLegit >= 0.7 ? "honest" : S.pLegit >= 0.4 ? "review" : "fraud", bar: S.pLegit, note: `${TIER_LABEL[report.recommendation.tier] ?? report.recommendation.tier} · P(legit), formula ${report.formulaVersion}` },
    { key: "evidence", label: "Evidence support", from: evidenceFrom, prov: "live", value: pct(S.eSupport), tone: "neutral", bar: S.eSupport, note: `${sign(C.evidence)} to the score` },
    { key: "coverage", label: "Statements covered", from: evidenceFrom, prov: "live", value: pct(S.coverage), tone: "neutral", bar: S.coverage, note: `${sign(C.coverage)} to the score` },
    { key: "integrity", label: "Video integrity", from: ["check"], prov: "live", value: pct(S.integrity), tone: S.integrity >= 0.8 ? "honest" : "review", bar: S.integrity, note: `${sign(C.integrity)} · consistent, not proof of authenticity` },
    { key: "history", label: "Shopper history", from: ["check"], prov: "live", value: sign(C.history), tone: (C.history ?? 0) < 0 ? "review" : "neutral", note: `${report.history.refunds365} refunds in 365 days` },
  );

  identityMetric(identity, metrics);
  scoreContributor({ review, shopper, runs, identity }, report, out, metrics);
  return { contributors: out, metrics };
}

/** score_review.decision: "accepted"/"declined" after a person decided, "creao_accept"/"creao_decline" for the CREAO verdict before one. */
const verdictText = (d: string) => (d.startsWith("creao_") ? `CREAO ${d.slice("creao_".length)} verdict` : d === "accepted" ? "accept decision" : d === "declined" ? "decline decision" : titleCase(d));

const ROUTE_TEXT: Record<string, string> = {
  refund_investigator: "Clear: no identity check needed",
  merchant_identity_review: "Merchant identity review",
  additional_verification: "More verification needed",
};

/**
 * CRS identity and contact-risk screening (docs/CRS.md). It routes the identity question to a person and never
 * approves or declines, so it is never shown in the fraud colour. Not an agent: its "from" names the CRS sandbox.
 */
function identityMetric(row: IdentityScreening | undefined, metrics: Metric[]) {
  if (!row || row.failed) return;
  const score = row.contactRiskScore < 0 ? "unavailable" : `${row.contactRiskScore}/100`;
  metrics.push({
    key: "identity", label: "Identity screening (CRS)", from: ["crs"], prov: row.source === "sandbox" ? "live" : "fixture",
    value: ROUTE_TEXT[row.route] ?? titleCase(row.route), tone: row.route === "refund_investigator" ? "honest" : "review",
    bar: row.contactRiskScore < 0 ? undefined : row.contactRiskScore / 100,
    note: `contact risk ${score} · identity ${titleCase(row.identityStatus)}${row.messageCodes.length ? ` · codes ${row.messageCodes.join(", ")}` : ""} · sandbox persona ${row.personaId}`,
  });
}

const SCORE_SEAT: Record<string, string> = { score_reviewer: "Score Reviewer", refund_investigator: "Refund Investigator", risk_scorecard: "Risk Scorecard" };

/**
 * The shopper's Vouch score. The change is judged by CREAO after the verdict: the saved Score Reviewer
 * ("live"/"fixture") or, without it, a panel of the Refund Investigator and Risk Scorecard ("panel_*"),
 * each given the analysis below (worker/src/review/score-review.ts). Until then, and when only the fallback
 * rule answered, the score is shown without crediting an agent.
 */
function scoreContributor({ review, shopper, runs, identity }: ScoreContext, report: Report | null, out: Contributor[], metrics: Metric[]) {
  const panel = !!review?.provenance.startsWith("panel_");
  const mode = panel ? review!.provenance.slice("panel_".length) : review?.provenance;
  if (!review || (mode !== "live" && mode !== "fixture")) {
    if (review) metrics.push({ key: "vouch", label: "Shopper Vouch score", from: [], prov: "live", value: `${review.before} → ${review.after}`, tone: review.delta > 0 ? "honest" : review.delta < 0 ? "fraud" : "neutral", note: "set by the fallback rule: no CREAO agent answered" });
    else if (shopper) metrics.push({ key: "vouch", label: "Shopper Vouch score", from: [], prov: "live", value: String(shopper.score), tone: "neutral", note: `${shopper.band} band now · CREAO agents judge the change once the verdict is in` });
    return;
  }
  const ids = new Set(review.runId.split(",").filter(Boolean));
  const used = runs.filter((r) => ids.has(r.runId));
  // What the agents were given from the analysis, mirrored from the worker's ScoreInput, so the number reads as grounded in it.
  const A = report?.factoryAssessment;
  const flags = report?.integrity.flags.map((f) => f.kind) ?? [];
  const challenge = flags.includes("challenge_failed") ? "failed" : flags.includes("challenge_unclear") ? "unclear" : report ? "passed" : null;
  const contradicts = report?.findings.filter((f) => f.kind === "contradicts").length ?? 0;
  const given = [
    `the ${verdictText(review.decision)}`,
    A ? `Factory's ${A.action.replace("_", " ")} recommendation` : null,
    challenge ? `finger challenge ${challenge}` : null,
    report ? `${contradicts} contradicting finding${contradicts === 1 ? "" : "s"}` : null,
    // The Risk Scorecard in the panel reads the screening; one stored after the score was judged was not part of it.
    panel && identity && !identity.failed && identity.checkedAt.microsSinceUnixEpoch <= review.at.microsSinceUnixEpoch ? `CRS identity screening (${ROUTE_TEXT[identity.route]?.toLowerCase() ?? identity.route})` : null,
    `the shopper's history and a starting score of ${review.before}`,
  ].filter(Boolean);
  const sign = review.delta > 0 ? "+" : "";
  out.push({
    key: "score_reviewer", name: panel ? "Vouch score panel" : "Score Reviewer", sponsor: "CREAO", prov: provOf(mode),
    runUrl: used.find((r) => r.runUrl)?.runUrl || undefined,
    role: panel
      ? "The Refund Investigator and Risk Scorecard, run side by side once the claim has a verdict, judge how it should move the shopper's Vouch score. Code checks the answer and keeps it within fixed bounds."
      : "After the verdict, judges how this claim should move the shopper's Vouch score. Code checks the answer and keeps it within fixed bounds.",
    insight: `${review.before} → ${review.after} (${sign}${review.delta}). ${review.reason}`,
    moments: (report?.findings ?? []).filter((f) => f.auditStatus === "passed").map((f) => ({ t: f.tStart, tEnd: f.tEnd, text: f.observation, tone: f.kind as Tone, findingId: f.id })),
    source: `Given ${given.join(", ")}`,
    details: used.map((r) => <>{SCORE_SEAT[r.seat] ?? titleCase(r.seat)} · {r.status} · {r.mode}{r.runUrl ? <> · <a className="text-accent underline" href={r.runUrl} target="_blank" rel="noreferrer">run</a></> : <span className="font-mono text-ink-soft-dark"> · {r.runId.slice(0, 14)}</span>}</>),
    feeds: [{ metric: "vouch", how: `moved it ${sign}${review.delta}` }],
  });
  metrics.push({ key: "vouch", label: "Shopper Vouch score", from: ["score_reviewer"], prov: provOf(mode), value: `${review.before} → ${review.after}`, tone: review.delta > 0 ? "honest" : review.delta < 0 ? "fraud" : "neutral", note: `${sign}${review.delta} after the ${verdictText(review.decision)}` });
}

// ---- views ----

const SOURCE_LABEL: Record<string, string> = { check: "Automated check", crs: "CRS sandbox" };

function AgentChip({ c, k, contributors, onClick }: { c?: Contributor; k: string; contributors: Contributor[]; onClick?: () => void }) {
  if (!c) return <span className="chip text-[0.65rem]">{SOURCE_LABEL[k] ?? titleCase(k)}</span>;
  return (
    <button type="button" onClick={onClick} className="chip text-[0.65rem] hover:border-accent/60" title={`Jump to the ${c.name}`}>
      <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(contributors, c.key) }} />{c.name}
    </button>
  );
}

const focusAgent = (key: string) => document.getElementById(`agent-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

/** Every number, with the agents whose research produced it and the video moments it rests on. */
export function MetricGrid({ metrics, contributors, onMoment }: { metrics: Metric[]; contributors: Contributor[]; onMoment?: (m: Moment) => void }) {
  if (!metrics.length) return null;
  const byKey = new Map(contributors.map((c) => [c.key, c]));
  return (
    <section className="glass space-y-3 p-4" data-testid="metric-grid">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">How the outcome was scored</span>
        <span className="text-xs text-ink-soft-dark">each number names the agents behind it</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((m) => {
          const from = [...new Set(m.from)];
          const moments = from.flatMap((k) => byKey.get(k)?.moments ?? []).sort((a, b) => a.t - b.t).slice(0, 4);
          return (
            <div key={m.key} className={`min-w-0 rounded-lg border p-3 ${m.key === "feasibility" ? "border-accent/50 bg-accent/5 sm:col-span-2 xl:col-span-1" : "border-line-dark"}`} data-testid={`metric-${m.key}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-ink-soft-dark">{m.label}</span><Badge kind={m.prov} /></div>
              <div className={`mt-1 font-display text-2xl font-semibold leading-tight tracking-[-0.02em] tabular-nums ${TONE_TEXT[m.tone]}`}>{m.value}</div>
              {m.bar !== undefined ? <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(Math.min(1, Math.max(0, m.bar)) * 100)}%` }} /></div> : null}
              {m.note ? <div className="mt-1 text-[0.7rem] text-ink-soft-dark">{m.note}</div> : null}
              {from.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-soft-dark">from</span>
                  {from.map((k) => <AgentChip key={k} k={k} c={byKey.get(k)} contributors={contributors} onClick={() => focusAgent(k)} />)}
                </div>
              ) : null}
              {onMoment && moments.length ? (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.65rem]">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-soft-dark">grounded at</span>
                  {moments.map((x, i) => <button key={i} type="button" className="font-mono text-accent underline" onClick={() => onMoment(x)} title={x.text}>{hms(x.t)}</button>)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** One lane per agent that cited the footage, so each mark on the video says who found it. */
export function AgentLanes({ contributors, duration, onMoment, extra }: { contributors: Contributor[]; duration: number; onMoment: (m: Moment) => void; extra?: { label: string; moments: Moment[] } }) {
  const lanes = [...(extra?.moments.length ? [{ key: "_extra", name: extra.label, moments: extra.moments, color: "color-mix(in srgb, var(--ice) 55%, transparent)" }] : []),
    ...contributors.filter((c) => c.moments.length).map((c) => ({ key: c.key, name: c.name, moments: c.moments, color: colorOf(contributors, c.key) }))];
  if (!lanes.length || duration <= 0) return null;
  const pos = (t: number) => Math.min(98, Math.max(2, (t / duration) * 100));
  return (
    <div className="space-y-1.5" data-testid="agent-lanes">
      {lanes.map((l) => (
        <div key={l.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="truncate font-mono text-[0.62rem] uppercase tracking-[0.06em] text-ink-soft-dark" title={l.name}>
            <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />{l.name}
          </span>
          <div className="relative h-4 rounded-full bg-white/10">
            {l.moments.map((m, i) => (
              <button key={i} type="button" title={`${hms(m.t)} · ${m.text}`} aria-label={`${l.name} at ${hms(m.t)}`} onClick={() => onMoment(m)}
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 hover:scale-125"
                style={{ left: `${pos(m.t)}%`, background: m.tone && m.tone !== "neutral" ? TONE_DOT[m.tone] : l.color }} />
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 font-mono text-[0.65rem] text-ink-soft-dark"><span /><div className="flex justify-between"><span>{hms(0)}</span><span>{hms(duration)}</span></div></div>
    </div>
  );
}

/**
 * A video that removes itself when there is nothing to play or it fails to load, so the page never shows a
 * broken player. `onReady` reports whether timestamps can seek.
 */
export function SafeVideo({ src, videoRef, onReady, className, ...rest }: { src?: string; videoRef: RefObject<HTMLVideoElement | null>; onReady: (ok: boolean) => void; className?: string } & Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "ref">) {
  // Remembering which link failed means a new link gets a fresh try without an effect.
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src) return null;
  return (
    <video ref={videoRef} src={src} playsInline preload="metadata" className={className} {...rest}
      onLoadedMetadata={(e) => { onReady(true); rest.onLoadedMetadata?.(e); }}
      onError={() => { setFailedSrc(src); onReady(false); }} />
  );
}

/** The agents in the order they worked, each with what it is, what it found, where in the video, and what it moved. */
export function AgentCards({ contributors, metrics, onMoment }: { contributors: Contributor[]; metrics: Metric[]; onMoment?: (m: Moment) => void }) {
  if (!contributors.length) return null;
  const label = new Map(metrics.map((m) => [m.key, m.label]));
  return (
    <section className="space-y-2" data-testid="agent-cards">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">Agents on this claim ({contributors.length})</span>
        <span className="text-xs text-ink-soft-dark">in the order they worked</span>
      </div>
      <ol className="space-y-2">
        {contributors.map((c, i) => (
          <li key={c.key} id={`agent-${c.key}`} className="glass min-w-0 space-y-2 p-3 text-sm" style={{ borderLeft: `3px solid ${colorOf(contributors, c.key)}` }} data-testid={`agent-${c.key}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-soft-dark">{i + 1}</span>
              <span className="font-display text-lg font-semibold tracking-[-0.01em]">{c.name}</span>
              <span className={`chip text-[0.65rem] ${c.sponsor === "CREAO" ? "chip--accent" : "chip--credential"}`}>{c.sponsor}</span>
              <Badge kind={c.prov} />
              {c.runUrl ? <a className="ml-auto text-xs text-accent underline" href={c.runUrl} target="_blank" rel="noreferrer">run</a> : null}
            </div>
            <p className="text-xs text-ink-soft-dark">{c.role}</p>
            <p className="leading-relaxed">{c.insight}</p>
            {c.moments.length ? (
              <ul className="space-y-1" data-testid={`agent-${c.key}-moments`}>
                {c.moments.map((m, k) => (
                  <li key={k} className="flex items-start gap-2">
                    {onMoment ? <button type="button" className="shrink-0 font-mono text-xs text-accent underline" onClick={() => onMoment(m)}>{hms(m.t)}{m.tEnd !== undefined && m.tEnd > m.t ? `–${hms(m.tEnd)}` : ""}</button>
                      : <span className="shrink-0 font-mono text-xs text-ink-soft-dark">{hms(m.t)}</span>}
                    {m.tone && m.tone !== "neutral" ? <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_DOT[m.tone] }} title={m.tone} /> : null}
                    <span className="min-w-0 text-xs">{m.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {c.source ? <p className="text-xs text-ink-soft-dark"><span className="font-mono text-[0.6rem] uppercase tracking-[0.08em]">Works from</span> {c.source}</p> : null}
            {c.details.length ? (
              <details>
                <summary className="cursor-pointer text-xs text-ink-soft-dark">Its full reasoning ({c.details.length})</summary>
                <ul className="mt-1 space-y-0.5 text-xs">{c.details.map((d, k) => <li key={k}>{d}</li>)}</ul>
              </details>
            ) : null}
            <div className="flex flex-wrap items-center gap-1 border-t border-line-dark pt-2 text-xs">
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-soft-dark">Feeds</span>
              {c.feeds.filter((f) => label.has(f.metric)).map((f) => (
                <span key={f.metric}><button type="button" className="chip text-[0.65rem] hover:border-accent/60" onClick={() => document.querySelector(`[data-testid="metric-${f.metric}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{label.get(f.metric)}</button> <span className="text-ink-soft-dark">{f.how}</span></span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {contributors.some((c) => c.key === "evidence_analyst" || c.key === "droid") ? <p className="text-[0.7rem] text-ink-soft-dark">Footage checks are internally consistent, not proof of authenticity.</p> : null}
    </section>
  );
}
