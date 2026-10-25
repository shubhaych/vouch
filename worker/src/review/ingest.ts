// Ingest: one upload becomes a case folder Droid can work in. Everything
// ffmpeg does is logged with its exit code and duration (ingest.log), and the
// outputs are registered as artifacts so findings can cite them.
//
//   cases/<claimId>/
//     source.<ext>   the upload, untouched; meta.json from ffprobe
//     extra.<ext>    the customer's one extra clip, when there is one, untouched
//     video.mp4      H.264, at most 720p, 30 fps     audio.wav  16 kHz mono (when the upload has sound)
//                    with an extra clip, both clips joined end to end (clip 2 starts at clips[1].tStart)
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

/** One uploaded clip inside the joined timeline. */
export interface ClipInfo { n: 1 | 2; tStart: number; tEnd: number; file: string; sha256: string; meta: VideoMeta }

export interface IngestResult {
  /** Clip 1's container metadata, with the joined timeline's duration, size and audio. */
  meta: VideoMeta;
  clips: ClipInfo[];
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

/** The upload is kept untouched as source.<ext> inside the case (extra.<ext> for the extra clip). */
export const sourceName = (source: string, base = 'source') => `${base}.${(source.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'}`;

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/** The size clip 1 normalises to (at most 1280×720 or 720×1280, rotation applied); clip 2 is fitted into the same frame. */
export function targetSize(m: VideoMeta): { w: number; h: number } {
  const turned = Math.abs(m.rotation) % 180 === 90;
  const dw = turned ? m.height : m.width;
  const dh = turned ? m.width : m.height;
  const s = Math.min(1, 1280 / dw, 720 / dh);
  return { w: even(dw * s), h: even(dh * s) };
}

/** One ffmpeg pass joining two clips: same size (letterboxed), 30 fps, and a silent track for a clip without sound. */
export function joinArgs(a: { file: string; meta: VideoMeta }, b: { file: string; meta: VideoMeta }): string[] {
  const { w, h } = targetSize(a.meta);
  const v = (i: number) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`;
  const sound = a.meta.hasAudio || b.meta.hasAudio;
  const au = (i: number, m: VideoMeta) => m.hasAudio ? `[${i}:a]aresample=48000,aformat=channel_layouts=mono[a${i}]` : `anullsrc=r=48000:cl=mono,atrim=0:${m.durationS}[a${i}]`;
  const graph = sound
    ? [v(0), v(1), au(0, a.meta), au(1, b.meta), '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]', '[a]asplit=2[aout][awav]'].join(';')
    : [v(0), v(1), '[v0][v1]concat=n=2:v=1:a=0[v]'].join(';');
  return [
    '-y', '-v', 'error', '-i', a.file, '-i', b.file, '-filter_complex', graph,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', ...(sound ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '64k'] : []), '-movflags', '+faststart', 'video.mp4',
    ...(sound ? ['-map', '[awav]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav'] : []),
  ];
}

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
export async function ingest(dir: string, source: string, extra?: string): Promise<IngestResult> {
  mkdirSync(resolve(dir, 'frames'), { recursive: true });
  mkdirSync(resolve(dir, 'mosaics'), { recursive: true });
  mkdirSync(resolve(dir, 'work'), { recursive: true });
  mkdirSync(resolve(dir, 'proof'), { recursive: true });
  const src = resolve(dir, sourceName(source));
  if (resolve(source) !== src) copyFileSync(source, src);
  const log: IngestLogLine[] = [];
  const limits: string[] = [];
  const meta1 = await probeMeta(src, dir, log);
  const clips: ClipInfo[] = [{ n: 1, tStart: 0, tEnd: meta1.durationS, file: sourceName(source), sha256: sha256File(src), meta: meta1 }];
  let meta: VideoMeta = meta1;

  if (!extra) {
    // Normalise once so every later command (and Droid) works on one predictable file.
    const audio = meta.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '64k'] : ['-an'];
    const wav = meta.hasAudio ? ['-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav'] : [];
    const vid = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', 'video.mp4', ...wav], dir, 'transcode with audio and WAV extraction');
    if (!vid.ok) throw new Error(`transcode failed: ${vid.stderr.slice(-300)}`);
  } else {
    // The extra clip joins the claim video on one timeline, so every probe, mosaic and timestamp covers both.
    const xsrc = resolve(dir, sourceName(extra, 'extra'));
    if (resolve(extra) !== xsrc) copyFileSync(extra, xsrc);
    const meta2 = await probeMeta(xsrc, dir, log);
    const join = await ff(log, 'ffmpeg', joinArgs({ file: src, meta: meta1 }, { file: xsrc, meta: meta2 }), dir, 'join the claim video and the extra clip');
    if (!join.ok) throw new Error(`joining the extra clip failed: ${join.stderr.slice(-300)}`);
    const joined = await probeMeta('video.mp4', dir, log);
    const boundary = Math.min(meta1.durationS, joined.durationS);
    clips.push({ n: 2, tStart: boundary, tEnd: joined.durationS, file: sourceName(extra, 'extra'), sha256: sha256File(xsrc), meta: meta2 });
    meta = { ...meta1, durationS: joined.durationS, width: joined.width, height: joined.height, fps: joined.fps, rotation: 0, hasAudio: meta1.hasAudio || meta2.hasAudio };
    if (meta1.hasAudio !== meta2.hasAudio) limits.push(`Clip ${meta1.hasAudio ? 2 : 1} has no audio track; that part of the timeline is silent.`);
  }
  writeFileSync(resolve(dir, 'meta.json'), JSON.stringify({ ...meta, clips: clips.map(({ meta: m, ...c }) => ({ ...c, meta: m })) }, null, 2));
  const dur = meta.durationS;
  if (!meta.hasAudio) limits.push('The video has no audio track, so there is no transcript; claims come from the written reason.');

  const uni = await ff(log, 'ffmpeg', ['-y', '-v', 'error', '-i', 'video.mp4', '-vf', `fps=${UNIFORM_FPS},scale=640:-2`, '-q:v', '4', 'frames/u_%04d.jpg'], dir, 'uniform frames');
  const uniform = uni.ok
    ? readdirSync(resolve(dir, 'frames')).filter((f) => f.startsWith('u_')).sort().map((f) => ({ file: `frames/${f}`, t: Math.round(((Number(f.slice(2, 6)) - 1) / UNIFORM_FPS) * 100) / 100 }))
    : [];
  if (!uniform.length) limits.push('Uniform frame sampling failed.');

  const sc = await ff(log, 'ffmpeg', ['-y', '-v', 'info', '-i', 'video.mp4', '-vf', "select='gt(scene,0.25)',showinfo,scale=640:-2", '-vsync', 'vfr', '-q:v', '4', 'frames/s_%04d.jpg'], dir, 'scene changes');
  const sceneTimes = [...sc.stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
  const scenes = readdirSync(resolve(dir, 'frames')).filter((f) => f.startsWith('s_')).sort().map((f, i) => ({ file: `frames/${f}`, t: sceneTimes[i] ?? 0 }));
  if (uniform.length) {
    copyFileSync(resolve(dir, uniform[0]!.file), resolve(dir, 'frames/first.jpg'));
    copyFileSync(resolve(dir, uniform.at(-1)!.file), resolve(dir, 'frames/last.jpg'));
  }

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

  writeFileSync(resolve(dir, 'frames/index.json'), JSON.stringify({ fps: UNIFORM_FPS, durationS: dur, uniform, scenes, first: { file: 'frames/first.jpg', t: 0 }, last: { file: 'frames/last.jpg', t: uniform.at(-1)?.t ?? 0 }, mosaics: mosaics.map((m) => ({ ...m, layout: '3x3, left to right, top to bottom, 0.5 s apart' })) }, null, 2));
  writeFileSync(resolve(dir, 'ingest.log'), log.map((l) => `[exit ${l.exitCode}, ${l.ms} ms]${l.note ? ` ${l.note}:` : ''} ${l.cmd}`).join('\n') + '\n');

  const artifacts: NewArtifact[] = [art(dir, 'video', 'video.mp4', 0, dur, `normalised video, ${meta.width}×${meta.height} → 720p`)];
  if (existsSync(resolve(dir, 'audio.wav'))) artifacts.push(art(dir, 'audio', 'audio.wav', 0, dur, 'audio track, 16 kHz mono'));
  for (const m of mosaics) artifacts.push(art(dir, 'mosaic', m.file, m.tStart, m.tEnd, `contact sheet ${m.file.slice(8, 13)}: ${m.tStart.toFixed(1)}–${m.tEnd.toFixed(1)} s`));
  for (const s of scenes) artifacts.push(art(dir, 'frame', s.file, s.t, s.t, `scene change at ${s.t.toFixed(1)} s`));
  // Always expose a small, evenly spread gallery, even when no finding is made.
  const stride = Math.max(1, Math.ceil(uniform.length / 8));
  for (const [n, f] of uniform.entries()) if (n % stride === 0) artifacts.push(art(dir, 'frame', f.file, f.t, f.t, `sampled frame at ${f.t.toFixed(1)} s`));
  if (existsSync(resolve(dir, 'frames/first.jpg'))) artifacts.push(art(dir, 'frame', 'frames/first.jpg', 0, 0.5, 'first second'));
  if (existsSync(resolve(dir, 'frames/last.jpg'))) artifacts.push(art(dir, 'frame', 'frames/last.jpg', uniform.at(-1)?.t ?? 0, dur, clips.length > 1 ? 'last second of the extra clip (finger challenge)' : 'last second (finger challenge)'));
  if (clips[1]) {
    const start = uniform.find((f) => f.t >= clips[1]!.tStart);
    const label = `extra clip starts (${clips[1].tStart.toFixed(1)} s)`;
    const same = start && artifacts.find((a) => a.path === start.file);
    if (same) same.label = label;
    else if (start) artifacts.push(art(dir, 'frame', start.file, start.t, start.t, label));
  }
  artifacts.push(art(dir, 'log', 'ingest.log', 0, dur, 'every ffmpeg command with exit code and duration'));
  return { meta, clips, sha256: clips[0]!.sha256, uniform, scenes, mosaics, artifacts, log, limits };
}
