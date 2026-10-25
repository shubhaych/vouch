import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { sendMedia } from '../src/media-response';

// Safari will not play or seek a video unless the server answers Range requests.
const dir = mkdtempSync(join(tmpdir(), 'vouch-media-'));
const file = join(dir, 'a.bin');
writeFileSync(file, Buffer.from('0123456789'));

const app = Fastify();
app.get('/m', async (req, reply) => sendMedia(reply, file, 'video/mp4', req.headers.range));

describe('sendMedia', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const r = await app.inject('/m');
    expect(r.statusCode).toBe(200);
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.body).toBe('0123456789');
  });

  it('serves a byte range, an open-ended range and a suffix range', async () => {
    const get = (range: string) => app.inject({ url: '/m', headers: { range } });
    const a = await get('bytes=2-4');
    expect([a.statusCode, a.body, a.headers['content-range']]).toEqual([206, '234', 'bytes 2-4/10']);
    const b = await get('bytes=7-');
    expect([b.statusCode, b.body]).toEqual([206, '789']);
    const c = await get('bytes=-3');
    expect([c.statusCode, c.body]).toEqual([206, '789']);
  });

  it('refuses ranges outside the file', async () => {
    for (const range of ['bytes=10-12', 'bytes=5-2', 'bytes=-', 'items=1-2']) {
      const r = await app.inject({ url: '/m', headers: { range } });
      expect(r.statusCode, range).toBe(416);
      expect(r.headers['content-range']).toBe('bytes */10');
    }
  });
});
