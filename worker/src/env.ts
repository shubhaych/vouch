// Server-side configuration. Never import this from web/: it reads keys.
// Keys come from the environment (cloud) or a git-ignored .env (laptop).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

function loadDotEnv() {
  const p = resolve(REPO_ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    // Quoted values may contain '#' (passwords do); unquoted ones end at a comment.
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\n]*?))\s*(?:#.*)?$/);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2] ?? m[3] ?? m[4] ?? '';
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
      listing_matcher: str('CREAO_LISTING_MATCHER_AGENT_ID'),
      returns_monitor: str('CREAO_RETURNS_MONITOR_AGENT_ID'),
      policy_checker: str('CREAO_POLICY_CHECKER_AGENT_ID'),
      risk_scorecard: str('CREAO_RISK_SCORECARD_AGENT_ID'),
    },
    // App path only: per-seat app id and key (capi_ keys are scoped to one agent).
    appIds: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_APP_ID'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_APP_ID'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_APP_ID'),
      refund_reviewer: str('CREAO_REFUND_REVIEWER_APP_ID'),
      customer_liaison: str('CREAO_CUSTOMER_LIAISON_APP_ID'),
      listing_matcher: str('CREAO_LISTING_MATCHER_APP_ID'),
      returns_monitor: str('CREAO_RETURNS_MONITOR_APP_ID'),
      policy_checker: str('CREAO_POLICY_CHECKER_APP_ID'),
      risk_scorecard: str('CREAO_RISK_SCORECARD_APP_ID'),
    },
    appKeys: {
      evidence_analyst: str('CREAO_EVIDENCE_ANALYST_KEY'),
      refund_investigator: str('CREAO_REFUND_INVESTIGATOR_KEY'),
      pattern_analyst: str('CREAO_PATTERN_ANALYST_KEY'),
      refund_reviewer: str('CREAO_REFUND_REVIEWER_KEY'),
      customer_liaison: str('CREAO_CUSTOMER_LIAISON_KEY'),
      listing_matcher: str('CREAO_LISTING_MATCHER_KEY'),
      returns_monitor: str('CREAO_RETURNS_MONITOR_KEY'),
      policy_checker: str('CREAO_POLICY_CHECKER_KEY'),
      risk_scorecard: str('CREAO_RISK_SCORECARD_KEY'),
    },
    pollMs: Number(str('CREAO_POLL_MS', '15000')),
  },
  // CRS sandbox: identity and contact-risk screening only (see worker/src/crs.ts).
  crs: {
    mode: (str('CRS_MODE', 'fixture') === 'sandbox' ? 'sandbox' : 'fixture') as 'sandbox' | 'fixture',
    baseUrl: str('CRS_BASE_URL', 'https://api-sandbox.stitchcredit.com/api'),
    username: str('CRS_USERNAME'),
    password: str('CRS_PASSWORD'),
    // True once sandbox credentials are set; the video reviewer reads this to know identity can be checked.
    configured: str('CRS_MODE') === 'sandbox' && !!str('CRS_USERNAME') && !!str('CRS_PASSWORD'),
  },
  // Bright Data: the worker scrapes listings and return signals and hands them to the agents (docs/BRIGHTDATA.md).
  brightdata: {
    mode: (str('BRIGHTDATA_MODE', 'fixture') === 'live' ? 'live' : 'fixture') as 'live' | 'fixture',
    token: str('BRIGHTDATA_API_TOKEN'),
    serpZone: str('BRIGHTDATA_SERP_ZONE', 'serp_api'),
    unlockerZone: str('BRIGHTDATA_UNLOCKER_ZONE', 'web_unlocker'),
    dailyLimit: Number(str('BRIGHTDATA_DAILY_LIMIT', '60')),
    cacheDir: resolve(REPO_ROOT, 'worker/.cache/brightdata'),
    cacheHours: Number(str('BRIGHTDATA_CACHE_HOURS', '24')),
  },
  returnsMonitor: {
    everyMinutes: Number(str('RETURNS_MONITOR_EVERY_MIN', '15')),
    spikeFactor: Number(str('RETURNS_SPIKE_FACTOR', '3')),
  },
  factoryKey: str('FACTORY_API_KEY'),
  seed: BigInt(str('SIM_SEED', '11')),
  population: Number(str('SIM_POPULATION', '10000')),
};

export type Seat = keyof typeof config.creao.agentIds;
export const SEATS: Seat[] = ['evidence_analyst', 'refund_investigator', 'pattern_analyst', 'refund_reviewer', 'customer_liaison', 'listing_matcher', 'returns_monitor', 'policy_checker', 'risk_scorecard'];
/** Optional seats fail soft when the saved agent is missing: the reviewer says "Reviewer offline", the claim flow skips the Listing Matcher, and no monitor note is written. */
export const OPTIONAL_SEATS: Seat[] = ['refund_reviewer', 'customer_liaison', 'listing_matcher', 'returns_monitor', 'policy_checker', 'risk_scorecard'];

export const log = (...xs: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...xs);
