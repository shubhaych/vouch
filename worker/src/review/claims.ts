// Spoken claims: what the customer said, split into checkable statements with
// the moment each was said. One Droid call turns the transcript (or, with no
// audio, the written reason) into claims.json; without Droid a sentence
// splitter with keyword kinds does a rougher job and the report says so.
import { z } from 'zod';
import type { SpokenClaim, SpokenClaimKind } from '@vouch/module/review-score';
import { config } from '../env';

export interface TranscriptDoc { model?: string; language?: string | null; segments: { start: number; end: number; text: string }[]; words: { w: string; start: number; end: number }[]; error?: string }

export interface ClaimsInput { transcript: TranscriptDoc | null; reasonText: string; reasonCode: string; itemName: string; durationS: number }
export interface ClaimsResult { claims: SpokenClaim[]; source: 'droid' | 'heuristic'; note: string }

const KIND: [SpokenClaimKind, RegExp][] = [
  // Stems take any ending (scratch → scratched, flicker → flickering): a rough split is fine, Droid refines it when it runs.
  ['functional', /\b(not|n't|never|won't|wont|stopp?(ed|s)|fail\w*|dead|no (sound|power|light|signal)|does ?n'?t (work|turn|charge|connect|play|pair|hold|switch)|turn(s|ed)? (itself )?off|cuts? out|flicker\w*|overheat\w*|grind\w*|loose)\b/i],
  ['defect', /\b(crack\w*|broke\w*|break\w*|dent\w*|scratch\w*|tear|torn|chip\w*|bent|damage\w*|hole|stain\w*|split|shatter\w*|leak\w*|fray\w*|missing|came (apart|off))\b/i],
  ['condition', /\b(colou?r|size|fit|small|large|tight|short|long|material|different|described|photos?|listing|looks?|smaller|bigger|wrong|fake|used|opened|seal)\b/i],
];

const kindOf = (s: string, reasonCode: string): SpokenClaimKind => {
  for (const [k, re] of KIND) if (re.test(s)) return k;
  if (reasonCode === 'defective') return 'functional';
  if (reasonCode === 'damaged_in_shipping' || reasonCode === 'missing_parts') return 'defect';
  if (reasonCode === 'wrong_size' || reasonCode === 'not_as_described') return 'condition';
  return 'context';
};

const CLAIMY = /\b(not|n't|won't|never|stopped|broke|broken|crack|dent|scratch|missing|wrong|different|smaller|loose|dead|fail|damage|tear|torn|chip|bent|arrived|came|doesn|does|is|was|has|have)\b/i;
const FILLER = /^(hi|hello|hey|thanks?|thank you|please|ok|okay|so|um|uh|yeah|right)\b[.,!]?$/i;

export function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\s*[\n;]\s*/).map((s) => s.trim()).filter((s) => s.length > 3 && !FILLER.test(s));
}

/** When a sentence was said: the first transcript word window that contains most of its words, else spread evenly through the video. */
function timeOf(sentence: string, words: TranscriptDoc['words'], fallback: number): number {
  if (!words.length) return fallback;
  const target = sentence.toLowerCase().replace(/[^a-z0-9' ]/g, '').split(' ').filter((w) => w.length > 2);
  if (!target.length) return fallback;
  let best = { score: 0, t: fallback };
  for (let i = 0; i < words.length; i++) {
    const win = words.slice(i, i + target.length + 2).map((w) => w.w.toLowerCase().replace(/[^a-z0-9']/g, ''));
    const score = target.filter((w) => win.includes(w)).length / target.length;
    if (score > best.score) best = { score, t: words[i]!.start };
    if (score === 1) break;
  }
  return best.score >= 0.5 ? Math.round(best.t * 10) / 10 : fallback;
}

export function heuristicClaims(i: ClaimsInput): SpokenClaim[] {
  const spoken = i.transcript?.segments?.length ? i.transcript.segments.map((s) => s.text).join(' ') : '';
  const source = spoken.trim() || i.reasonText;
  const picked = sentences(source).filter((s) => CLAIMY.test(s)).slice(0, 6);
  const list = picked.length ? picked : sentences(i.reasonText).slice(0, 2);
  const words = i.transcript?.words ?? [];
  return list.map((text, n) => ({
    id: `c${n + 1}`,
    text: text.replace(/[.!?]+$/, ''),
    kind: kindOf(text, i.reasonCode),
    tSaid: timeOf(text, words, Math.round((i.durationS * (n + 1)) / (list.length + 1) * 10) / 10),
  }));
}

const ClaimsSchema = z.array(z.object({
  id: z.string().min(1), text: z.string().min(3).max(300), kind: z.enum(['defect', 'condition', 'functional', 'context']), tSaid: z.number().min(0),
})).min(1).max(8);

/** One Droid call, no tools, strict JSON. Falls back to the heuristic on any failure so the pipeline never waits on a model. */
export async function extractClaims(i: ClaimsInput, droidAllowed: boolean, cwd: string): Promise<ClaimsResult> {
  const fallback = heuristicClaims(i);
  if (!droidAllowed || !config.factoryKey) return { claims: fallback, source: 'heuristic', note: 'Claims were split by a sentence rule (Droid did not run for this step).' };
  try {
    const sdk = await import('@factory/droid-sdk/node');
    const spoken = i.transcript?.segments?.length ? i.transcript.segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n') : '(no audio track: nothing was said)';
    const prompt = [
      'You turn a refund video transcript into a list of checkable spoken claims. Reply with ONLY a JSON array, no prose, no code fence.',
      'Each item: {"id":"c1","text":"<one claim in the customer\'s words, max 120 chars>","kind":"defect|condition|functional|context","tSaid":<seconds, number>}.',
      'kind: defect = physical damage or a missing part; functional = something does not work or behave; condition = colour, size, fit, not as described; context = story around it (when it arrived, how it was used).',
      'Use the transcript timestamps for tSaid; when a claim exists only in the written reason, spread such claims evenly over the video length. 1 to 6 claims. Never describe the person; quote only what was said.',
      `Item: ${i.itemName}. Reason code: ${i.reasonCode}. Video length: ${i.durationS.toFixed(1)} s.`,
      `Written reason: ${JSON.stringify(i.reasonText.slice(0, 600))}`,
      `Transcript:\n${spoken.slice(0, 6000)}`,
    ].join('\n');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    const res = await sdk.run(prompt, {
      cwd, autonomyLevel: sdk.AutonomyLevel.Off, autoRejectPermissionRequests: true, disabledToolIds: ['WebSearch', 'FetchUrl', 'Execute', 'Create', 'Edit', 'ApplyPatch', 'Task'],
      abortSignal: ctl.signal, ...(config.review.model ? { modelId: config.review.model } : {}),
    }).finally(() => clearTimeout(timer));
    const text = (res.text ?? '').replace(/```(?:json)?/g, '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('no JSON array in the reply');
    const parsed = ClaimsSchema.parse(JSON.parse(text.slice(start, end + 1)));
    const claims = parsed.map((c, n) => ({ id: `c${n + 1}`, text: c.text, kind: c.kind, tSaid: Math.min(i.durationS, Math.round(c.tSaid * 10) / 10) }));
    return { claims, source: 'droid', note: `Claims were extracted by one Droid call (${claims.length} claims).` };
  } catch (e) {
    return { claims: fallback, source: 'heuristic', note: `Claims were split by a sentence rule; the Droid call failed: ${(e as Error).message.slice(0, 160)}.` };
  }
}
