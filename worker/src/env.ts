// Server-side configuration. Never import this from web/: it reads keys.
// Keys come from the environment (cloud) or a git-ignored .env (laptop).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

function loadDotEnv() {
  const p = resolve(REPO_ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*?)\s*(?:#.*)?$/);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!;
  }
}
loadDotEnv();

const str = (k: string, d = '') => process.env[k]?.trim() || d;

export const config = {
  port: Number(str('WORKER_PORT', '8787')),
  publicUrl: str('WORKER_PUBLIC_URL', str('NEXT_PUBLIC_WORKER_URL', `http://localhost:${str('WORKER_PORT', '8787')}`)),
  stdbUri: str('STDB_URI', 'ws://localhost:3011'),
  stdbDb: str('STDB_DB', 'vouch'),
  stdbWorkerToken: str('STDB_WORKER_TOKEN') || str('STDB_TOKEN'),
  keysDir: resolve(REPO_ROOT, 'worker/.keys'),
  mediaDir: resolve(REPO_ROOT, 'worker/media'),
  mediaSecret: str('MEDIA_SIGNING_SECRET'),
  demoBusinessCode: str('DEMO_BUSINESS_CODE', 'vouch-business'),
  demoControllerCode: str('DEMO_CONTROLLER_CODE', 'vouch-controller'),
  issuerKeysPath: resolve(REPO_ROOT, str('ISSUER_KEYS_PATH', 'worker/.keys/issuers.json')),
  creao: {
    // One account key (cr_sk_) for all agents, or app-scoped capi_ keys.
    apiKey: str('CREAO_API_KEY') || str('CREAO_CAPI_KEY'),
    mode: (str('CREAO_MODE', 'fixture') === 'live' ? 'live' : 'fixture') as 'live' | 'fixture',
    dailyRunLimit: Number(str('CREAO_DAILY_RUN_LIMIT', '40')),
    webhookUrl: str('CREAO_WEBHOOK_URL'),
    agentIds: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_AGENT_ID'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_AGENT_ID'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_AGENT_ID'),
    },
    // App path only: per-seat app id and key (capi_ keys are scoped to one agent).
    appIds: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_APP_ID'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_APP_ID'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_APP_ID'),
    },
    appKeys: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_KEY'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_KEY'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_KEY'),
    },
    pollMs: Number(str('CREAO_POLL_MS', '15000')),
  },
  factoryKey: str('FACTORY_API_KEY'),
  seed: BigInt(str('SIM_SEED', '11')),
  population: Number(str('SIM_POPULATION', '10000')),
};

export type Seat = keyof typeof config.creao.agentIds;
export const SEATS: Seat[] = ['evidence_analyst', 'refund_investigator', 'pattern_analyst'];

export const log = (...xs: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...xs);
