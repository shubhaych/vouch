// T0.3: proves the live bus. A fresh anonymous identity calls the `ping`
// reducer, which inserts a latency_ping row; we time our own row's arrival.
// Open /system (or /world) in two tabs: both show the new pings live.
//   npx tsx scripts/hello-stdb.ts [count]
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from './_env';

loadEnv();
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const db = process.env.STDB_DB || 'vouch';
const count = Number(process.argv[2] ?? 10);

const conn = await new Promise<DbConnection>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no connection to ${uri}/${db} in 15 s`)), 15_000);
  DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(db)
    .onConnect((c, identity) => {
      clearTimeout(timer);
      console.log(`connected to ${uri}/${db} as ${identity.toHexString().slice(0, 16)}…`);
      c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe([`SELECT * FROM latency_ping WHERE who = 0x${identity.toHexString()}`, 'SELECT * FROM sim_run']);
    })
    .onConnectError((_c, e) => reject(e))
    .build();
});

const run = conn.db.simRun.id.find(1);
console.log(run ? `sim_run: day ${run.day}, ${run.population} agents, running=${run.running}` : 'sim_run: missing (module not initialised?)');

const rtts: number[] = [];
for (let i = 0; i < count; i++) {
  const sent = Date.now();
  const arrived = new Promise<number>((res) => {
    const on = (_ctx: unknown, row: { clientSentMs: number; id: bigint }) => {
      if (row.clientSentMs !== sent) return;
      conn.db.latencyPing.removeOnInsert(on as never);
      console.log(`row latency_ping #${row.id} arrived after ${Date.now() - sent} ms`);
      res(Date.now() - sent);
    };
    conn.db.latencyPing.onInsert(on as never);
  });
  await conn.reducers.ping({ clientSentMs: sent });
  rtts.push(await arrived);
  await new Promise((r) => setTimeout(r, 200));
}
rtts.sort((a, b) => a - b);
console.log(`round trip over ${count} pings: p50 ${rtts[Math.floor(count / 2)]} ms, p95 ${rtts[Math.min(count - 1, Math.floor(count * 0.95))]} ms`);
conn.disconnect();
process.exit(0);
