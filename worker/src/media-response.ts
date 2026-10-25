import { createReadStream, statSync } from 'node:fs';
import type { FastifyReply } from 'fastify';

/** Call only after path and signed-link checks. Single ranges support Safari and seeking. */
export function sendMedia(reply: FastifyReply, file: string, type: string, range?: string) {
  const size = statSync(file).size;
  reply.type(type).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=600');
  if (!range) return reply.header('Content-Length', size).send(createReadStream(file));
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  const invalid = () => reply.code(416).header('Content-Range', `bytes */${size}`).send();
  if (!m || (!m[1] && !m[2]) || !size) return invalid();
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return invalid();
  return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(file, { start, end }));
}
