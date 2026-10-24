import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dHash, findReuse, hamming, isBlank } from '../src/video';

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
});
