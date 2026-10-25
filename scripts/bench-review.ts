// Local synthetic media only. No database, model calls, keys or network.
// Run before/after changes: npx tsx scripts/bench-review.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { frameTimes, dHash, extractUploadFrames } from '../worker/src/video';
import { ingest } from '../worker/src/review/ingest';
import { integrityLane } from '../worker/src/review/lanes';

const dir = mkdtempSync(join(tmpdir(), 'vouch-bench-'));
try {
  const video = join(dir, 'upload.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', video]);
  const t0 = performance.now();
  const times = await frameTimes(video, 12);
  if (process.argv.includes('--serial')) for (const [i, t] of times.entries()) {
    const out = join(dir, `${i}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', out]);
    await dHash(out);
  } else await extractUploadFrames(video, dir, times);
  const uploadMs = performance.now() - t0;
  const t1 = performance.now();
  const ing = await ingest(join(dir, 'case'), video);
  const ingestMs = performance.now() - t1;
  const t2 = performance.now();
  await integrityLane(join(dir, 'case'), ing, {}, 2, new Date());
  console.log(JSON.stringify({ fixture: 'synthetic 12s 720p + sine (not speech)', uploadProcessingMs: Math.round(uploadMs), ingestMs: Math.round(ingestMs), integrityMs: Math.round(performance.now() - t2), ingestCommands: ing.log.length }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
