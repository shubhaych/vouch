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
  // The video reviewer: one case folder per claim (git-ignored) and the probe scripts Droid may run read-only.
  casesDir: resolve(REPO_ROOT, 'worker/cases'),
  toolsDir: resolve(REPO_ROOT, 'worker/tools'),
  review: {
    enabled: str('REVIEW_ENABLED', '1') !== '0',
    maxDroidSessionsPerHour: Number(str('MAX_DROID_SESSIONS_PER_HOUR', '20')),
    whisperModel: str('WHISPER_MODEL', 'small'),
    python: str('REVIEW_PYTHON', existsSync(resolve(REPO_ROOT, '.venv-review/bin/python3')) ? resolve(REPO_ROOT, '.venv-review/bin/python3') : 'python3'),
    droidClaims: str('REVIEW_DROID_CLAIMS', '0') === '1',
    sessionLimitMs: Number(str('REVIEW_SESSION_LIMIT_MS', String(6 * 60_000))),
    // The Proof Builder runs as a third Droid session only when asked; by default the worker cuts the clips itself (same output, no credits).
    droidProof: str('REVIEW_DROID_PROOF', '0') === '1',
    // The Report Auditor as a second Droid session took 55–90 s of a 2–3 minute review. The worker's own
    // audit (audit.ts: files, hashes, time windows, wording, one finding per claim) always runs; this adds Droid's.
    droidAuditor: str('REVIEW_DROID_AUDITOR', '0') === '1',
    model: str('REVIEW_DROID_MODEL'),
  },
  anthropicKey: str('ANTHROPIC_API_KEY'),
  crs: { apiKey: str('CRS_API_KEY'), baseUrl: str('CRS_BASE_URL') },
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
      refund_reviewer: str('CREAO_REFUND_REVIEWER_AGENT_ID'),
      customer_liaison: str('CREAO_CUSTOMER_LIAISON_AGENT_ID'),
    },
    // App path only: per-seat app id and key (capi_ keys are scoped to one agent).
    appIds: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_APP_ID'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_APP_ID'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_APP_ID'),
      refund_reviewer: str('CREAO_REFUND_REVIEWER_APP_ID'),
      customer_liaison: str('CREAO_CUSTOMER_LIAISON_APP_ID'),
    },
    appKeys: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_KEY'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_KEY'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_KEY'),
      refund_reviewer: str('CREAO_REFUND_REVIEWER_KEY'),
      customer_liaison: str('CREAO_CUSTOMER_LIAISON_KEY'),
    },
    pollMs: Number(str('CREAO_POLL_MS', '15000')),
  },
  factoryKey: str('FACTORY_API_KEY'),
  seed: BigInt(str('SIM_SEED', '11')),
  population: Number(str('SIM_POPULATION', '10000')),
  financeDeskEnabled: str('FINANCE_DESK', '0') === '1',
};

export type Seat = keyof typeof config.creao.agentIds;
export const SEATS: Seat[] = ['evidence_analyst', 'refund_investigator', 'pattern_analyst', 'refund_reviewer', 'customer_liaison'];
/** The video reviewer's seats are optional: when the saved agent is missing, the report says "Reviewer offline" and a person decides. */
export const OPTIONAL_SEATS: Seat[] = ['refund_reviewer', 'customer_liaison'];

export const log = (...xs: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...xs);
