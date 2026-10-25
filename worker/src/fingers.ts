// The finger challenge, checked while the phone waits for its upload: four
// frames from the last 2.5 seconds side by side, one Droid image call, one JSON answer. A clear miss
// sends the customer straight back to record again, before the video counts as
// their claim video or their one extra clip. Anything less than a clear answer
// (no key, budget, timeout, an unsure model) lets the upload through, and the
// full review checks the challenge again: a slow or broken check never blocks a claim.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { config, log } from './env';

const run = promisify(execFile);
const TIMEOUT_MS = 25_000;
/** Below this the model's answer is treated as unsure and the upload goes through. */
export const SURE = 0.7;

export interface FingerCheck { verdict: 'ok' | 'missing' | 'wrong' | 'unsure'; seen: number | null; note: string; ms: number }

/** Pure: what the model's JSON means for this upload. */
export function judgeFingers(reply: string, expected: number): Omit<FingerCheck, 'ms'> {
  const s = reply.indexOf('{');
  const e = reply.lastIndexOf('}');
  let j: { handVisible?: unknown; fingers?: unknown; confidence?: unknown };
  try { j = JSON.parse(reply.slice(s, e + 1)) as typeof j; } catch { return { verdict: 'unsure', seen: null, note: 'unreadable answer' }; }
  const conf = typeof j.confidence === 'number' ? j.confidence : 0;
  const seen = typeof j.fingers === 'number' && Number.isInteger(j.fingers) ? j.fingers : null;
  if (conf < SURE) return { verdict: 'unsure', seen, note: `confidence ${conf}` };
  if (j.handVisible === false || seen === 0) return { verdict: 'missing', seen: 0, note: 'no raised fingers in the last frames' };
  if (seen === expected) return { verdict: 'ok', seen, note: `${seen} fingers` };
  if (seen === null) return { verdict: 'unsure', seen, note: 'no count given' };
  return { verdict: 'wrong', seen, note: `${seen} fingers, expected ${expected}` };
}

/** The phone's message for a miss; null when the upload may go on. */
export function fingerMessage(c: FingerCheck, expected: number): string | null {
  const want = `${expected} ${expected === 1 ? 'finger' : 'fingers'}`;
  if (c.verdict === 'missing') return `We couldn't see you holding up ${want} at the end of the video. Please record it again and finish by holding up ${want} next to the item.`;
  if (c.verdict === 'wrong') return `At the end of the video we counted ${c.seen} ${c.seen === 1 ? 'finger' : 'fingers'}, but this claim needs ${want}. Please record it again and finish by holding up ${want} next to the item.`;
  return null;
}

export async function checkFingers(video: string, durationS: number, expected: number, dir: string): Promise<FingerCheck> {
  const t0 = Date.now();
  const done = (r: Omit<FingerCheck, 'ms'>): FingerCheck => ({ ...r, ms: Date.now() - t0 });
  if (!config.factoryKey || process.env.FINGER_CHECK === '0') return done({ verdict: 'unsure', seen: null, note: 'finger check off' });
  const out = resolve(dir, 'fingers.jpg');
  try {
    const t = (x: number) => Math.max(0, durationS - x).toFixed(2);
    // Four moments in the last 2.5 seconds, side by side: one image, one call. People lower
    // their hand before they stop recording, so the very last frame alone often misses it.
    const at = [2.4, 1.6, 0.9, 0.25];
    const inputs = at.flatMap((x) => ['-ss', t(x), '-i', video]);
    const graph = `${at.map((_x, i) => `[${i}:v]trim=end_frame=1,scale=-2:400[f${i}]`).join(';')};${at.map((_x, i) => `[f${i}]`).join('')}hstack=inputs=${at.length}`;
    await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-frames:v', '1', '-q:v', '4', out], { timeout: 15_000 });
    const sdk = await import('@factory/droid-sdk/node');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await sdk.run([
      'These are four frames from the last 2.5 seconds of a product video, side by side, oldest on the left. The person was asked to hold up some fingers next to the item at the end.',
      'Count the fingers raised on the hand that is held up (a closed fist is 0). Look at the clearest frame. Do not describe the person.',
      'Reply with ONLY JSON: {"handVisible": true|false, "fingers": <integer or null>, "confidence": <0..1>}',
    ].join('\n'), {
      cwd: dir, autonomyLevel: sdk.AutonomyLevel.Off, autoRejectPermissionRequests: true,
      disabledToolIds: ['WebSearch', 'FetchUrl', 'Execute', 'Create', 'Edit', 'ApplyPatch', 'Task', 'Read'],
      images: [{ type: 'base64', data: readFileSync(out).toString('base64'), mediaType: 'image/jpeg' }], abortSignal: ctl.signal,
      ...(config.review.model ? { modelId: config.review.model } : {}),
    }).finally(() => clearTimeout(timer));
    return done(judgeFingers(r.text ?? '', expected));
  } catch (e) {
    log(`finger check skipped: ${(e as Error).message.slice(0, 160)}`);
    return done({ verdict: 'unsure', seen: null, note: 'check failed' });
  }
}
