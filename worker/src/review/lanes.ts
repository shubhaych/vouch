// The lanes that run before Droid: transcript (faster-whisper), integrity
// (ffmpeg detectors plus the upload's own checks) and claims. Each lane is a
// plain function that writes files into the case folder and returns what the
// report needs; none of them decides anything.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IntegrityFlag } from '@vouch/module/review-score';
import { config } from '../env';
import type { ReuseMatch } from '../video';
import type { TranscriptDoc } from './claims';
import type { IngestLogLine, IngestResult, NewArtifact } from './ingest';
import { sha256File } from './paths';

const run = promisify(execFile);

async function timed(log: IngestLogLine[], bin: string, args: string[], cwd: string, note: string, timeout = 240_000): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
  const t0 = Date.now();
  try {
    const r = await run(bin, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 });
    log.push({ cmd: `${bin} ${args.join(' ')}`, exitCode: 0, ms: Date.now() - t0, note });
    return { ok: true, code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    const code = typeof err.code === 'number' ? err.code : 1;
    log.push({ cmd: `${bin} ${args.join(' ')}`, exitCode: code, ms: Date.now() - t0, note });
    return { ok: false, code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ---------------------------------------------------------------- transcript

export interface TranscriptLane { status: 'done' | 'no_audio' | 'no_speech' | 'failed'; transcript: TranscriptDoc | null; limit: string | null; artifacts: NewArtifact[]; log: IngestLogLine[] }

export async function transcribeLane(dir: string, hasAudio: boolean): Promise<TranscriptLane> {
  const log: IngestLogLine[] = [];
  if (!hasAudio) return { status: 'no_audio', transcript: null, limit: 'No audio track in the upload. Record with microphone access, or upload a video with sound.', artifacts: [], log };
  if (!existsSync(resolve(dir, 'audio.wav'))) return { status: 'failed', transcript: null, limit: 'Audio exists, but extraction failed. This is a processing problem, not missing customer evidence.', artifacts: [], log };
  const script = resolve(config.toolsDir, 'transcribe.py');
  const r = await timed(log, config.review.python, [script, 'audio.wav', 'transcript.json', '--model', config.review.whisperModel, '--txt', 'transcript.txt'], dir, 'transcript (faster-whisper)');
  if (r.code === 3) return { status: 'failed', transcript: null, limit: 'Transcriber unavailable. Run bash scripts/setup-review-audio.sh and restart the worker. This is a server setup problem, not missing customer evidence.', artifacts: [], log };
  if (!r.ok) return { status: 'failed', transcript: null, limit: 'Transcription failed or timed out on the worker. Listen to the original audio; do not treat this as evidence against the claim.', artifacts: [], log };
  let doc: TranscriptDoc;
  try {
    doc = JSON.parse(readFileSync(resolve(dir, 'transcript.json'), 'utf8')) as TranscriptDoc;
    if (!Array.isArray(doc.segments) || !Array.isArray(doc.words) || doc.segments.some((s) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start || typeof s.text !== 'string')) throw new Error('invalid transcript');
  } catch {
    return { status: 'failed', transcript: null, limit: 'The transcriber returned invalid data. Listen to the original audio.', artifacts: [], log };
  }
  if (!doc.segments.length) return { status: 'no_speech', transcript: doc, limit: 'Audio is available, but no speech was recognised. Item sounds can still be relevant.', artifacts: [], log };
  const dur = Math.max(...doc.segments.map((s) => s.end));
  const artifacts: NewArtifact[] = [
    { kind: 'transcript', path: 'transcript.json', tStart: 0, tEnd: dur, label: `transcript, ${doc.words.length} words (${doc.model ?? 'whisper'})`, sha256: sha256File(resolve(dir, 'transcript.json')) },
    { kind: 'transcript', path: 'transcript.txt', tStart: 0, tEnd: dur, label: 'transcript, readable', sha256: sha256File(resolve(dir, 'transcript.txt')) },
  ];
  return { status: 'done', transcript: doc, limit: null, artifacts, log };
}

// ---------------------------------------------------------------- integrity

export interface UploadChecks { frame_reuse?: ReuseMatch[]; still_image?: boolean; blank_frames?: number; frame_motion?: number | null; fresh?: boolean; uploaded_after_s?: number; clips?: 1 | 2; has_audio?: boolean; extra_requested_at?: string; first?: UploadChecks }

export interface IntegrityDoc {
  flags: IntegrityFlag[];
  black: { start: number; end: number }[];
  frozen: { start: number; end: number }[];
  cutsPerSecond: number;
  metadata: { creationTime: string | null; encoder: string | null; make: string | null; model: string | null; codec: string; container: string; claimOpenedAt: string; note: string };
  reuse: ReuseMatch[];
  challenge: { expectedFingers: number; lastFrame: string; checkedBy: 'droid' | 'nobody' };
  clips: { n: number; tStart: number; tEnd: number }[];
  notes: string[];
}

export interface IntegrityLane { doc: IntegrityDoc; artifacts: NewArtifact[]; log: IngestLogLine[]; limits: string[] }

const spans = (stderr: string, startKey: string, endKey: string, durKey: string) => {
  const out: { start: number; end: number }[] = [];
  const starts = [...stderr.matchAll(new RegExp(`${startKey}[:=]\\s*([0-9.]+)`, 'g'))].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(new RegExp(`${endKey}[:=]\\s*([0-9.]+)`, 'g'))].map((m) => Number(m[1]));
  const durs = [...stderr.matchAll(new RegExp(`${durKey}[:=]\\s*([0-9.]+)`, 'g'))].map((m) => Number(m[1]));
  starts.forEach((s, i) => out.push({ start: Math.round(s * 100) / 100, end: Math.round((ends[i] ?? s + (durs[i] ?? 0)) * 100) / 100 }));
  return out;
};

export async function integrityLane(dir: string, ing: IngestResult, checks: UploadChecks, fingerCount: number, claimOpenedAt: Date, extraRequestedAt?: Date): Promise<IntegrityLane> {
  const log: IngestLogLine[] = [];
  const limits: string[] = [];
  const notes: string[] = [];
  const flags: IntegrityFlag[] = [];
  const dur = ing.meta.durationS;

  // Both detectors can share one decode; neither depends on the other's result.
  const bd = await timed(log, 'ffmpeg', ['-hide_banner', '-nostats', '-i', 'video.mp4', '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=2', '-an', '-f', 'null', '-'], dir, 'black and frozen frames');
  const black = bd.ok ? spans(bd.stderr, 'black_start', 'black_end', 'black_duration') : [];
  if (!bd.ok) limits.push('The black-frame detector did not run.');
  const fz = bd;
  const frozen = fz.ok ? spans(fz.stderr, 'lavfi.freezedetect.freeze_start', 'lavfi.freezedetect.freeze_end', 'lavfi.freezedetect.freeze_duration') : [];
  if (!fz.ok) limits.push('The frozen-frame detector did not run.');

  const blackS = black.reduce((a, b) => a + (b.end - b.start), 0);
  if (blackS >= 1) { flags.push({ kind: 'black', confidence: 0.9, tStart: black[0]!.start, tEnd: black[0]!.end, note: `${blackS.toFixed(1)} s of black frames` }); notes.push(`${blackS.toFixed(1)} s of the video is black.`); }
  const frozenS = frozen.reduce((a, b) => a + (b.end - b.start), 0);
  if (frozenS >= 2) { flags.push({ kind: 'frozen', confidence: 0.8, tStart: frozen[0]!.start, tEnd: frozen[0]!.end, note: `${frozenS.toFixed(1)} s of frozen frames` }); notes.push(`${frozenS.toFixed(1)} s of the video does not change at all (a still image or a paused recording).`); }
  if (checks.still_image) { flags.push({ kind: 'still_image', confidence: 0.7, note: `frame motion ${checks.frame_motion ?? '?'}` }); notes.push('The sampled frames barely change, as a photo or a slideshow would.'); }

  // Joining the extra clip to the claim video adds one cut that is ours, not an edit.
  const cuts = Math.max(0, ing.scenes.length - (ing.clips.length - 1));
  const cutsPerSecond = dur > 0 ? Math.round((cuts / dur) * 100) / 100 : 0;
  if (cutsPerSecond > 0.5) { flags.push({ kind: 'splice', confidence: 0.5, note: `${cuts} hard cuts in ${dur.toFixed(1)} s` }); notes.push(`${cuts} hard cuts in ${dur.toFixed(1)} s: the video may be edited together from pieces.`); }
  else if (cutsPerSecond > 0.25) { flags.push({ kind: 'splice', confidence: 0.25, note: `${cuts} hard cuts in ${dur.toFixed(1)} s` }); notes.push(`${cuts} scene changes in ${dur.toFixed(1)} s; some may be cuts.`); }

  // Each clip's own file is checked against the moment it was asked for: the claim for clip 1, the request for the extra clip.
  const m = ing.meta;
  const metaNotes: string[] = [];
  for (const clip of ing.clips) {
    const cm = clip.meta;
    const name = ing.clips.length > 1 ? `Clip ${clip.n}: the` : 'The';
    const ref = clip.n === 2 && extraRequestedAt ? extraRequestedAt : claimOpenedAt;
    const what = clip.n === 2 && extraRequestedAt ? 'the extra clip was requested' : 'the claim was opened';
    let note = `${name} file has no creation time (phones recording through the browser rarely write one).`;
    if (cm.creationTime) {
      const created = new Date(cm.creationTime);
      if (!Number.isNaN(created.getTime())) {
        const minutes = (ref.getTime() - created.getTime()) / 60_000;
        if (minutes > 15) { flags.push({ kind: 'metadata_inconsistent', confidence: 0.6, tStart: clip.tStart, tEnd: clip.tEnd, note: `clip ${clip.n} file created ${Math.round(minutes)} min before ${what}` }); note = `${name} file's creation time is ${Math.round(minutes)} minutes before ${what}, so it may not have been recorded for this claim.`; }
        else note = `${name} file's creation time is within ${Math.max(0, Math.round(minutes))} minutes of when ${what}.`;
      }
    }
    metaNotes.push(note);
    if (cm.encoder && /lavf|handbrake|ffmpeg|premiere|final cut|davinci/i.test(cm.encoder)) { flags.push({ kind: 'reencoded', confidence: 0.5, tStart: clip.tStart, tEnd: clip.tEnd, note: `clip ${clip.n} encoder tag ${cm.encoder}` }); notes.push(`${name} file was written by ${cm.encoder}, not directly by a phone camera.`); }
  }
  const metaNote = metaNotes.join(' ');
  if (checks.fresh === false) { flags.push({ kind: 'metadata_inconsistent', confidence: 0.5, note: `uploaded ${checks.uploaded_after_s ?? '?'} s after the ${checks.clips === 2 ? 'extra clip was requested' : 'challenge was issued'}` }); notes.push(checks.clips === 2 ? 'The extra clip arrived after its 30-minute window.' : 'The upload arrived after the challenge window.'); }

  // Reuse found when the claim video was uploaded still counts once the extra clip arrives.
  const reuse = [...(checks.first?.frame_reuse ?? []), ...(checks.frame_reuse ?? [])];
  if (reuse.length) { flags.push({ kind: 'frame_reuse', confidence: 0.9, note: `matches ${reuse.map((r) => r.matches_claim).join(', ')}` }); notes.push(`Frames match frames from ${reuse.map((r) => r.matches_claim).join(', ')} (difference-hash distance ≤ 6).`); }

  const doc: IntegrityDoc = {
    flags, black, frozen, cutsPerSecond,
    metadata: { creationTime: m.creationTime, encoder: m.encoder, make: m.make, model: m.model, codec: m.codec, container: m.container, claimOpenedAt: claimOpenedAt.toISOString(), note: metaNote },
    reuse,
    challenge: { expectedFingers: fingerCount, lastFrame: 'frames/last.jpg', checkedBy: 'nobody' },
    clips: ing.clips.map((c) => ({ n: c.n, tStart: c.tStart, tEnd: c.tEnd })),
    notes,
  };
  writeFileSync(resolve(dir, 'integrity.json'), JSON.stringify(doc, null, 2));
  const artifacts: NewArtifact[] = [{ kind: 'measurement', path: 'integrity.json', tStart: 0, tEnd: dur, label: `integrity checks: ${flags.length ? flags.map((f) => f.kind).join(', ') : 'nothing flagged'}`, sha256: sha256File(resolve(dir, 'integrity.json')) }];
  return { doc, artifacts, log, limits };
}
