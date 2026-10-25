// Fixture mode (CREAO_MODE=fixture): a canned response per seat, chosen by
// the hard rules each agent's prompt states (offline or unable to verify →
// more evidence, frame reuse or a failed challenge → never accept). This is
// recorded-style test data, labelled Fixture everywhere it shows; it is not
// a stand-in model. Recorded files (<seat>.recorded.<name>.json) win.
import { scoreRule, type ScoreInput } from './review/score-rule';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Seat } from './env';
import { REPO_ROOT } from './env';

const DIR = resolve(REPO_ROOT, 'worker/fixtures');

function load(seat: Seat, name: string): unknown {
  const recorded = resolve(DIR, `${seat}.recorded.${name}.json`);
  const file = existsSync(recorded) ? recorded : resolve(DIR, `${seat}.${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Replaces "{{key}}" strings with typed values and {{key}} inside text with their string form. */
export function fill(v: unknown, vars: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const whole = v.match(/^\{\{(\w+)\}\}$/);
    if (whole && whole[1]! in vars) return vars[whole[1]!];
    return v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{{${k}}}`));
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_fixture').map(([k, x]) => [k, fill(x, vars)]));
  return v;
}

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Obj)[k] : undefined), o);

export function fixtureResponse(seat: Seat, c: unknown): unknown {
  if (seat === 'evidence_analyst') {
    const frames = (get(c, 'frames') as unknown[] | undefined) ?? [];
    const blank = Number(get(c, 'deterministic_checks.blank_frames') ?? 0);
    const vars = { claim_id: get(c, 'claim_id'), fingers: get(c, 'challenge.fingers') ?? 0 };
    const r = fill(load(seat, frames.length >= 4 && blank * 2 < frames.length ? 'consistent' : 'unable'), vars) as Obj;
    if (get(c, 'deterministic_checks.still_image') === true) r.capture_flags = [...((r.capture_flags as string[] | undefined) ?? []), 'possible_still_image'];
    return r;
  }
  if (seat === 'refund_investigator') {
    const evidence = get(c, 'evidence') as Obj | undefined;
    const reuse = (get(c, 'deterministic_checks.frame_reuse') as unknown[] | undefined) ?? [];
    const challengeFailed = get(c, 'evidence.challenge.passed') === false;
    const recapture = ((get(c, 'evidence.capture_flags') as string[] | undefined) ?? []).includes('possible_screen_recapture');
    const amount = Number(get(c, 'amount_requested') ?? 0);
    let reason = '';
    let cites = '';
    if (!evidence || evidence.offline) { reason = 'The evidence review is offline, so the claim cannot be settled yet.'; cites = 'check:offline'; }
    else if (evidence.unable_to_verify || evidence.no_video) { reason = 'The frames are not clear enough to verify the claim.'; cites = 'check:unable_to_verify'; }
    else if (reuse.length) { reason = 'Frames match frames from another claim.'; cites = 'check:frame_reuse'; }
    else if (challengeFailed) { reason = 'The finger challenge at the end of the video was not passed.'; cites = 'check:challenge'; }
    else if (recapture) { reason = 'The video looks like a recording of a screen.'; cites = 'check:capture'; }
    else if (get(c, 'deterministic_checks.still_image') === true) { reason = 'The video barely changes from frame to frame, as a photo or a slideshow would; a short handheld clip of the item would settle it.'; cites = 'check:still_image'; }
    else if (get(c, 'deterministic_checks.within_window') === false) { reason = 'The claim was filed outside the return window.'; cites = 'policy:window'; }
    if (reason) return fill(load(seat, 'more_evidence'), { claim_id: get(c, 'claim_id'), reason, cites });
    const accept = fill(load(seat, 'accept'), { claim_id: get(c, 'claim_id'), amount, needs_controller: amount > Number(get(c, 'controller_threshold') ?? 500) }) as Obj;
    // A recorded run may carry no reasons at all; the rule-driven ones below still state the real numbers.
    const reasons: Obj[] = Array.isArray(accept.reasons) ? (accept.reasons as Obj[]) : [];
    // The history reason states this shopper's real numbers (QA-004). A high refund ratio is context,
    // not proof: it lowers confidence so a person looks closer, and never turns into a decline.
    const asked = Number(get(c, 'history.refunds_requested_90d') ?? NaN);
    const ratio = Number(get(c, 'history.refund_ratio_90d') ?? NaN);
    if (Number.isFinite(asked) && Number.isFinite(ratio)) {
      const bought = ratio > 0 ? Math.round(asked / ratio) : Number(get(c, 'history.purchases_completed') ?? 0);
      const high = ratio >= 0.4 && asked >= 3;
      const text = `Refunds were requested on ${asked} of the last ${bought} purchases (${Math.round(ratio * 100)}% in 90 days)${high
        ? ', well above typical shoppers; weighed as context, not proof, so the video evidence decides and a person should look closely.'
        : ', in line with typical shoppers.'}`;
      const at = reasons.findIndex((r) => r.cites === 'history:refund_ratio_90d');
      if (at >= 0) reasons[at] = { ...reasons[at], text };
      else reasons.push({ text, cites: 'history:refund_ratio_90d' });
      if (high) accept.confidence = 0.55;
    }
    // The prompt weighs a verified credential from another store as context, and every reason cites its source.
    const issuer = get(c, 'credential.issuer');
    if (get(c, 'credential.verified') === true && issuer) {
      const band = get(c, 'credential.claims.refund_ratio_band');
      const text = `A credential from ${String(issuer)} verified in all five steps${band ? ` and shows a ${String(band)} refund ratio there` : ''}.`;
      reasons.push({ text, cites: `credential:${String(issuer)}` });
    }
    // CRS identity step-up (docs/CRS.md): cited as context. It can lower confidence so a person checks
    // identity, but it never changes the action: identity is a separate question from the item.
    const idn = get(c, 'identity') as Obj | undefined;
    if (idn?.status === 'screened') {
      const route = String(idn.route);
      const risk = idn.contact_risk_score ?? 'unavailable';
      const text = route === 'refund_investigator'
        ? `CRS identity screening matched: TruValidate returned no discrepancies and Fraud Finder contact risk is ${String(risk)} (${String(idn.contact_risk_band)}).`
        : route === 'merchant_identity_review'
          ? `CRS identity screening returned ${(idn.message_codes as string[] | undefined)?.length ? `codes ${(idn.message_codes as string[]).join(', ')}` : `contact risk ${String(risk)}`}; a person checks identity separately, and this does not change the item decision.`
          : 'CRS asked for step-up identity proof (a fraud alert may be one the shopper placed themselves); a person handles it, and this does not change the item decision.';
      reasons.push({ text, cites: 'identity:crs' });
      if (route !== 'refund_investigator') accept.confidence = Math.min(Number(accept.confidence ?? 0.78), route === 'merchant_identity_review' ? 0.6 : 0.55);
    }
    accept.reasons = reasons;
    return accept;
  }
  if (seat === 'listing_matcher') return listingFixture(c);
  if (seat === 'policy_checker') return policyFixture(c);
  if (seat === 'risk_scorecard') return scorecardFixture(c);
  if (seat === 'score_reviewer') return scoreRule(c as unknown as ScoreInput);
  if (seat === 'returns_monitor') return monitorFixture(c);
  if (seat === 'refund_reviewer') return reviewerFixture(c);
  if (seat === 'customer_liaison') return liaisonFixture(c);
  const pattern = get(c, 'pattern') as Obj;
  const agents = ((get(c, 'agents') as Obj[] | undefined) ?? []).map((a) => String(a.id));
  const features = (pattern?.features ?? {}) as Obj;
  const coordinated = pattern?.kind === 'coordinated';
  const roles = agents.map((id) => ({ id, role: coordinated ? 'core' : 'peripheral', why: coordinated ? 'Claim text and timing match the group.' : 'Flagged on its own history only.', cites: [] }));
  return fill(load(seat, coordinated ? 'confirm' : 'needs_review'), {
    pattern_id: pattern?.id, agent_count: agents.length, hours: features.claim_window_hours ?? '?', businesses: features.businesses ?? '?', roles,
  });
}

