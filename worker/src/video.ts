// Phone video → frames → deterministic checks → attachVideo. Cheap,
// explainable checks run before any agent: freshness (the nonce window),
// duration and resolution, frame reuse across claims (64-bit dHash within
// distance 6), and policy fit. Frames are served at signed, expiring URLs so
// CREAO can fetch them through the tunnel and nobody else can list them.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DbConnection } from '../module_bindings/index';
import { config, log } from './env';
import { mirrorOf } from './mirror';
import { checkFingers, fingerMessage } from './fingers';

const run = promisify(execFile);
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
export const STALE_AFTER_MS = 10 * 60_000;
export const MIN_SECONDS = 4;
export const REUSE_DISTANCE = 6;
const URL_TTL_MS = 2 * 60 * 60_000;

let secret = config.mediaSecret;
function mediaSecret(): string {
  if (secret) return secret;
  const f = resolve(config.keysDir, 'media-secret');
  if (existsSync(f)) secret = readFileSync(f, 'utf8').trim();
  else {
    secret = randomBytes(32).toString('hex');
    mkdirSync(config.keysDir, { recursive: true });
    writeFileSync(f, secret, { mode: 0o600 });
  }
  return secret;
}

export function signPath(path: string, now = Date.now(), ttlMs = URL_TTL_MS): string {
  const exp = now + ttlMs;
  const sig = createHmac('sha256', mediaSecret()).update(`${path}|${exp}`).digest('hex').slice(0, 32);
  return `${config.publicUrl}${path}?exp=${exp}&sig=${sig}`;
}

export function checkSignature(path: string, exp: string, sig: string, now = Date.now()): boolean {
  if (!exp || !sig || Number(exp) < now) return false;
  const want = createHmac('sha256', mediaSecret()).update(`${path}|${exp}`).digest('hex').slice(0, 32);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

export class UploadError extends Error {
  /** `code` tells the phone what to do: 'fingers' means record a new video. */
  constructor(public status: number, message: string, public code?: 'fingers') { super(message); }
}

export interface Probe { duration: number; width: number; height: number; hasAudio: boolean }

export async function probe(file: string): Promise<Probe> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]);
    const j = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
    const s = j.streams?.find((x) => x.codec_type === 'video');
    const duration = Number(j.format?.duration ?? 0);
    if (!s || !s.width || !s.height || !Number.isFinite(duration) || duration <= 0) throw new Error('no video stream');
    return { duration, width: s.width, height: s.height, hasAudio: !!j.streams?.some((x) => x.codec_type === 'audio') };
  } catch {
    throw new UploadError(422, 'We could not read that video. Please record it again in the app.');
  }
}

/** Scene-change times plus fixed grabs, always including the first and the last second (the finger challenge), 8 to 10 frames. */
export async function frameTimes(file: string, duration: number): Promise<number[]> {
  let scenes: number[] = [];
  try {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 });
    scenes = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.6 && t < duration - 0.6);
  } catch { /* fall back to even spacing */ }
  const first = Math.min(0.5, duration / 4);
  const last = Math.max(duration - 0.5, duration * 0.75);
  const times = [first, ...scenes.slice(0, 6), last];
  const target = 9;
  for (let i = 1; times.length < target && i < 20; i++) times.push((duration * i) / 10);
  const uniq = [...new Set(times.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b);
  // Keep first and last, thin the middle to at most 10.
  while (uniq.length > 10) uniq.splice(1 + Math.floor((uniq.length - 2) / 2), 1);
  return uniq;
}

/** 64-bit difference hash: a 9×8 greyscale thumbnail, one bit per left/right brightness step. Robust to re-encoding and scaling. */
export async function dHash(jpg: string): Promise<string> {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', jpg, '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  const px = stdout as unknown as Buffer;
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export const hamming = (a: string, b: string): number => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
};

export interface ReuseMatch { frame: number; matches_claim: string; matches_frame: number; distance: number }

/** Every frame against every frame of every other claim. A few hundred claims × 10 frames is instant. */
export function findReuse(hashes: string[], claimId: bigint, others: { id: bigint; frameHashes: string[] }[]): ReuseMatch[] {
  const out: ReuseMatch[] = [];
  for (const o of others) {
    if (o.id === claimId) continue;
    let best: ReuseMatch | null = null;
    hashes.forEach((h, i) => o.frameHashes.forEach((oh, j) => {
      const d = hamming(h, oh);
      // A blank or flat frame hashes to nearly all zeros and would match every other blank frame; it is not evidence of reuse.
      if (d <= REUSE_DISTANCE && h !== '0000000000000000' && (!best || d < best.distance)) best = { frame: i, matches_claim: `C-${o.id}`, matches_frame: j, distance: d };
    }));
    if (best) out.push(best);
  }
  return out;
}

