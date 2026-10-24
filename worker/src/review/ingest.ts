// Ingest: one upload becomes a case folder Droid can work in. Everything
// ffmpeg does is logged with its exit code and duration (ingest.log), and the
// outputs are registered as artifacts so findings can cite them.
//
//   cases/<claimId>/
//     source.<ext>   the upload, untouched; meta.json from ffprobe
//     video.mp4      H.264, at most 720p, 30 fps     audio.wav  16 kHz mono (when the upload has sound)
//     frames/u_%04d.jpg   2 fps, index.json maps file → time
//     frames/s_%04d.jpg   scene changes (scene > 0.25), plus first.jpg and last.jpg
//     mosaics/m_%03d.jpg  3×3 contact sheets, 4.5 s each, timestamps burnt in
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { sha256File } from './paths';

const run = promisify(execFile);

export interface IngestLogLine { cmd: string; exitCode: number; ms: number; note?: string }

export interface VideoMeta {
  durationS: number; width: number; height: number; fps: number; codec: string; rotation: number; hasAudio: boolean;
  creationTime: string | null; encoder: string | null; make: string | null; model: string | null; bitrate: number | null; container: string;
}

export interface NewArtifact { kind: string; path: string; tStart: number; tEnd: number; label: string; sha256: string }

export interface IngestResult {
  meta: VideoMeta;
  sha256: string;
  uniform: { file: string; t: number }[];
  scenes: { file: string; t: number }[];
  mosaics: { file: string; tStart: number; tEnd: number }[];
  artifacts: NewArtifact[];
  log: IngestLogLine[];
  limits: string[];
}

export const MOSAIC_SECONDS = 4.5; // 9 frames at 2 fps
export const UNIFORM_FPS = 2;

/** The upload is kept untouched as source.<ext> inside the case. */
export const sourceName = (source: string) => `source.${(source.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'}`;

async function ff(log: IngestLogLine[], bin: 'ffmpeg' | 'ffprobe', args: string[], cwd: string, note?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const t0 = Date.now();
  try {
    const r = await run(bin, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 180_000 });
    log.push({ cmd: `${bin} ${args.join(' ')}`, exitCode: 0, ms: Date.now() - t0, note });
    return { ok: true, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    log.push({ cmd: `${bin} ${args.join(' ')}`, exitCode: typeof err.code === 'number' ? err.code : 1, ms: Date.now() - t0, note });
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

export async function probeMeta(file: string, cwd: string, log: IngestLogLine[]): Promise<VideoMeta> {
  const r = await ff(log, 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], cwd, 'metadata');
  if (!r.ok) throw new Error('ffprobe could not read the upload');
  const j = JSON.parse(r.stdout) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[];
    format?: { duration?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> };
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v || !v.width || !v.height) throw new Error('no video stream');
  const [num, den] = (v.r_frame_rate ?? '30/1').split('/').map(Number);
  const tags = { ...(j.format?.tags ?? {}), ...(v.tags ?? {}) };
  const rotation = Number(v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? tags.rotate ?? 0);
  const find = (re: RegExp) => Object.entries(tags).find(([k]) => re.test(k))?.[1] ?? null;
  return {
    durationS: Math.round(Number(j.format?.duration ?? 0) * 100) / 100,
    width: v.width, height: v.height,
    fps: den ? Math.round((num! / den) * 100) / 100 : 30,
    codec: v.codec_name ?? '?',
    rotation,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    creationTime: tags.creation_time ?? null,
    encoder: find(/^encoder$/i),
    make: find(/make$/i),
    model: find(/model$/i),
    bitrate: j.format?.bit_rate ? Number(j.format.bit_rate) : null,
    container: j.format?.format_name ?? '?',
  };
}

const art = (dir: string, kind: string, rel: string, tStart: number, tEnd: number, label: string): NewArtifact => ({ kind, path: rel, tStart, tEnd, label, sha256: sha256File(resolve(dir, rel)) });

