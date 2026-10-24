// Tests a detector before anyone trusts its numbers. Droid may run this.
//   npx tsx test.ts                     test every live detector
//   npx tsx test.ts candidates/<jobId>  test one candidate (detector.ts in that folder)
// Checks: the export shape; no I/O, environment or truth access in the source;
// it runs on a small fresh world inside the time limit and returns well-formed
// candidates; the coordinated detector's output does not change when regions
// are shuffled or business ids relabelled (region and business are not evidence).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemDb } from '../module/src/memdb';
import { HISTORY_DAYS, seedWorld, step } from '../module/src/sim';
import { historyFrom } from './history';
import type { Candidate, Detector, History } from './types';

const HERE = import.meta.dirname;
const IDS = ['coordinated', 'false_defect', 'refund_frequency'];
const FORBIDDEN = [/from\s+['"](node:)?(fs|child_process|net|http|https|os|worker_threads|vm)['"]/, /require\(/, /process\.(env|exit)/, /\bfetch\(/, /agentTruth|refundIntent|falseClaim|agent_truth|refund_intent/, /import\(/];

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL ${m}`); };
const pass = (m: string) => console.log(`  ok   ${m}`);

function world(): History {
  const db = createMemDb();
  seedWorld(db, { seed: 4242n, population: 1500 });
  while (db.simRun.id.find(1)!.day < HISTORY_DAYS + 70) step(db);
  return historyFrom(db, db.simRun.id.find(1)!.day - 1);
}

const canon = (cs: Candidate[]) => JSON.stringify(cs.map((c) => ({ a: [...c.agentIds].sort(), e: c.events.map((e) => e.id.toString()).sort() })).sort((x, y) => (x.a.join() < y.a.join() ? -1 : 1)));

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function testOne(file: string, h: History) {
  console.log(`\n${file.replace(HERE + '/', '')}`);
  const src = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN) if (re.test(src)) fail(`source matches forbidden pattern ${re}`);
  let d: Detector;
  try {
    d = ((await import(pathToFileURL(file).href)) as { detector: Detector }).detector;
  } catch (e) {
    fail(`does not load: ${(e as Error).message}`);
    return;
  }
  if (!d || !IDS.includes(d.id)) return fail(`must export \`detector\` with id one of ${IDS.join(', ')}`);
  if (!Number.isInteger(d.version) || d.version < 1) fail('version must be a positive integer');
  else pass(`exports ${d.id} v${d.version}`);
  const t0 = performance.now();
  let out: Candidate[] = [];
  try {
    out = d.run(h);
  } catch (e) {
    return fail(`run() threw: ${(e as Error).message}`);
  }
  const ms = performance.now() - t0;
  if (ms > 10_000) fail(`run() took ${Math.round(ms)} ms (limit 10 s)`);
  else pass(`ran in ${Math.round(ms)} ms, ${out.length} candidates`);
  const refunds = new Set(h.refunds.map((r) => r.id));
  const purchases = new Set(h.purchases.map((p) => p.id));
  const agents = new Set(h.agents.map((a) => a.id));
  let bad = 0;
  for (const c of out) {
    if (!Array.isArray(c.agentIds) || c.agentIds.length === 0 || c.agentIds.some((a) => !agents.has(a))) bad++;
    if (c.events.some((e) => (e.table === 'refund' ? !refunds.has(e.id) : !purchases.has(e.id)) || typeof e.why !== 'string')) bad++;
    if (typeof c.features !== 'object' || Object.values(c.features).some((v) => typeof v !== 'number' && typeof v !== 'string')) bad++;
  }
  if (bad) fail(`${bad} malformed candidates (unknown agents or events, or non-scalar features)`);
  else pass('candidates are well formed');
  if (d.id === 'coordinated') {
    const regions = shuffled(h.agents.map((a) => a.region), 7);
    const h2: History = { ...h, agents: h.agents.map((a, i) => ({ ...a, region: regions[i]! })) };
    if (canon(d.run(h2)) !== canon(out)) fail('output changed when regions were shuffled: region must not be a feature');
    else pass('region shuffle leaves the output unchanged');
    const ids = [...new Set(h.refunds.map((r) => r.businessId))];
    const relabel = new Map(ids.map((id, i) => [id, shuffled(ids, 11)[i]!]));
    const h3: History = { ...h, refunds: h.refunds.map((r) => ({ ...r, businessId: relabel.get(r.businessId)! })), purchases: h.purchases.map((p) => ({ ...p, business: relabel.get(p.business) ?? p.business })) };
    if (canon(d.run(h3)) !== canon(out)) fail('output changed when business ids were relabelled: which business must not be a feature');
    else pass('business relabelling leaves the output unchanged');
  }
}

async function main() {
  const target = process.argv[2];
  const files: string[] = [];
  if (target) {
    const p = resolve(HERE, target);
    files.push(existsSync(resolve(p, 'detector.ts')) ? resolve(p, 'detector.ts') : p);
  } else {
    for (const f of readdirSync(resolve(HERE, 'live')).filter((x) => x.endsWith('.ts')).sort()) files.push(resolve(HERE, 'live', f));
  }
  const h = world();
  for (const f of files) await testOne(f, h);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