export interface Checks {
  fresh: boolean; uploaded_after_s: number; duration_s: number; width: number; height: number; duration_ok: boolean; resolution_ok: boolean;
  frame_reuse: ReuseMatch[]; frame_times: number[]; blank_frames: number; frame_motion: number | null; still_image: boolean; within_window: boolean; reason_allowed: boolean; over_video_threshold: boolean; policy_line: string;
  /** 1 = the claim video, 2 = the one extra clip a customer may add when more evidence is needed. */
  clips: 1 | 2; has_audio: boolean;
  /** The quick check made while the phone waited; 'unsure' means it let the upload through. */
  finger_check?: { verdict: string; seen: number | null; ms: number };
  /** For clip 2: when the extra clip was requested (ISO), and the first clip's checks. */
  extra_requested_at?: string; first?: Omit<Checks, 'first'>;
}

/** A customer may add exactly one clip after the claim video. Only the worker can attach video, so this is the gate. */
export const MAX_CLIPS = 2;
export const EXTRA_STALE_AFTER_MS = 30 * 60_000;

/** A flat frame (black, white, a lens cap) has no left/right brightness steps, so its dHash is (almost) all zeros. */
export const isBlank = (h: string) => hamming(h, '0000000000000000') <= 2;

/**
 * Median dHash distance between consecutive non-blank frames, or null with fewer than two.
 * A phone filming an item moves (about 16 on our clips); a slideshow of one photo barely
 * changes (about 2), and neither does a test pattern (0).
 */
export function frameMotion(hashes: string[]): number | null {
  const live = hashes.filter((h) => !isBlank(h));
  if (live.length < 2) return null;
  const d = live.slice(1).map((h, i) => hamming(h, live[i]!)).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}
export const STILL_MOTION_MAX = 3;
/** Little motion is a reason for more evidence, never a decline: a steady, honest shot can be still too. */
export const isStill = (motion: number | null) => motion !== null && motion <= STILL_MOTION_MAX;

/** Bounded parallelism, retaining the same selected frames and hash algorithm. */
export async function extractUploadFrames(video: string, dir: string, times: number[], prefix = '') {
  const frames: { index: number; time: number; hash: string; file: string }[] = [];
  for (let i = 0; i < times.length; i += 3) {
    const batch = await Promise.all(times.slice(i, i + 3).map(async (time, j) => {
      const index = i + j;
      const file = `${prefix}${index}.jpg`;
      const out = resolve(dir, file);
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', out], { timeout: 30_000 });
      return { index, time, hash: await dHash(out), file };
    }));
    frames.push(...batch);
  }
  return frames;
}

