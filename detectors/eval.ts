// The fixed evaluator. Droid may run it but never edit it.
//
// It never reads a truth file. It grows a FRESH held-out world in memory with
// the simulation's own engine (module/src/sim.ts) and a seed it draws itself,
// runs detectors every 5 simulated days the way the worker does, and prints
// only aggregate scores. A detector can only score well by generalising.
//
//   npx tsx detectors/eval.ts --live [--seed 7] [--agents 3000] [--days 150]
//   npx tsx detectors/eval.ts --candidate candidates/<jobId> [--seed ...]
//   add --json to print one JSON object (the Lab parses it)
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemDb } from '../module/src/memdb';
import { HISTORY_DAYS, seedWorld, step } from '../module/src/sim';
import { historyFrom } from './history';
import type { Detector } from './types';

const HERE = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, d: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1]! : d; };

const TARGET: Record<string, string> = { coordinated: 'ring', false_defect: 'opportunist', refund_frequency: 'serial' };
const KINDS = ['ring', 'opportunist', 'serial'] as const;

export interface Score {
  detector: string; version: number; seed: string; agents: number; days: number; flagged: number; patterns: number;
  precision: number; recall: Record<string, number>; targetKind: string; targetRecall: number; honestFlagged: number; honestTotal: number; runMs: number;
}

async function loadDetector(file: string): Promise<Detector> {
  const mod = (await import(pathToFileURL(file).href)) as { detector?: Detector };
  if (!mod.detector || typeof mod.detector.run !== 'function') throw new Error(`${file} does not export a Detector named "detector"`);
  return mod.detector;
}

export async function evaluate(detectors: Detector[], seed: bigint, population: number, days: number): Promise<Score[]> {
  const db = createMemDb();
  seedWorld(db, { seed, population });
  const flagged = detectors.map(() => new Set<number>());
  const patterns = detectors.map(() => 0);
  const ms = detectors.map(() => 0);
  const end = HISTORY_DAYS + days;
  while (db.simRun.id.find(1)!.day < end) {
    const r = step(db);
    if (r.dayEnded !== null && (r.dayEnded - HISTORY_DAYS) % 5 === 4) {
      const h = historyFrom(db, r.dayEnded);
      detectors.forEach((d, i) => {
        const t0 = performance.now();
        const cands = d.run(h);
        ms[i]! += performance.now() - t0;
        for (const c of cands) {
          const fresh = c.agentIds.some((a) => !flagged[i]!.has(a));
          if (fresh) patterns[i]!++;
          for (const a of c.agentIds) flagged[i]!.add(a);
        }
      });
    }
  }
  // Ground truth stays inside the evaluator: only aggregates leave this function.
  const kindOf = new Map<number, string>();
  for (const t of db.agentTruth.iter()) kindOf.set(t.agentId, t.kind);
  const totals: Record<string, number> = {};
  for (const k of kindOf.values()) totals[k] = (totals[k] ?? 0) + 1;
  return detectors.map((d, i) => {
    const f = flagged[i]!;
    let bad = 0;
    let honest = 0;
    const hits: Record<string, number> = {};
    for (const a of f) {
      const k = kindOf.get(a) ?? 'honest';
      if (k === 'honest' || k === 'showcase') honest++;
      else { bad++; hits[k] = (hits[k] ?? 0) + 1; }
    }
    const recall = Object.fromEntries(KINDS.map((k) => [k, totals[k] ? (hits[k] ?? 0) / totals[k]! : 0]));
    const target = TARGET[d.id] ?? 'ring';
    return {
      detector: d.id, version: d.version, seed: seed.toString(), agents: population, days, flagged: f.size, patterns: patterns[i]!,
      precision: f.size ? bad / f.size : 0, recall, targetKind: target, targetRecall: recall[target] ?? 0, honestFlagged: honest,
      honestTotal: (totals.honest ?? 0) + (totals.showcase ?? 0), runMs: Math.round(ms[i]!),
    };
  });
}

const pctS = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const seed = BigInt(opt('seed', BigInt('0x' + randomBytes(6).toString('hex')).toString()));
  const population = Number(opt('agents', '3000'));
  const days = Number(opt('days', '150'));
  const live: Detector[] = [];
  for (const f of readdirSync(resolve(HERE, 'live')).filter((x) => x.endsWith('.ts')).sort()) live.push(await loadDetector(resolve(HERE, 'live', f)));
  let detectors = live;
  let candidate: Detector | null = null;
  if (opt('candidate', '')) {
    const dir = resolve(HERE, opt('candidate', ''));
    const file = existsSync(resolve(dir, 'detector.ts')) ? resolve(dir, 'detector.ts') : dir;
    candidate = await loadDetector(file);
    const base = live.find((d) => d.id === candidate!.id);
    detectors = base ? [base, candidate] : [candidate];
  } else if (!flag('live')) {
    console.error('usage: eval.ts --live | --candidate candidates/<jobId>  [--seed N] [--agents N] [--days N] [--json]');
    process.exit(2);
  }
  const scores = await evaluate(detectors, seed, population, days);
  mkdirSync(resolve(HERE, 'results'), { recursive: true });
  scores.forEach((s, i) => {
    const tag = candidate && i === scores.length - 1 ? 'candidate' : 'live';
    writeFileSync(resolve(HERE, 'results', `${s.detector}-v${s.version}-${tag}.json`), JSON.stringify(s, null, 2));
  });
  if (flag('json')) {
    console.log(JSON.stringify({ seed: seed.toString(), population, days, scores, candidate: candidate ? { id: candidate.id, version: candidate.version } : null }));
    return;
  }
  console.log(`Fresh held-out world: seed ${seed}, ${population} agents, ${days} simulated days (detectors run every 5 days)\n`);
  console.log('detector            ver  flagged  precision  recall ring  recall opp  recall serial  honest flagged  ms');
  for (const s of scores) {
    console.log(
      `${s.detector.padEnd(20)}${String(s.version).padEnd(5)}${String(s.flagged).padEnd(9)}${pctS(s.precision).padEnd(11)}${pctS(s.recall.ring!).padEnd(13)}` +
      `${pctS(s.recall.opportunist!).padEnd(12)}${pctS(s.recall.serial!).padEnd(15)}${`${s.honestFlagged} / ${s.honestTotal}`.padEnd(16)}${s.runMs}`,
    );
  }
  console.log('\nNumbers are measured on a simulated economy we designed; they show the method works on modelled behaviour, not on real fraud.');
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
