// The worker process: privileged SpacetimeDB identities plus the HTTP routes
// the phone and CREAO need. Everything slow, secret or heavy happens here.
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config, log } from './env';
import { connect } from './stdb';
import { handleWebhook, resolveAgents } from './creao';
import { Orchestrator } from './orchestrator';
import { DetectorRunner } from './detectors';
import { Poster } from './poster';
import { Credentials } from './credentials';
import { MAX_UPLOAD_BYTES, UploadError, checkSignature, processUpload } from './video';
import { LabRunner } from './lab';
import { Showcase } from './showcase';
import { mirrorOf } from './mirror';

const WORKER_QUERIES = [
  'SELECT * FROM sim_run', 'SELECT * FROM metrics', 'SELECT * FROM control', 'SELECT * FROM agent', 'SELECT * FROM business',
  'SELECT * FROM purchase', 'SELECT * FROM refund', 'SELECT * FROM claim', 'SELECT * FROM evidence', 'SELECT * FROM agent_run',
  'SELECT * FROM decision', 'SELECT * FROM fraud_pattern', 'SELECT * FROM pattern_event', 'SELECT * FROM credential',
  'SELECT * FROM verification', 'SELECT * FROM lab_job',
];

async function main() {
  log(`connecting to ${config.stdbUri}/${config.stdbDb}`);
  const { conn } = await connect('worker', WORKER_QUERIES, 120_000);
  mirrorOf(conn); // index purchase, refund and agent before anything reads them
  const poster = await connect('poster', ['SELECT * FROM decision']);
  await conn.reducers.setSeatCodes({ businessCode: config.demoBusinessCode, controllerCode: config.demoControllerCode }).catch((e: Error) => log('seat codes:', e.message));

  const run = conn.db.simRun.id.find(1);
  if (!run?.seeded) {
    log(`seeding world: seed ${config.seed}, ${config.population} agents`);
    await conn.reducers.seedWorld({ seed: config.seed, population: config.population, force: false });
  } else {
    log(`world: day ${run.day}, ${run.population} agents, running=${run.running}`);
  }

  if (config.creao.mode === 'live') {
    try { await resolveAgents(); } catch (e) { log(`CREAO live mode is not ready: ${(e as Error).message}. Claims will wait as "investigator offline" until fixed.`); }
  }

  const credentials = new Credentials(conn);
  await credentials.start();
  const orchestrator = new Orchestrator(conn, (agentId, refundId, verifier) => credentials.check(agentId, refundId, verifier));
  orchestrator.start();
  new DetectorRunner(conn).start();
  new Poster(poster.conn).start();
  const lab = new LabRunner(conn);
  lab.start();
  const showcase = new Showcase(conn, credentials);
  showcase.orchestrator = orchestrator;
  showcase.start();

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.get('/health', async () => ({ ok: true, mode: config.creao.mode, day: conn.db.simRun.id.find(1)?.day ?? null }));

  // The phone uploads here, never to SpacetimeDB. The nonce ties the upload to the claim's challenge.
  app.post<{ Params: { claimId: string }; Querystring: { nonce?: string } }>('/upload/:claimId', async (req, reply) => {
    try {
      const file = await req.file();
      if (!file) throw new UploadError(400, 'No video in the upload.');
      const data = await file.toBuffer();
      const ext = (file.filename.split('.').pop() || file.mimetype.split('/').pop() || 'mp4').toLowerCase();
      const res = await processUpload(conn, BigInt(req.params.claimId), req.query.nonce ?? '', data, ext);
      return { ok: true, frames: res.frames, checks: res.checks };
    } catch (e) {
      const status = e instanceof UploadError ? e.status : (e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 500;
      if (status === 500) log('upload failed', (e as Error).message);
      return reply.code(status).send({ ok: false, error: status === 413 ? 'That video is too large. Please record again at a lower quality.' : (e as Error).message });
    }
  });

  // Signed, expiring frame and video URLs (CREAO fetches them through the tunnel).
  app.get<{ Params: { claimId: string; file: string }; Querystring: { exp?: string; sig?: string } }>('/media/:claimId/:file', async (req, reply) => {
    const path = `/media/${req.params.claimId}/${req.params.file}`;
    if (!/^\d+$/.test(req.params.claimId) || !/^[\w.]+$/.test(req.params.file) || !checkSignature(path, req.query.exp ?? '', req.query.sig ?? '')) {
      return reply.code(403).send({ error: 'link expired or not signed' });
    }
    const file = resolve(config.mediaDir, req.params.claimId, req.params.file);
    if (!existsSync(file)) return reply.code(404).send({ error: 'not found' });
    const type = file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.webm') ? 'video/webm' : file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    return reply.type(type).header('Cache-Control', 'private, max-age=600').send(createReadStream(file));
  });

  // CREAO webhooks (laptop only; at least once, answered fast, deduped).
  app.post<{ Body: Record<string, unknown> }>('/creao/webhook', async (req, reply) => {
    const status = handleWebhook(req.headers['x-creao-delivery-id'] as string | undefined, req.body as never);
    return reply.code(status).send({ ok: status === 200 });
  });

  // The home page's "Watch it live" and /system's benchmark need the controller code: they spend credits or CPU.
  app.post<{ Body: { code?: string } }>('/showcase/run', async (req, reply) => {
    if (req.body?.code !== config.demoControllerCode) return reply.code(403).send({ error: 'controller code required' });
    const started = showcase.runNow({ live: true });
    return { ok: started, message: started ? 'Showcase run started' : 'A showcase run is already in progress' };
  });
  app.post('/bench', async () => ({ message: 'Run `npx tsx scripts/bench.ts` on the worker machine: it publishes throwaway databases and writes results to bench_result.' }));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log(`worker listening on :${config.port} (public URL ${config.publicUrl})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
