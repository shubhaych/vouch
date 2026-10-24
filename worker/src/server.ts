// The worker process: privileged SpacetimeDB identities plus the HTTP routes
// the phone and CREAO need. Everything slow, secret or heavy happens here.
import { config, log } from './env';
import { connect } from './stdb';

async function main() {
  log(`connecting to ${config.stdbUri}/${config.stdbDb}`);
  const worker = await connect('worker', ['SELECT * FROM sim_run', 'SELECT * FROM metrics', 'SELECT * FROM control']);
  const { conn } = worker;
  await conn.reducers.setSeatCodes({ businessCode: config.demoBusinessCode, controllerCode: config.demoControllerCode }).catch((e) => log('seat codes', e.message));

  const run = conn.db.simRun.id.find(1);
  if (!run?.seeded) {
    log(`seeding world: seed ${config.seed}, ${config.population} agents`);
    const t0 = Date.now();
    await conn.reducers.seedWorld({ seed: config.seed, population: config.population, force: false });
    log(`seeded in ${Date.now() - t0} ms`);
  } else {
    log(`world already seeded: day ${run.day}, ${run.population} agents, running=${run.running}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
