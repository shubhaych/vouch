import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DbConnection } from '../module_bindings/index';
import { config } from '../src/env';
import { processUpload, UploadError, type Checks } from '../src/video';

// A claim holds its video plus at most one extra clip. The worker is the only identity that can
// attach video, so processUpload is the gate: the extra clip is kept beside the first, its frames
// are appended, and a third upload is refused.
// These generated clips have no hand in them; the finger check (a Droid call) is covered on its own in fingers.test.ts.
process.env.FINGER_CHECK = '0';
const IDS = [990_001n, 990_002n, 990_003n];
const tmp = mkdtempSync(resolve(tmpdir(), 'vouch-clips-'));
const clip = (name: string, audio: boolean) => {
  const out = resolve(tmp, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=24', ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=16000'] : []), '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', ...(audio ? ['-c:a', 'aac'] : []), out]);
  return readFileSync(out);
};
const withSound = clip('a.mp4', true);
const silent = clip('b.mp4', false);

const now = Date.now();
const ts = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });
function fakeConn(claim: Record<string, unknown>) {
  const attached: { checksJson: string; frameUrls: string[]; frameHashes: string[]; videoUrl: string }[] = [];
  const table = (rows: unknown[]) => ({ iter: () => rows[Symbol.iterator](), id: { find: (id: unknown) => rows.find((r) => (r as { id: unknown }).id === id) }, onInsert() {}, onUpdate() {}, onDelete() {} });
  const conn = {
    db: {
      claim: table([claim]), decision: table([{ id: 1n, refundId: 7n, at: ts(now - 60_000) }]), business: table([]),
      purchase: table([]), refund: table([]), agent: table([]),
    },
    reducers: { attachVideo: async (a: (typeof attached)[number]) => { attached.push(a); } },
  } as unknown as DbConnection;
  return { conn, attached };
}
const claim = (id: bigint, over: Record<string, unknown>) => ({
  id, refundId: 7n, nonce: 'n', status: 'awaiting_video', videoUrl: '', frameUrls: [] as string[], frameHashes: [] as string[], checksJson: '{}', createdAt: ts(now - 60_000), ...over,
});

afterAll(() => {
  for (const id of IDS) rmSync(resolve(config.mediaDir, String(id)), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe('claim video and the one extra clip', () => {
  it('a first upload is clip 1 and records whether it has sound', async () => {
    const { conn, attached } = fakeConn(claim(IDS[0]!, {}));
    await processUpload(conn, IDS[0]!, 'n', silent, 'mp4');
    const checks = JSON.parse(attached[0]!.checksJson) as Checks;
    expect(checks.clips).toBe(1);
    expect(checks.has_audio).toBe(false);
    expect(existsSync(resolve(config.mediaDir, String(IDS[0]), 'video.mp4'))).toBe(true);
  });

  it('a claim sent back for more evidence takes one extra clip beside the first', async () => {
    const first = { clips: 1, frame_reuse: [], fresh: true };
    const { conn, attached } = fakeConn(claim(IDS[1]!, { status: 'more_evidence', videoUrl: 'https://w/media/990002/video.mp4', frameUrls: ['f0'], frameHashes: ['ff00ff00ff00ff00'], checksJson: JSON.stringify(first) }));
    await processUpload(conn, IDS[1]!, 'n', withSound, 'mp4');
    const a = attached[0]!;
    const checks = JSON.parse(a.checksJson) as Checks;
    expect(checks.clips).toBe(2);
    expect(checks.has_audio).toBe(true);
    expect(checks.first?.fresh).toBe(true);
    expect(checks.fresh).toBe(true); // counted from the request a minute ago, not from the claim
    expect(a.frameUrls[0]).toBe('f0');
    expect(a.frameUrls.length).toBeGreaterThan(2);
    expect(a.frameHashes[0]).toBe('ff00ff00ff00ff00');
    expect(a.videoUrl).toContain('/media/990002/extra.mp4');
    expect(readdirSync(resolve(config.mediaDir, String(IDS[1])))).toContain('extra.mp4');
  });

  it('refuses a second extra clip', async () => {
    const { conn, attached } = fakeConn(claim(IDS[2]!, { status: 'more_evidence', videoUrl: 'https://w/media/990003/extra.mp4', checksJson: JSON.stringify({ clips: 2 }) }));
    const err = await processUpload(conn, IDS[2]!, 'n', withSound, 'mp4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).status).toBe(409);
    expect(attached).toHaveLength(0);
    expect(existsSync(resolve(config.mediaDir, String(IDS[2])))).toBe(false);
  });
});
