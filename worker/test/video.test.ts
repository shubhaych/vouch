import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dHash, findReuse, frameMotion, hamming, isBlank, isStill } from '../src/video';

// T2.4 and V09: the same video re-encoded at lower quality still matches; a different video does not.
const dir = mkdtempSync(join(tmpdir(), 'vouch-video-'));
const frame = (src: string, t: number, out: string) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=960:-2', join(dir, out)]);

describe('frame reuse hashing', () => {
  it('matches a re-encoded copy, rejects a different video, and spots blank frames', async () => {
    const a = join(dir, 'a.mp4');
    const b = join(dir, 'b.mp4');
    const black = join(dir, 'black.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '6', '-pix_fmt', 'yuv420p', a]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-vf', 'scale=854:-2', '-crf', '32', join(dir, 'a-low.mp4')]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'life=s=640x480:mold=10:r=15:ratio=0.1:seed=99', '-t', '6', '-pix_fmt', 'yuv420p', b]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=3', '-pix_fmt', 'yuv420p', black]);
    frame(a, 2, 'a.jpg');
    frame(join(dir, 'a-low.mp4'), 2, 'alow.jpg');
    frame(b, 2, 'b.jpg');
    frame(black, 1, 'black.jpg');
    const [ha, hlow, hb, hblack] = await Promise.all(['a.jpg', 'alow.jpg', 'b.jpg', 'black.jpg'].map((f) => dHash(join(dir, f))));
    expect(hamming(ha!, hlow!)).toBeLessThanOrEqual(6);
    expect(hamming(ha!, hb!)).toBeGreaterThan(6);
    expect(isBlank(hblack!)).toBe(true);
    expect(findReuse([hlow!], 2n, [{ id: 1n, frameHashes: [ha!] }])[0]).toMatchObject({ matches_claim: 'C-1' });
    // Blank frames match each other but are not evidence of reuse.
    expect(findReuse([hblack!], 2n, [{ id: 1n, frameHashes: [hblack!] }])).toEqual([]);
  });

  it('QA-003 a slideshow of one still image reads as little motion; a moving clip does not', async () => {
    const still = join(dir, 'still.mp4');
    const moving = join(dir, 'moving.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=1280x720', '-frames:v', '1', join(dir, 'listing.jpg')]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', join(dir, 'listing.jpg'), '-t', '8', '-vf', "zoompan=z='min(zoom+0.0015,1.3)':d=200:s=1280x720", '-pix_fmt', 'yuv420p', still]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'life=s=480x360:mold=10:r=24:ratio=0.12:seed=7919', '-t', '8', '-pix_fmt', 'yuv420p', moving]);
    const hashesOf = async (src: string, tag: string) => {
      const out: string[] = [];
      for (const t of [0.2, 1, 2, 3, 4, 5, 6, 7.5]) { frame(src, t, `${tag}-${t}.jpg`); out.push(await dHash(join(dir, `${tag}-${t}.jpg`))); }
      return out;
    };
    const s1 = await hashesOf(still, 's');
    const m1 = await hashesOf(moving, 'm');
    expect(isStill(frameMotion(s1))).toBe(true);
    expect(isStill(frameMotion(m1))).toBe(false);
    // Blank frames say nothing about motion: a black clip is handled by the blank-frame check instead.
    expect(frameMotion(['0000000000000000', '0000000000000000'])).toBeNull();
  });
});
