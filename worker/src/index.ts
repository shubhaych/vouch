import { createServer } from 'node:http';
import { config } from './env';
import { createMemoryHub } from './hub';
import { onWebhook, type WebhookBody } from './creao';

// Desk Lead entry point. TODO(hour-3 gate): connect to SpacetimeDB with the
// generated bindings (see docs/ARCHITECTURE.md), subscribe to claim,
// vouch_record and config, route events with routeCase(), call startRun(),
// and write results back through reducers. Until then the webhook receiver
// runs against the in-memory hub so the shape can be exercised.
const { hub } = createMemoryHub();

const readBody = async (req: import('node:http').IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200).end('ok'); return; }
  if (req.method === 'POST' && req.url === '/creao/webhook') {
    try {
      const body = JSON.parse(await readBody(req)) as WebhookBody;
      const id = req.headers['x-creao-delivery-id'];
      const status = await onWebhook(hub, Array.isArray(id) ? id[0] : id, body);
      res.writeHead(status).end();
    } catch { res.writeHead(400).end(); }
    return;
  }
  res.writeHead(404).end();
}).listen(config.port, () => console.log(`vouch worker listening on :${config.port} (memory hub, SpacetimeDB not wired)`));
