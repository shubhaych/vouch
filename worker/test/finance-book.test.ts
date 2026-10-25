import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOK_MONTHS, generateBook, openBook, rows } from '../src/finance/book';
import { reconcilePeriod } from '../src/finance/reconcile';

const dir = mkdtempSync(join(tmpdir(), 'vouch-finance-book-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('seeded featured-company book', () => {
  it('builds one million orders and reproduces its planted answer key from the same seed', async () => {
    const aPath = join(dir, 'a.duckdb');
    const bPath = join(dir, 'b.duckdb');
    const [a, b] = await Promise.all([generateBook(aPath, 17), generateBook(bPath, 17)]);
    expect(a.counts.orders).toBe(1_000_000);
    expect(b.counts.orders).toBe(1_000_000);
    expect(a.counts.grader_truth).toBe(1_500);
    expect(b.counts.grader_truth).toBe(1_500);
    const ca = await openBook(aPath, true);
    const cb = await openBook(bPath, true);
    try {
      const truthA = await rows(ca, `SELECT * FROM grader_truth ORDER BY exception_id`);
      const truthB = await rows(cb, `SELECT * FROM grader_truth ORDER BY exception_id`);
      expect(truthA).toEqual(truthB);
      for (const period of BOOK_MONTHS) {
        const close = await reconcilePeriod(ca, period);
        expect(close.summary.events).toBeGreaterThan(0);
        expect(close.bridge.reduce((sum, line) => sum + line.cents, 0)).toBe(0);
      }
      expect(a.ms).toBeLessThan(5 * 60_000);
    } finally {
      ca.closeSync();
      cb.closeSync();
    }
  }, 5 * 60_000);
});