/** Handles one upload end to end. Throws UploadError with a message the phone shows. */
export async function processUpload(conn: DbConnection, claimId: bigint, nonce: string, data: Buffer, ext: string, now = Date.now()): Promise<{ frames: number; checks: Checks }> {
  const processingStarted = Date.now();
  // A claim created a moment ago may still be on its way to this worker's subscription; under a busy simulation the
  // subscription can trail by several seconds, so wait up to 20 s before giving up.
  let c = conn.db.claim.id.find(claimId);
  for (let i = 0; !c && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    c = conn.db.claim.id.find(claimId);
  }
  if (!c) {
    log(`upload for C-${claimId}: claim not in this worker's subscription after 20 s`);
    throw new UploadError(404, 'This claim has not reached the reviewer yet. Wait a few seconds and upload again.');
  }
  if (!nonce || nonce !== c.nonce) throw new UploadError(403, 'This upload link is not valid for that claim (wrong nonce).');
  if (c.status !== 'awaiting_video' && c.status !== 'more_evidence') throw new UploadError(409, `This claim is ${c.status.replace('_', ' ')} and does not need a video.`);
  const age = now - Number(c.createdAt.microsSinceUnixEpoch / 1000n);
  if (c.status === 'awaiting_video' && age > STALE_AFTER_MS) throw new UploadError(410, 'This claim link expired (more than 10 minutes old). Open the claim again to get a fresh challenge.');
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError(413, 'That video is too large. Please record again at a lower quality.');
  if (data.length < 1000) throw new UploadError(422, 'We could not read that video. Please record it again in the app.');

  // A claim already holding a video that is back at more_evidence is getting its one extra clip.
  const prior = JSON.parse(c.checksJson || '{}') as Partial<Checks>;
  const clip: 1 | 2 = c.status === 'more_evidence' && !!c.videoUrl ? 2 : 1;
  if (clip === 2 && (prior.clips ?? 1) >= MAX_CLIPS) throw new UploadError(409, 'You have already sent your one extra clip. A person at the store will review your claim.');

  const dir = resolve(config.mediaDir, String(claimId));
  mkdirSync(dir, { recursive: true });
  const video = resolve(dir, `${clip === 2 ? 'extra' : 'video'}.${ext.replace(/[^a-z0-9]/gi, '') || 'mp4'}`);
  writeFileSync(video, data);
  const p = await probe(video);
  if (p.duration < MIN_SECONDS) throw new UploadError(422, `That video is ${p.duration.toFixed(1)} seconds. Please record at least ${MIN_SECONDS} seconds, ending with the finger challenge.`);

  // The finger challenge is checked alongside the frames: a clear miss sends the phone back to record
  // again, and the rejected file never counts as the claim video or the one extra clip.
  const [times, fingers] = await Promise.all([frameTimes(video, p.duration), checkFingers(video, p.duration, c.fingerCount, dir)]);
  const miss = fingerMessage(fingers, c.fingerCount);
  log(`C-${claimId}: finger check ${fingers.verdict} (${fingers.note}) in ${fingers.ms} ms`);
  if (miss) {
    rmSync(video, { force: true });
    throw new UploadError(422, miss, 'fingers');
  }
  const frames = await extractUploadFrames(video, dir, times, clip === 2 ? 'x' : '');
  const newUrls = frames.map((f) => signPath(`/media/${claimId}/${f.file}`));
  const hashes = frames.map((f) => f.hash);
  if (newUrls.length < 2) throw new UploadError(422, 'We could not extract frames from that video. Please record it again.');
  // Clip 2 appends its frames, so later claims are checked for reuse of either clip.
  const frameUrls = clip === 2 ? [...c.frameUrls, ...newUrls] : newUrls;
  const frameHashes = clip === 2 ? [...c.frameHashes, ...hashes] : hashes;
  // The extra clip's freshness counts from when it was requested (the latest proposal), not from the claim.
  const requestedAt = clip === 2 ? [...conn.db.decision.iter()].filter((d) => d.refundId === c!.refundId).reduce((t, d) => Math.max(t, Number(d.at.microsSinceUnixEpoch / 1000n)), 0) : 0;
  const since = clip === 2 && requestedAt ? now - requestedAt : age;

  const others = [...conn.db.claim.iter()].filter((x) => x.frameHashes.length > 0).map((x) => ({ id: x.id, frameHashes: x.frameHashes }));
  const m = mirrorOf(conn);
  const refund = m.refunds.get(c.refundId);
  const purchase = refund ? m.purchases.get(refund.purchaseId) : undefined;
  const business = refund ? conn.db.business.id.find(refund.businessId) : undefined;
  const policy = business ? (JSON.parse(business.policy) as { windowDays: number; needsVideoOverCents: number }) : { windowDays: 30, needsVideoOverCents: 10_000 };
  const withinWindow = !!refund && !!purchase && refund.day - purchase.deliverDay <= policy.windowDays;
  const checks: Checks = {
    fresh: since <= (clip === 2 ? EXTRA_STALE_AFTER_MS : STALE_AFTER_MS),
    uploaded_after_s: Math.round(since / 1000),
    duration_s: Math.round(p.duration * 10) / 10,
    width: p.width,
    height: p.height,
    duration_ok: p.duration >= MIN_SECONDS && p.duration <= 30,
    resolution_ok: Math.min(p.width, p.height) >= 480,
    frame_reuse: findReuse(hashes, claimId, others),
    frame_times: times,
    blank_frames: hashes.filter(isBlank).length,
    frame_motion: frameMotion(hashes),
    still_image: isStill(frameMotion(hashes)),
    within_window: withinWindow,
    reason_allowed: refund?.reasonCode !== 'changed_mind' || policy.windowDays >= 14,
    over_video_threshold: !!refund && refund.amount > policy.needsVideoOverCents,
    policy_line: `${policy.windowDays}-day window; video required over $${(policy.needsVideoOverCents / 100).toFixed(0)}`,
    clips: clip,
    has_audio: p.hasAudio,
    finger_check: { verdict: fingers.verdict, seen: fingers.seen, ms: fingers.ms },
    ...(clip === 2 ? { ...(requestedAt ? { extra_requested_at: new Date(requestedAt).toISOString() } : {}), first: (({ first: _f, ...rest }) => rest)(prior as Checks) } : {}),
  };
  await conn.reducers.attachVideo({ claimId, videoUrl: signPath(`/media/${claimId}/${video.split('/').pop()}`), frameUrls, frameHashes, checksJson: JSON.stringify(checks) });
  log(`C-${claimId}: clip ${clip}, ${newUrls.length} frames, ${p.duration.toFixed(1)} s ${p.width}x${p.height}, ${p.hasAudio ? 'with' : 'NO'} audio, reuse ${checks.frame_reuse.map((r) => r.matches_claim).join(',') || 'none'}, server preparation ${Date.now() - processingStarted} ms (excludes network transfer)`);
  return { frames: newUrls.length, checks };
}