// ---- the video reviewer's seats. The case is the business report (module/src/review-types.ts) plus the tier.

const money = (cents: unknown) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`;

/** The Reviewer agrees unless the report itself says a person should look: reuse, a failed challenge, or an automatic pay-out built on automated checks alone. */
function reviewerFixture(c: unknown): unknown {
  const tier = String(get(c, 'recommendation.tier') ?? 'T4');
  const flags = ((get(c, 'integrity.flags') as { kind: string; confidence: number }[] | undefined) ?? []);
  const lanesOnly = get(c, 'method.lanesOnly') === true;
  const findings = ((get(c, 'findings') as { kind: string }[] | undefined) ?? []);
  const supports = findings.filter((f) => f.kind === 'supports').length;
  const contradicts = findings.filter((f) => f.kind === 'contradicts').length;
  const pLegit = Number(get(c, 'score.pLegit') ?? 0);
  const now = money(get(c, 'recommendation.refundNow'));
  const later = money(get(c, 'recommendation.refundOnReturn'));
  const vars: Record<string, unknown> = { claim_id: get(c, 'claimId'), customer_message: '' };
  let concern = '';
  let suggested = '';
  if (flags.some((f) => f.kind === 'frame_reuse' && f.confidence >= 0.8)) { concern = 'Frames match another claim; nothing should be paid until a person has compared the two videos.'; suggested = 'T5'; }
  else if (flags.some((f) => f.kind === 'challenge_failed')) { concern = 'The finger challenge at the end of the video was not passed, so the recording may not be fresh.'; suggested = 'T4'; }
  else if (lanesOnly && (tier === 'T1' || tier === 'T2')) { concern = 'Droid did not run, so no claim was checked against the footage; automated checks alone should not pay out.'; suggested = 'T3'; }
  else if (contradicts > 0 && tier === 'T1') { concern = 'One finding contradicts what was said; a full instant refund is too generous.'; suggested = 'T2'; }
  const summary = concern
    ? `The report proposes ${tier} (${now} now, ${later} on return) with P(legit) ${Math.round(pLegit * 100)}%. ${supports} finding(s) support and ${contradicts} contradict the spoken claims. I disagree: ${concern}`
    : `The report proposes ${tier} (${now} now, ${later} on return) with P(legit) ${Math.round(pLegit * 100)}%. ${supports} finding(s) support and ${contradicts} contradict the spoken claims; every finding cites a clip or a measurement, so the tier follows from the evidence.`;
  const customer = tier === 'T1' ? `Thanks for the video. Your refund of ${now} is approved and on its way to your original payment method.`
    : tier === 'T2' ? `Thanks for the video. ${now} is refunded now; the remaining ${later} follows when the return is scanned.`
      : tier === 'T3' ? `Thanks for the video. Your refund of ${later} is paid as soon as the return is scanned; a prepaid label is on its way.`
        : tier === 'T4' ? 'Thanks for the video. A short extra clip would settle this: please record the item and the problem in one continuous take.'
          : 'Thanks for the video. A member of the team is reviewing your claim and will be in touch.';
  return fill(load('refund_reviewer', concern ? 'disagree' : 'agree'), { ...vars, summary, concern, suggested_tier: suggested, customer_message: customer });
}

function liaisonFixture(c: unknown): unknown {
  const tier = String(get(c, 'recommendation.tier') ?? 'T4');
  const asks = (get(c, 'recommendation.evidenceRequested') as string[] | undefined) ?? [];
  const now = money(get(c, 'recommendation.refundNow'));
  const later = money(get(c, 'recommendation.refundOnReturn'));
  const byTier: Record<string, [string, string, string]> = {
    T1: ['Refund approved', `Your video showed what you described, so ${now} is refunded to your original payment method.`, 'Nothing else to do.'],
    T2: ['Partial refund now', `${now} is refunded now and ${later} follows when the return is scanned.`, 'Use the prepaid label in the app to send the item back.'],
    T3: ['Return to refund', `Your refund of ${later} is paid when the return is scanned.`, 'Use the prepaid label in the app to send the item back.'],
    T4: ['One more clip needed', 'The video did not show everything you described, so we need one more short clip before we can decide.', 'Record the item and the problem in one continuous take, 10 seconds is enough.'],
    T5: ['Under review', 'A member of the team is looking at your claim.', 'We will message you within one business day.'],
  };
  const [title, message, next] = byTier[tier] ?? byTier.T5!;
  return fill(load('customer_liaison', 'message'), { claim_id: get(c, 'claimId'), title, message, next_steps: next, evidence_request: asks.join(' ') });
}

// ---- the Listing Matcher: picks the scraped listing closest to the ordered item and checks eligibility against the policy.

function listingFixture(c: unknown): unknown {
  const claimId = get(c, 'claim_id');
  const withinWindow = get(c, 'deterministic_checks.within_window') !== false;
  const listings = (get(c, 'scraped_listings.items') as { title: string; seller: string; price: number | null; url: string }[] | undefined) ?? [];
  const ordered = String(get(c, 'order.item') ?? '');
  const frames = (get(c, 'evidence.frames') as unknown[] | undefined) ?? [];
  const unable = get(c, 'evidence.unable_to_verify') === true;
  const scrapeError = get(c, 'scraped_listings.error');
  const uncertain = (reason: string, cites: string) => fill(load('listing_matcher', 'uncertain'), { claim_id: claimId, within_window: withinWindow, reason, cites });
  if (unable || frames.length === 0) return uncertain('The frames are not clear enough to compare the item with a listing.', 'evidence:unable_to_verify');
  if (listings.length === 0) return uncertain(scrapeError ? `No listings could be scraped (${String(scrapeError).slice(0, 80)}).` : 'No listings were found for the ordered item.', 'listings:none');
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const at = listings.findIndex((l) => norm(l.title) === norm(ordered));
  const idx = at >= 0 ? at : 0;
  const hit = listings[idx]!;
  const same = at >= 0 ? 'true' : 'uncertain';
  const analystSays = String(get(c, 'evidence.item_matches_reference.value') ?? 'uncertain');
  const notes = String(get(c, 'policy.notes') ?? '');
  const condition = String(get(c, 'evidence.defect_consistent_with_claim.value') ?? 'cannot_tell');
  const reasons: Obj[] = [
    { text: `The ordered item "${ordered}" matches listing ${idx} ("${hit.title}" from ${hit.seller || 'an unnamed seller'}${hit.price != null ? ` at $${Number(hit.price).toFixed(2)}` : ''}).`, cites: `listing:${idx}` },
    { text: analystSays === 'true' ? 'The Evidence Analyst saw the ordered item in the frames.' : `The Evidence Analyst rated the item match "${analystSays}".`, cites: 'evidence:item_matches_reference' },
    { text: withinWindow ? 'The claim is inside the return window.' : 'The claim is outside the return window; the store can still make an exception.', cites: 'policy:window' },
  ];
  if (notes) reasons.push({ text: `Policy note considered: "${notes}".`, cites: 'policy:notes' });
  const verdict = !withinWindow ? 'needs_person' : same === 'true' && analystSays === 'true' && condition !== 'false' ? 'eligible' : 'needs_person';
  return fill(load('listing_matcher', 'match'), {
    claim_id: claimId, index: idx, title: hit.title, seller: hit.seller, price: hit.price, url: hit.url, same_as_ordered: same, confidence: same === 'true' ? 0.85 : 0.5,
    differences: same === 'true' ? [] : ['The closest listing title differs from the ordered item name.'], within_window: withinWindow,
    condition_consistent: condition === 'true' ? 'true' : condition === 'false' ? 'false' : 'cannot_tell', verdict, reasons,
    summary: verdict === 'eligible' ? `Listing ${idx} is the ordered item and the claim is inside the window: eligible for the return process. The video evidence still decides the refund.`
      : 'The listing match or the window needs a person to look; nothing is declined.',
  });
}

// ---- the Returns Monitor: describes the window it was given; a spike with one business and one item is first read as a possible defective batch.

function monitorFixture(c: unknown): unknown {
  const w = (get(c, 'window') as { returns?: number; per_second?: number; baseline_per_second?: number; seconds?: number }) ?? {};
  const items = (get(c, 'items') as { sku: string; name: string; count: number; per_second: number; baseline_per_second: number; spike: boolean; real_world?: { signals?: { url: string; title: string }[]; source?: string } | null }[] | undefined) ?? [];
  const businesses = (get(c, 'businesses') as { id: string; name: string; count: number }[] | undefined) ?? [];
  const spikes = items.filter((i) => i.spike);
  const top = items[0];
  const narrative = `${w.returns ?? 0} returns arrived in the last ${w.seconds ?? 60} s (${w.per_second ?? 0}/s against a baseline of ${w.baseline_per_second ?? 0}/s)` +
    (top ? `; the busiest item was ${top.name} (${top.sku}) with ${top.count}.` : '.') +
    (spikes.length ? ` ${spikes.length} item(s) are at or above the spike threshold: ${spikes.map((i) => `${i.name} at ${i.per_second}/s vs ${i.baseline_per_second}/s`).join('; ')}.` : ' No item is above its baseline enough to call a spike.') +
    (businesses[0] ? ` Most returns reached ${businesses[0].name} (${businesses[0].count}).` : '');
  const anomalies = spikes.map((i) => ({ sku: i.sku, kind: 'spike', why: `${i.count} returns of ${i.name} in ${w.seconds ?? 60} s, ${i.baseline_per_second ? Math.round(i.per_second / i.baseline_per_second) : 'many'}× its baseline.`, cites: [i.sku] }));
  const innocent = spikes.length
    ? 'A defective batch of one item sold by one store would look the same; the pattern detectors and the per-claim video evidence, not this count, decide whether anything is wrong.'
    : 'Return volume is within its baseline; no explanation is needed.';
  const real = items.filter((i) => i.real_world?.signals?.length).slice(0, 3).map((i) => ({
    sku: i.sku, summary: `${i.real_world!.signals!.length} web result(s) about returns of ${i.name}${i.real_world!.source === 'bright_data_serp' ? ' (Bright Data)' : ' (fixture)'}.`, urls: i.real_world!.signals!.map((s) => s.url),
  }));
  return fill(load('returns_monitor', 'note'), { narrative, anomalies, items_to_watch: spikes.map((i) => i.sku), innocent, real_world_context: real });
}

// ---- the Policy Checker: one line per rule, from the deterministic checks the worker sends. Only the window and the reason can make a claim not eligible.

function policyFixture(c: unknown): unknown {
  const checks = (get(c, 'checks') as Obj) ?? {};
  const policy = (get(c, 'policy') as Obj) ?? {};
  const amount = Number(get(c, 'claim.amount_requested') ?? 0);
  const fee = Number(policy.restocking_fee_pct ?? 0);
  const notes = String(policy.notes ?? '');
  const reason = String(get(c, 'claim.reason_code') ?? '');
  const lm = get(c, 'listing_match') as Obj | undefined;
  const r = (rule: string, result: string, detail: string, cites: string) => ({ rule, result, detail, cites });
  const rules = [
    r('window', checks.within_window === false ? 'fail' : 'pass', `Day ${checks.days_since_delivery ?? '?'} after delivery against a ${policy.window_days ?? '?'}-day window.`, 'policy:window'),
    r('reason', checks.reason_allowed === false ? 'fail' : 'pass', checks.reason_allowed === false ? `"${reason}" is not accepted under this policy.` : `"${reason}" is an accepted reason.`, 'policy:reason'),
    r('video_required', checks.over_video_threshold ? (checks.has_video ? 'pass' : 'fail') : 'not_applicable', checks.over_video_threshold ? (checks.has_video ? `A video is required over $${Number(policy.needs_video_over ?? 0).toFixed(0)} and one was provided.` : 'A video is required for this amount and none was provided.') : 'Below the amount that requires a video.', 'policy:video'),
    r('category_note', notes ? 'unclear' : 'not_applicable', notes ? `"${notes}": whether it applies depends on the damage type the evidence shows.` : 'The policy has no category note.', 'policy:notes'),
    r('restocking_fee', fee > 0 ? 'pass' : 'not_applicable', fee > 0 ? `A ${fee}% restocking fee applies to non-defective returns.` : 'No restocking fee.', 'policy:restocking_fee'),
    r('item_identity', !lm || lm.skipped ? 'unclear' : lm.same_as_ordered === 'true' ? 'pass' : lm.same_as_ordered === 'false' ? 'fail' : 'unclear', !lm || lm.skipped ? 'No listing match was run.' : `The Listing Matcher says same as ordered: ${String(lm.same_as_ordered)}.`, 'listing_match:same_as_ordered'),
  ];
  const failedHard = rules.some((x) => (x.rule === 'window' || x.rule === 'reason') && x.result === 'fail');
  const anyUnclear = rules.some((x) => x.result === 'unclear' || (x.rule === 'video_required' && x.result === 'fail') || (x.rule === 'item_identity' && x.result === 'fail'));
  const outcome = failedHard ? 'not_eligible' : anyUnclear ? (notes || (lm && !lm.skipped && lm.same_as_ordered !== 'true') ? 'needs_person' : 'conditional') : 'eligible';
  return fill(load('policy_checker', 'result'), {
    claim_id: get(c, 'claim_id'), outcome, rules,
    max_amount: Math.round(amount * (1 - (reason === 'changed_mind' ? fee : 0) / 100) * 100) / 100, restocking_fee_pct: reason === 'changed_mind' ? fee : 0,
    store_credit_only: policy.store_credit_allowed === true && reason === 'changed_mind',
    exception_note: failedHard ? 'The store can still make an exception; nothing is declined automatically.' : '',
    summary: outcome === 'eligible' ? 'Every policy rule passes: the return is eligible under the policy. Whether the refund is paid still depends on the evidence.'
      : outcome === 'conditional' ? 'The policy allows the return once the open rule is settled by the evidence.'
      : outcome === 'needs_person' ? 'A policy note or the item identity needs a person to read it against the evidence.'
      : 'The claim falls outside the policy (window or reason); the store can still make an exception.',
  });
}

// ---- the Risk Scorecard: reads each indicator as supports, neutral or caution. Context for the Investigator, never a decision.

function scorecardFixture(c: unknown): unknown {
  const h = (get(c, 'history') as Obj) ?? {};
  const cred = (get(c, 'credential') as Obj) ?? {};
  const patterns = (get(c, 'patterns') as Obj[] | undefined) ?? [];
  const idn = (get(c, 'identity') as Obj) ?? {};
  const item = (get(c, 'item_context') as Obj) ?? {};
  const pulse = item.pulse as Obj | null | undefined;
  const bc = (item.business_context as Obj) ?? {};
  const v = (get(c, 'video_checks') as Obj) ?? {};
  const ind: Obj[] = [];
  const add = (name: string, value: unknown, reading: string, weight: number, why: string, cites: string) => ind.push({ name, value, reading, weight, why, cites });
  const age = Number(h.account_age_days ?? 0); const ratio = Number(h.refund_ratio_90d ?? 0); const asked = Number(h.refunds_requested_90d ?? 0);
  add('account_age', age, age >= 90 ? 'supports' : age >= 30 ? 'neutral' : 'caution', age < 30 ? 0.3 : 0.2, age < 30 ? 'A thin history is a reason for care, never for a decline on its own.' : `${age} days of history.`, 'history:account_age_days');
  add('refund_ratio_90d', ratio, ratio <= 0.15 ? 'supports' : ratio < 0.4 || asked < 3 ? 'neutral' : 'caution', 0.35, `${asked} refund(s) requested in 90 days (${Math.round(ratio * 100)}%); weighed as context, not proof.`, 'history:refund_ratio_90d');
  add('refunds_declined', h.refunds_declined_total ?? 0, Number(h.refunds_declined_total ?? 0) > 0 ? 'caution' : 'neutral', 0.2, 'Past declines are context; each claim is judged on its own evidence.', 'history:refunds_declined_total');
  add('score_band', h.band ?? 'neutral', h.band === 'green' ? 'supports' : h.band === 'red' ? 'caution' : 'neutral', 0.15, 'The illustrative shopping score band.', 'history:band');
  add('credential', cred.verified === true ? `verified by ${String(cred.issuer)}` : cred.presented ? 'presented, failed' : 'none', cred.verified === true ? 'supports' : cred.presented ? 'caution' : 'neutral', 0.3, cred.verified === true ? 'A credential from another store verified in all five steps.' : cred.presented ? `A presented credential failed step ${String(cred.failed_step)}.` : 'No credential was presented; that is normal.', cred.issuer ? `credential:${String(cred.issuer)}` : 'credential:none');
  const confirmed = patterns.filter((p) => p.status === 'confirmed'); const detected = patterns.filter((p) => p.status === 'detected');
  add('confirmed_pattern', confirmed.length, confirmed.length ? 'caution' : 'neutral', 0.5, confirmed.length ? `Member of ${confirmed.length} confirmed pattern(s): ${confirmed.map((p) => String(p.id)).join(', ')}.` : 'No confirmed pattern.', confirmed[0] ? `pattern:${String(confirmed[0].id)}` : 'pattern:none');
  add('detected_pattern', detected.length, detected.length ? 'neutral' : 'neutral', 0.1, detected.length ? 'A detected but unconfirmed pattern is a reason for care, not for decline.' : 'No open pattern flag.', detected[0] ? `pattern:${String(detected[0].id)}` : 'pattern:none');
  add('identity', idn.status ?? 'not_run', idn.route === 'refund_investigator' ? 'supports' : idn.route ? 'caution' : 'neutral', 0.3, idn.route ? `CRS screening routed this shopper to ${String(idn.route).replaceAll('_', ' ')}.` : 'Identity screening was not run for this claim.', 'identity:crs');
  if (pulse) add('item_spike', `${pulse.count} in 60 s`, pulse.spike ? 'neutral' : 'neutral', 0.1, pulse.spike ? 'This item is spiking across shoppers right now, which points at the item (a batch), not at this shopper.' : 'Normal return volume for this item.', 'pulse:item');
  if (bc.units_sold_last_30d) add('defective_batch_context', `${bc.claims_last_30d}/${bc.units_sold_last_30d}`, Number(bc.claims_last_30d) / Math.max(1, Number(bc.units_sold_last_30d)) > 0.1 ? 'supports' : 'neutral', 0.2, 'A high claim rate for this SKU at this store supports an innocent explanation.', 'business_context:sku');
  add('frame_reuse', Number(v.frame_reuse_count ?? 0), Number(v.frame_reuse_count ?? 0) > 0 ? 'caution' : 'neutral', 0.6, Number(v.frame_reuse_count ?? 0) > 0 ? 'Frames match another claim; a person must compare the videos.' : 'No frame reuse.', 'check:frame_reuse');
  add('challenge', v.challenge_passed ?? null, v.challenge_passed === false ? 'caution' : v.challenge_passed === true ? 'supports' : 'neutral', 0.3, v.challenge_passed === false ? 'The finger challenge was not passed.' : 'Finger challenge as expected or not checked.', 'check:challenge');
  add('still_image', v.still_image === true, v.still_image === true ? 'caution' : 'neutral', 0.2, v.still_image === true ? 'The video barely changes between frames; a short handheld clip would settle it.' : 'The video shows motion.', 'check:still_image');
  const cautions = ind.filter((i) => i.reading === 'caution'); const weight = cautions.reduce((a, i) => a + Number(i.weight), 0);
  const caution = v.unable_to_verify === true && cautions.length === 0 ? 'unknown' : weight >= 0.8 ? 'high' : weight >= 0.35 ? 'medium' : 'low';
  const supports = ind.filter((i) => i.reading === 'supports');
  return fill(load('risk_scorecard', 'card'), {
    claim_id: get(c, 'claim_id'), caution, indicators: ind,
    strongest_support: supports.sort((a, b) => Number(b.weight) - Number(a.weight))[0]?.name ?? 'none',
    strongest_caution: cautions.sort((a, b) => Number(b.weight) - Number(a.weight))[0]?.name ?? 'none',
    innocent: pulse && (pulse as Obj).spike ? 'Many shoppers are returning this item at once; a defective batch explains that better than this one claim.' : 'Nothing in the context needs explaining away; the video evidence decides.',
    summary: `Caution ${caution}: ${cautions.length} indicator(s) read as caution, ${supports.length} as support. These are context for the Investigator and a person; none of them decides the claim.`,
  });
}
