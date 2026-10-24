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
    return fill(load(seat, frames.length >= 4 && blank * 2 < frames.length ? 'consistent' : 'unable'), vars);
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
    else if (get(c, 'deterministic_checks.within_window') === false) { reason = 'The claim was filed outside the return window.'; cites = 'policy:window'; }
    if (reason) return fill(load(seat, 'more_evidence'), { claim_id: get(c, 'claim_id'), reason, cites });
    const accept = fill(load(seat, 'accept'), { claim_id: get(c, 'claim_id'), amount, needs_controller: amount > Number(get(c, 'controller_threshold') ?? 500) }) as Obj;
    // The prompt weighs a verified credential from another store as context, and every reason cites its source.
    const issuer = get(c, 'credential.issuer');
    if (get(c, 'credential.verified') === true && issuer) {
      const band = get(c, 'credential.claims.refund_ratio_band');
      const text = `A credential from ${String(issuer)} verified in all five steps${band ? ` and shows a ${String(band)} refund ratio there` : ''}.`;
      accept.reasons = [...(accept.reasons as Obj[]), { text, cites: `credential:${String(issuer)}` }];
    }
    return accept;
  }
  const pattern = get(c, 'pattern') as Obj;
  const agents = ((get(c, 'agents') as Obj[] | undefined) ?? []).map((a) => String(a.id));
  const features = (pattern?.features ?? {}) as Obj;
  const coordinated = pattern?.kind === 'coordinated';
  const roles = agents.map((id) => ({ id, role: coordinated ? 'core' : 'peripheral', why: coordinated ? 'Claim text and timing match the group.' : 'Flagged on its own history only.', cites: [] }));
  return fill(load(seat, coordinated ? 'confirm' : 'needs_review'), {
    pattern_id: pattern?.id, agent_count: agents.length, hours: features.claim_window_hours ?? '?', businesses: features.businesses ?? '?', roles,
  });
}