/** Runs the whole ingest for one case. Throws only when the upload is unreadable; every other failure is a logged limit. */
export async function ingest(dir: string, source: string): Promise<IngestResult> {
  mkdirSync(resolve(dir, 'frames'), { recursive: true });
  mkdirSync(resolve(dir, 'mosaics'), { recursive: true });
  mkdirSync(resolve(dir, 'work'), { recursive: true });
  mkdirSync(resolve(dir, 'proof'), { recursive: true });
  const src = resolve(dir, sourceName(source));
  if (resolve(source) !== src) copyFileSync(source, src);
  const log: IngestLogLine[] = [];
  const limits: string[] = [];
  const meta = await probeMeta(src, dir, log);
  writeFileSync(resolve(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  const dur = meta.durationS;

  // Normalise once so every later command (and Droid) works on one predictable file.
  const vid = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=-2:min(720\\,ih)', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', 'video.mp4'], dir, 'transcode');
  if (!vid.ok) throw new Error(`transcode failed: ${vid.stderr.slice(-300)}`);
  if (meta.hasAudio) {
    const aud = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav'], dir, 'audio track');
    if (!aud.ok) { limits.push('The audio track could not be extracted.'); meta.hasAudio = false; }
  } else limits.push('The video has no audio track, so there is no transcript; claims come from the written reason.');

  const uni = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', 'video.mp4', '-vf', `fps=${UNIFORM_FPS},scale=640:-2`, '-q:v', '4', 'frames/u_%04d.jpg'], dir, 'uniform frames');
  const uniform = uni.ok
    ? readdirSync(resolve(dir, 'frames')).filter((f) => f.startsWith('u_')).sort().map((f) => ({ file: `frames/${f}`, t: Math.round(((Number(f.slice(2, 6)) - 1) / UNIFORM_FPS) * 100) / 100 }))
    : [];
  if (!uniform.length) limits.push('Uniform frame sampling failed.');

  const sc = await ff(log, 'ffmpeg', ['-y', '-v', 'info', '-i', 'video.mp4', '-vf', "select='gt(scene,0.25)',showinfo,scale=640:-2", '-vsync', 'vfr', '-q:v', '4', 'frames/s_%04d.jpg'], dir, 'scene changes');
  const sceneTimes = [...sc.stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
  const scenes = readdirSync(resolve(dir, 'frames')).filter((f) => f.startsWith('s_')).sort().map((f, i) => ({ file: `frames/${f}`, t: sceneTimes[i] ?? 0 }));
  await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(0.3, dur / 4)), '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', 'frames/first.jpg'], dir, 'first second');
  await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, dur - 0.5)), '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', 'frames/last.jpg'], dir, 'last second (the finger challenge)');

  // Contact sheets with the time burnt in: one Read of a mosaic shows Droid 4.5 s of video.
  const stamp = "drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=4";
  let mos = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', 'video.mp4', '-vf', `fps=${UNIFORM_FPS},scale=426:-2,${stamp},tile=3x3`, '-q:v', '4', 'mosaics/m_%03d.jpg'], dir, 'mosaics with timestamps');
  if (!mos.ok) {
    limits.push('Mosaics have no timestamp overlay (drawtext is unavailable in this ffmpeg build); use frames/index.json for times.');
    mos = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', 'video.mp4', '-vf', `fps=${UNIFORM_FPS},scale=426:-2,tile=3x3`, '-q:v', '4', 'mosaics/m_%03d.jpg'], dir, 'mosaics without timestamps');
  }
  const mosaics = readdirSync(resolve(dir, 'mosaics')).filter((f) => f.startsWith('m_')).sort().map((f) => {
    const n = Number(f.slice(2, 5)) - 1;
    return { file: `mosaics/${f}`, tStart: Math.round(n * MOSAIC_SECONDS * 100) / 100, tEnd: Math.min(dur, Math.round((n + 1) * MOSAIC_SECONDS * 100) / 100) };
  });

  writeFileSync(resolve(dir, 'frames/index.json'), JSON.stringify({ fps: UNIFORM_FPS, durationS: dur, uniform, scenes, first: { file: 'frames/first.jpg', t: Math.min(0.3, dur / 4) }, last: { file: 'frames/last.jpg', t: Math.max(0, dur - 0.5) }, mosaics: mosaics.map((m) => ({ ...m, layout: '3x3, left to right, top to bottom, 0.5 s apart' })) }, null, 2));
  writeFileSync(resolve(dir, 'ingest.log'), log.map((l) => `[exit ${l.exitCode}, ${l.ms} ms]${l.note ? ` ${l.note}:` : ''} ${l.cmd}`).join('\n') + '\n');

  const artifacts: NewArtifact[] = [art(dir, 'video', 'video.mp4', 0, dur, `normalised video, ${meta.width}×${meta.height} → 720p`)];
  if (existsSync(resolve(dir, 'audio.wav'))) artifacts.push(art(dir, 'audio', 'audio.wav', 0, dur, 'audio track, 16 kHz mono'));
  for (const m of mosaics) artifacts.push(art(dir, 'mosaic', m.file, m.tStart, m.tEnd, `contact sheet ${m.file.slice(8, 13)}: ${m.tStart.toFixed(1)}–${m.tEnd.toFixed(1)} s`));
  for (const s of scenes) artifacts.push(art(dir, 'frame', s.file, s.t, s.t, `scene change at ${s.t.toFixed(1)} s`));
  if (existsSync(resolve(dir, 'frames/first.jpg'))) artifacts.push(art(dir, 'frame', 'frames/first.jpg', 0, 0.5, 'first second'));
  if (existsSync(resolve(dir, 'frames/last.jpg'))) artifacts.push(art(dir, 'frame', 'frames/last.jpg', Math.max(0, dur - 0.5), dur, 'last second (finger challenge)'));
  artifacts.push(art(dir, 'log', 'ingest.log', 0, dur, 'every ffmpeg command with exit code and duration'));
  return { meta, sha256: sha256File(src), uniform, scenes, mosaics, artifacts, log, limits };
}
