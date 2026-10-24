// The scale claim as a measurement. For each population, publishes a fresh
// throwaway database, seeds it, runs the tick as fast as the module allows
// for 30 simulated days, and times it. Results go to bench_result in the main
// database (shown on /system with the date and machine), then the throwaway
// database is deleted. Run on the machine that hosts SpacetimeDB.
//   npx tsx scripts/bench.ts [--sizes 10000,50000,100000] [--days 30]
import { execFileSync } from 'node:child_process';
import { cpus, hostname } from 'node:os';
import { DbConnection } from '../worker/module_bindings/index';
import { connect } from '../worker/src/stdb';
import { loadEnv } from './_env';

loadEnv();
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1]! : d; };
const sizes = arg('sizes', '10000,50000,100000').split(',').map(Number);
const days = Number(arg('days', '30'));
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const server = process.env.STDB_SERVER || uri.replace(/^ws/, 'http');
const spacetime = `${process.env.HOME}/.local/bin/spacetime`;
const machine = `${hostname()} · ${cpus()[0]?.model ?? 'cpu'} ×${cpus().length}`;

function fresh(db: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(db).onConnect((c) => {
      c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe(['SELECT * FROM sim_run', 'SELECT * FROM metrics']);
    }).onConnectError((_c, e) => reject(e)).build();
  });
}

const results: { agents: number; stepsPerSec: number; daysPerMin: number; seconds: number }[] = [];
for (const n of sizes) {
  const db = `vouch-bench-${n}`;
  console.log(`\n== ${n} agents: publishing ${db}`);
  execFileSync(spacetime, ['publish', db, '-p', 'module', '-s', server, '-y', '--delete-data=always'], { stdio: 'ignore' });
  const conn = await fresh(db);
  await conn.reducers.bootstrapWorker({});
  const t0 = Date.now();
  await conn.reducers.seedWorld({ seed: 7n, population: n, force: false });
  console.log(`   seeded in ${Date.now() - t0} ms`);
  const start = conn.db.simRun.id.find(1)!;
  // As fast as the module allows: big ticks, a 20 ms schedule; ticks queue back to back when they take longer.
  const perTick = Math.min(n, 10_000);
  const tStart = Date.now();
  const steps0 = conn.db.metrics.id.find(1)!.stepsTotal;
  await conn.reducers.setSim({ running: true, agentsPerTick: perTick, tickMicros: 20_000n, maxDay: start.day + days + 1 });
  const target = start.day + days;
  while ((conn.db.simRun.id.find(1)?.day ?? 0) < target) {
    await new Promise((r) => setTimeout(r, 250));
    if (Date.now() - tStart > 20 * 60_000) throw new Error('benchmark timed out');
  }
  const secs = (Date.now() - tStart) / 1000;
  const steps = Number(conn.db.metrics.id.find(1)!.stepsTotal - steps0);
  const r = { agents: n, stepsPerSec: steps / secs, daysPerMin: days / (secs / 60), seconds: secs };
  results.push(r);
  console.log(`   ${days} days in ${secs.toFixed(1)} s: ${Math.round(r.stepsPerSec).toLocaleString()} agent-steps/s, ${r.daysPerMin.toFixed(1)} simulated days/min`);
  await conn.reducers.setSim({ running: false, agentsPerTick: perTick, tickMicros: 200_000n, maxDay: 0 }).catch(() => undefined);
  conn.disconnect();
  execFileSync(spacetime, ['delete', db, '-s', server, '-y'], { stdio: 'ignore' });
}

const { conn } = await connect('worker', []);
const ranAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
for (const r of results) await conn.reducers.recordBench({ agents: r.agents, days, stepsPerSec: r.stepsPerSec, daysPerMin: r.daysPerMin, machine, ranAt });
console.log(`\nrecorded ${results.length} results in bench_result (machine: ${machine})`);
process.exit(0);
