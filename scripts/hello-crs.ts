// Proves the CRS integration is live: logs in to the CRS sandbox, checks health, and screens the
// four scripted test personas through AtData Fraud Finder + TransUnion TruValidate (docs/CRS.md).
// Prints only the redacted, normalised result. --record saves those results (no persona data) to
// worker/fixtures/crs/recorded.json as the proof of a real run.
//   CRS_MODE=sandbox npx tsx scripts/hello-crs.ts [--record]
import { mkdirSync, writeFileSync } from 'node:fs';
import { config, REPO_ROOT } from '../worker/src/env';
import { health, PERSONA_IDS, sandboxReady, screenWithMeta, setCrsMeter, type CrsCallRecord } from '../worker/src/crs';

if (config.crs.mode !== 'sandbox') { console.error('Set CRS_MODE=sandbox (plus CRS_USERNAME, CRS_PASSWORD) in .env first.'); process.exit(2); }
const notReady = sandboxReady();
if (notReady) { console.error(`CRS sandbox not ready: ${notReady}`); process.exit(2); }

const calls: CrsCallRecord[] = [];
setCrsMeter((m) => calls.push(m));
console.log(`CRS sandbox ${config.crs.baseUrl}`);
console.log(`health: HTTP ${await health()}`);
const results = [];
for (const id of PERSONA_IDS) {
  const { screening: s, latencyMs } = await screenWithMeta(id);
  results.push({ ...s, latencyMs });
  console.log(`${id}: contact risk ${s.contactRiskScore ?? 'n/a'} (${s.contactRiskBand}), identity ${s.identityStatus}${s.messages.length ? ` [${s.messages.map((m) => m.code).join(',')}]` : ''} → ${s.route}${s.errors.length ? `  errors: ${s.errors.join('; ')}` : ''}  (${latencyMs} ms)`);
}
console.log(`requests: ${calls.map((c) => `${c.product}:${c.status}`).join(' ')}`);
if (process.argv.includes('--record')) {
  const dir = `${REPO_ROOT}/worker/fixtures/crs`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/recorded.json`, JSON.stringify({ recordedAt: new Date().toISOString(), baseUrl: config.crs.baseUrl, requests: calls, results }, null, 2));
  console.log(`saved worker/fixtures/crs/recorded.json (normalised results only, no persona data)`);
}
