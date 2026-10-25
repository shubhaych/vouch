// Fixture mode (CREAO_MODE=fixture): a canned response per seat, chosen by
// the hard rules each agent's prompt states (offline or unable to verify →
// more evidence, frame reuse or a failed challenge → never accept). This is
// recorded-style test data, labelled Fixture everywhere it shows; it is not
// a stand-in model. Recorded files (<seat>.recorded.<name>.json) win.
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
    accept.reasons = reasons;
    return accept;
  }
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
