// Phone video → frames → deterministic checks → attachVideo. Cheap,
// explainable checks run before any agent: freshness (the nonce window),
// duration and resolution, frame reuse across claims (64-bit dHash within
// distance 6), and policy fit. Frames are served at signed, expiring URLs so
// CREAO can fetch them through the tunnel and nobody else can list them.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DbConnection } from '../module_bindings/index';
import { config, log } from './env';
import { mirrorOf } from './mirror';

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

export function signPath(path: string, now = Date.now()): string {
  const exp = now + URL_TTL_MS;
  const sig = createHmac('sha256', mediaSecret()).update(`${path}|${exp}`).digest('hex').slice(0, 32);
  return `${config.publicUrl}${path}?exp=${exp}&sig=${sig}`;
}

export function checkSignature(path: string, exp: string, sig: string, now = Date.now()): boolean {
  if (!exp || !sig || Number(exp) < now) return false;
  const want = createHmac('sha256', mediaSecret()).update(`${path}|${exp}`).digest('hex').slice(0, 32);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

export class UploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Probe { duration: number; width: number; height: number }

export async function probe(file: string): Promise<Probe> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const s = j.streams?.[0];
    const duration = Number(j.format?.duration ?? 0);
    if (!s || !s.width || !s.height || !Number.isFinite(duration) || duration <= 0) throw new Error('no video stream');
    return { duration, width: s.width, height: s.height };
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
}

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

/** Handles one upload end to end. Throws UploadError with a message the phone shows. */
export async function processUpload(conn: DbConnection, claimId: bigint, nonce: string, data: Buffer, ext: string, now = Date.now()): Promise<{ frames: number; checks: Checks }> {
  // A claim created a moment ago may still be on its way to this worker's subscription.
  let c = conn.db.claim.id.find(claimId);
  for (let i = 0; !c && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    c = conn.db.claim.id.find(claimId);
  }
  if (!c) throw new UploadError(404, 'No such claim.');
  if (!nonce || nonce !== c.nonce) throw new UploadError(403, 'This upload link is not valid for that claim (wrong nonce).');
  if (c.status !== 'awaiting_video' && c.status !== 'more_evidence') throw new UploadError(409, `This claim is ${c.status.replace('_', ' ')} and does not need a video.`);
  const age = now - Number(c.createdAt.microsSinceUnixEpoch / 1000n);
  if (c.status === 'awaiting_video' && age > STALE_AFTER_MS) throw new UploadError(410, 'This claim link expired (more than 10 minutes old). Open the claim again to get a fresh challenge.');
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError(413, 'That video is too large. Please record again at a lower quality.');
  if (data.length < 1000) throw new UploadError(422, 'We could not read that video. Please record it again in the app.');

  const dir = resolve(config.mediaDir, String(claimId));
  mkdirSync(dir, { recursive: true });
  const video = resolve(dir, `video.${ext.replace(/[^a-z0-9]/gi, '') || 'mp4'}`);
  writeFileSync(video, data);
  const p = await probe(video);
  if (p.duration < MIN_SECONDS) throw new UploadError(422, `That video is ${p.duration.toFixed(1)} seconds. Please record at least ${MIN_SECONDS} seconds, ending with the finger challenge.`);

  const times = await frameTimes(video, p.duration);
  const frameUrls: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const out = resolve(dir, `${i}.jpg`);
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(times[i]), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', out]);
    if (!existsSync(out)) continue;
    hashes.push(await dHash(out));
    frameUrls.push(signPath(`/media/${claimId}/${i}.jpg`));
  }
  if (frameUrls.length < 2) throw new UploadError(422, 'We could not extract frames from that video. Please record it again.');

  const others = [...conn.db.claim.iter()].filter((x) => x.frameHashes.length > 0).map((x) => ({ id: x.id, frameHashes: x.frameHashes }));
  const m = mirrorOf(conn);
  const refund = m.refunds.get(c.refundId);
  const purchase = refund ? m.purchases.get(refund.purchaseId) : undefined;
  const business = refund ? conn.db.business.id.find(refund.businessId) : undefined;
  const policy = business ? (JSON.parse(business.policy) as { windowDays: number; needsVideoOverCents: number }) : { windowDays: 30, needsVideoOverCents: 10_000 };
  const withinWindow = !!refund && !!purchase && refund.day - purchase.deliverDay <= policy.windowDays;
  const checks: Checks = {
    fresh: age <= STALE_AFTER_MS,
    uploaded_after_s: Math.round(age / 1000),
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
  };
  await conn.reducers.attachVideo({ claimId, videoUrl: signPath(`/media/${claimId}/${video.split('/').pop()}`), frameUrls, frameHashes: hashes, checksJson: JSON.stringify(checks) });
  log(`C-${claimId}: ${frameUrls.length} frames, ${p.duration.toFixed(1)} s ${p.width}x${p.height}, reuse ${checks.frame_reuse.map((r) => r.matches_claim).join(',') || 'none'}`);
  return { frames: frameUrls.length, checks };
}
