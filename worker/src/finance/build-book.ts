import { resolve } from 'node:path';
import { REPO_ROOT } from '../env';
import { generateBook, openBook } from './book';
import { reconcilePeriod } from './reconcile';

const file = resolve(REPO_ROOT, process.env.FINANCE_BOOK_PATH || 'worker/data/brindle.duckdb');
const command = process.argv[2] || 'build';

if (command === 'build') {
  const seed = Number(process.env.FINANCE_BOOK_SEED || 1);
  const result = await generateBook(file, seed);
  console.log(JSON.stringify({ file, seed, ...result }, null, 2));
} else if (command === 'reconcile') {
  const period = process.argv[3];
  if (!period) throw new Error('Pass a period in YYYY-MM form: npm run desk:reconcile -- 2026-09');
  const c = await openBook(file, true);
  try {
    const result = await reconcilePeriod(c, period);
    console.log(JSON.stringify({
      period: result.period,
      summary: result.summary,
      bridge: result.bridge,
      bridgeFootsToCents: result.bridge.reduce((sum, line) => sum + line.cents, 0),
      exceptionRows: result.exceptions.length,
      sampleExceptions: result.exceptions.slice(0, 10),
    }, null, 2));
  } finally {
    c.closeSync();
  }
} else {
  throw new Error(`Unknown command '${command}'. Use build or reconcile.`);
}
