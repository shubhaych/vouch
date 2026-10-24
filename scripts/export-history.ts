// Exports a history snapshot (purchases, refunds, agents) for offline detector
// work, and, with --truth, ground truth through the worker-only exportTruth
// procedure into a git-ignored file. Detectors and Droid never read truth;
// the fixed evaluator does not need it either (it grows fresh worlds).
//   npx tsx scripts/export-history.ts [--truth]
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from '../worker/src/stdb';
import { historyFromConn } from '../worker/src/detectors';

const { conn } = await connect('worker', ['SELECT * FROM sim_run', 'SELECT * FROM purchase', 'SELECT * FROM refund', 'SELECT * FROM agent'], 120_000);
const day = conn.db.simRun.id.find(1)?.day ?? 0;
const h = historyFromConn(conn, day);
mkdirSync('detectors/results', { recursive: true });
const file = `detectors/results/history-day${day}.json`;
writeFileSync(file, JSON.stringify(h, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
console.log(`wrote ${file}: ${h.purchases.length} purchases, ${h.refunds.length} refunds, ${h.agents.length} agents`);
if (process.argv.includes('--truth')) {
  const truth = await conn.procedures.exportTruth({});
  mkdirSync('worker/.keys', { recursive: true });
  writeFileSync(`worker/.keys/truth-day${day}.json`, truth);
  console.log(`wrote worker/.keys/truth-day${day}.json (git-ignored; the evaluator alone may read it)`);
}
process.exit(0);
