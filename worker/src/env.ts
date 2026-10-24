// Server-side only. Never import this from web/: it reads capi_ keys.
export const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

export const config = {
  port: Number(process.env.WORKER_PORT ?? 8787),
  stdbUri: process.env.STDB_URI ?? 'ws://localhost:3000',
  stdbDb: process.env.STDB_DB ?? 'vouch',
  stdbToken: process.env.STDB_TOKEN || undefined,
  creaoEnabled: process.env.CREAO_ENABLED !== 'false',
  creaoWebhookUrl: process.env.CREAO_WEBHOOK_URL ?? '',
};
