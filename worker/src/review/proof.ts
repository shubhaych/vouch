// Proof clips and the proof reel, cut by the worker from the source upload
// (so sound survives) with the finding caption burnt in. The same steps the
// Proof Builder session would take, run deterministically so every report has
// clips even when Droid is unavailable. REVIEW_DROID_PROOF=1 lets Droid do it.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IngestLogLine, VideoMeta } from './ingest';
import type { CaseState, FindingRec } from './state';

const run = promisify(execFile);
const COLOUR: Record<string, string> = { supports: '0x3fbf7f', contradicts: '0xe5533d', neutral: '0x9aa0a6', integrity: '0xf0b429' };
const REEL_MAX_S = 40;
/** A clip runs from tStart−1 to tEnd+1; analysts use ±5 s windows, so 12 s keeps the whole window in one clip. */
export const CLIP_MAX_S = 12;

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/,/g, '\\,').replace(/\[/g, '(').replace(/\]/g, ')');

export interface ProofResult { clips: { findingId: bigint; path: string }[]; reel: string | null; log: IngestLogLine[]; limits: string[] }

async function ff(log: IngestLogLine[], args: string[], cwd: string, note: string) {
  const t0 = Date.now();
  try {
    await run('ffmpeg', args, { cwd, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    log.push({ cmd: `ffmpeg ${args.join(' ')}`, exitCode: 0, ms: Date.now() - t0, note });
    return true;
  } catch (e) {
    log.push({ cmd: `ffmpeg ${args.join(' ')}`, exitCode: typeof (e as { code?: number }).code === 'number' ? (e as { code: number }).code : 1, ms: Date.now() - t0, note: `${note}: ${String((e as { stderr?: string }).stderr ?? '').trim().split('\n').pop()?.slice(0, 160)}` });
    return false;
  }
}

/** Cuts one captioned clip and one still per finding, then the reel. Registers everything as artifacts. */
export async function buildProof(state: CaseState, meta: VideoMeta, sourceFile: string): Promise<ProofResult> {
  const dir = state.dir;
  mkdirSync(resolve(dir, 'proof'), { recursive: true });
  const log: IngestLogLine[] = [];
  const limits: string[] = [];
  const dur = meta.durationS;
  const findings = [...state.findings.values()].sort((a, b) => a.tStart - b.tStart);
  const clips: ProofResult['clips'] = [];
  const audio = meta.hasAudio ? ['-c:a', 'aac', '-ac', '1', '-ar', '16000', '-b:a', '64k'] : ['-an'];
  for (const f of findings) {
    const start = Math.max(0, f.tStart - 1);
    const end = Math.min(dur, Math.max(f.tEnd + 1, start + 1.5));
    const len = Math.min(CLIP_MAX_S, end - start);
    const caption = `${f.kind.toUpperCase()} ${f.spokenClaimId}  ${f.observation.slice(0, 70)}`;
    const vf = `scale=-2:min(720\\,ih),fps=30,drawbox=x=0:y=0:w=iw:h=ih:color=${COLOUR[f.kind] ?? '0xffffff'}@0.9:t=10,drawtext=text='${esc(caption)}':x=16:y=h-th-16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8,drawtext=text='%{pts\\:hms\\:${start.toFixed(2)}}':x=16:y=16:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`;
    const clip = `proof/clip_${f.id}.mp4`;
    let ok = await ff(log, ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', len.toFixed(2), '-i', sourceFile, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', clip], dir, `clip for finding ${f.id}`);
    if (!ok) {
      // Fonts can be missing: cut the clip without text, keep the border.
      const plain = `scale=-2:min(720\\,ih),fps=30,drawbox=x=0:y=0:w=iw:h=ih:color=${COLOUR[f.kind] ?? '0xffffff'}@0.9:t=10`;
      ok = await ff(log, ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', len.toFixed(2), '-i', sourceFile, '-vf', plain, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', clip], dir, `clip for finding ${f.id} (no caption)`);
      if (ok) limits.push('Proof clips have no burnt-in caption (drawtext is unavailable in this ffmpeg build).');
    }
    if (ok && existsSync(resolve(dir, clip))) {
      clips.push({ findingId: f.id, path: clip });
      const rec = await state.addArtifact({ kind: 'clip', path: clip, tStart: start, tEnd: start + len, label: `clip for finding ${f.id} (${f.kind} ${f.spokenClaimId})`, sha256: '' });
      if (!f.artifactIds.includes(rec.id)) f.artifactIds = [...f.artifactIds, rec.id];
    }
    const still = `proof/still_${f.id}.jpg`;
    const mid = (f.tStart + f.tEnd) / 2;
    if (await ff(log, ['-y', '-v', 'error', '-ss', Math.min(dur - 0.05, mid).toFixed(2), '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', still], dir, `still for finding ${f.id}`)) {
      await state.addArtifact({ kind: 'frame', path: still, tStart: mid, tEnd: mid, label: `still at ${mid.toFixed(1)} s for finding ${f.id}`, sha256: '' });
    }
  }
  let reel: string | null = null;
  if (clips.length) {
    // Longest windows first until the reel is 40 s, then back in time order.
    const picked: typeof clips = [];
    let total = 0;
    for (const c of [...clips].sort((a, b) => (span(findings, b.findingId)) - (span(findings, a.findingId)))) {
      const s = Math.min(CLIP_MAX_S, span(findings, c.findingId) + 2);
      if (total + s > REEL_MAX_S && picked.length) continue;
      picked.push(c); total += s;
    }
    picked.sort((a, b) => findings.findIndex((f) => f.id === a.findingId) - findings.findIndex((f) => f.id === b.findingId));
    writeFileSync(resolve(dir, 'proof/reel.txt'), picked.map((c) => `file '${c.path.replace('proof/', '')}'`).join('\n') + '\n');
    if (await ff(log, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', 'proof/reel.txt', '-c', 'copy', '-movflags', '+faststart', 'proof/reel.mp4'], dir, `proof reel (${picked.length} clips)`)) {
      reel = 'proof/reel.mp4';
      await state.addArtifact({ kind: 'video', path: reel, tStart: 0, tEnd: dur, label: `proof reel: ${picked.length} clip${picked.length === 1 ? '' : 's'}`, sha256: '' });
    } else limits.push('The proof reel could not be assembled; the individual clips are available.');
  } else limits.push('No findings, so no proof clips.');
  return { clips, reel, log, limits };
}

const span = (fs: FindingRec[], id: bigint) => { const f = fs.find((x) => x.id === id); return f ? f.tEnd - f.tStart : 0; };

/** When a Proof Builder session already registered proof/clip_<id>.mp4 for every finding, cite them and skip the worker's cut. */
export function linkExistingClips(state: CaseState): boolean {
  let all = true;
  for (const f of state.findings.values()) {
    const clip = [...state.artifacts.values()].find((a) => a.path === `proof/clip_${f.id}.mp4` && existsSync(resolve(state.dir, a.path)));
    if (!clip) { all = false; continue; }
    if (!f.artifactIds.includes(clip.id)) f.artifactIds = [...f.artifactIds, clip.id];
  }
  return all && state.findings.size > 0;
}
