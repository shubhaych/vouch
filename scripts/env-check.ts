// One harmless call per service; prints live / missing / failed (never a key's
// value) and writes docs/ENV_STATUS.md. No CREAO run is started and no Droid
// job is run, so this spends no credits.
//   npx tsx scripts/env-check.ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from './_env';

loadEnv();
type Status = 'live' | 'missing' | 'failed';
const rows: { service: string; status: Status; detail: string; next: string }[] = [];
const add = (service: string, status: Status, detail: string, next = '') => { rows.push({ service, status, detail, next }); console.log(`${service.padEnd(14)} ${status.padEnd(8)} ${detail}`); };

// SpacetimeDB: connect and read sim_run.
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const db = process.env.STDB_DB || 'vouch';
try {
  const day = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no answer in 10 s')), 10_000);
    DbConnection.builder().withUri(uri).withDatabaseName(db).onConnect((c) => {
      c.subscriptionBuilder().onApplied(() => {
        clearTimeout(t);
        const r = c.db.simRun.id.find(1);
        resolve(r ? `day ${r.day}, ${r.population} agents, running=${r.running}` : 'connected, sim_run missing');
        c.disconnect();
      }).subscribe('SELECT * FROM sim_run');
    }).onConnectError((_c, e) => { clearTimeout(t); reject(e); }).build();
  });
  add('SpacetimeDB', 'live', `${uri}/${db}: ${day}`);
} catch (e) {
  add('SpacetimeDB', 'failed', `${uri}/${db}: ${(e as Error).message}`, 'npm run stdb:start && npm run stdb:publish');
}

// CREAO: GET /v1/agents is harmless (no run, no credits).
const key = process.env.CREAO_API_KEY || process.env.CREAO_CAPI_KEY || '';
if (!key) {
  add('CREAO', 'missing', 'no CREAO_API_KEY', 'create an Account API key (cr_sk_) at developer.creao.ai and set CREAO_API_KEY');
} else {
  const prefix = key.startsWith('cr_sk_') ? 'cr_sk_ (account key)' : key.startsWith('capi_') ? 'capi_ (app-scoped key)' : 'unknown prefix';
  try {
    const res = await fetch('https://developer.creao.ai/v1/agents', { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      const body = (await res.json()) as unknown;
      const list = (Array.isArray(body) ? body : ((body as { agents?: unknown[]; data?: unknown[] }).agents ?? (body as { data?: unknown[] }).data ?? [])) as { name?: string }[];
      const names = list.map((a) => a.name).filter(Boolean);
      const want = ['Vouch Evidence Analyst', 'Vouch Refund Investigator', 'Vouch Pattern Analyst'];
      const missingAgents = want.filter((w) => !names.some((n) => n?.toLowerCase() === w.toLowerCase()));
      add('CREAO', missingAgents.length ? 'failed' : 'live', `${prefix}: GET /v1/agents ok, ${names.length} agents${missingAgents.length ? `; missing ${missingAgents.join(', ')}` : ''}`,
        missingAgents.length ? 'create the missing agents in agent.creao.ai (spec Appendix A)' : 'npx tsx scripts/hello-creao.ts --record');
    } else {
      const appIds = ['EVIDENCE_ANALYST', 'REFUND_INVESTIGATOR', 'PATTERN_ANALYST'].filter((s) => process.env[`CREAO_${s}_APP_ID`]);
      add('CREAO', 'failed', `${prefix}: GET /v1/agents answered ${res.status}${key.startsWith('capi_') ? `; app path needs per-seat app ids (${appIds.length}/3 set)` : ''}`,
        key.startsWith('capi_') ? 'set CREAO_<SEAT>_APP_ID (and per-seat capi_ keys), or use one cr_sk_ account key' : 'check the key');
    }
  } catch (e) {
    add('CREAO', 'failed', `${prefix}: ${(e as Error).message}`, 'check network access to developer.creao.ai');
  }
}

// Factory: the droid CLI and FACTORY_API_KEY live on the laptop that runs the worker.
let droid = '';
try { droid = execFileSync('droid', ['--version'], { encoding: 'utf8' }).trim(); } catch { droid = ''; }
if (!process.env.FACTORY_API_KEY) add('Factory Droid', 'missing', `FACTORY_API_KEY not set; droid CLI ${droid ? droid : 'not installed'}`, 'install the droid CLI and set FACTORY_API_KEY on the worker laptop');
else if (!droid) add('Factory Droid', 'failed', 'FACTORY_API_KEY set but the droid CLI is not on PATH', 'install the droid CLI');
else add('Factory Droid', 'live', `droid ${droid}`, 'npx tsx scripts/hello-droid.ts');

// ffmpeg for the video pipeline.
try { add('ffmpeg', 'live', execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]!); } catch { add('ffmpeg', 'missing', 'not installed', 'apt-get install ffmpeg'); }

const md = [
  '# Environment status', '', `Written by \`npx tsx scripts/env-check.ts\` on ${new Date().toISOString()}. Key values are never printed.`, '',
  '| Service | Status | Detail | Next step |', '| --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.service} | ${r.status} | ${r.detail.replaceAll('|', '/')} | ${r.next ? `\`${r.next}\`` : ''} |`), '',
];
writeFileSync('docs/ENV_STATUS.md', md.join('\n'));
console.log('\nwrote docs/ENV_STATUS.md');
process.exit(0);
