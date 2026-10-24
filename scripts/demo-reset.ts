// Restores a known demo state: reseeds the economy (seed 11, 10,000 agents by
// default) through the seedWorld reducer, as the worker identity. The running
// worker notices the new world and re-registers issuer keys, the showcase
// credential and the showcase loop. Pre-run lab jobs and CREAO run rows are kept.
//   npx tsx scripts/demo-reset.ts [--seed 11] [--agents 10000]
import { config, log } from '../worker/src/env';
import { connect } from '../worker/src/stdb';

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const seed = BigInt(arg('seed', String(config.seed)));
const population = Number(arg('agents', String(config.population)));

const { conn } = await connect('worker', ['SELECT * FROM sim_run']);
const t0 = Date.now();
await conn.reducers.seedWorld({ seed, population, force: true });
await conn.reducers.setSim({ running: true, agentsPerTick: 1000, tickMicros: 200_000n, maxDay: 720 });
const run = conn.db.simRun.id.find(1);
log(`demo reset in ${Date.now() - t0} ms: seed ${seed}, ${population} agents, day ${run?.day}, running=${run?.running}`);
conn.disconnect();
process.exit(0);
