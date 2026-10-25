import { config } from '../env';
import { generateBook, openBook } from './book';
import { reconcilePeriod } from './reconcile';

const file = config.financeBookPath;
const command = process.argv[2] || 'build';

if (command === 'build') {
  const result = await generateBook(file, config.financeBookSeed);
  console.log(JSON.stringify({ file, seed: config.financeBookSeed, ...result }, null, 2));
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
