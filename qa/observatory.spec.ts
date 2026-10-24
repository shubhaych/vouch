// Loop 2, P7 follow-up: times each Observatory metric switch and records the
// main thread's long tasks, to tell a real stall from slow headless software GL.
//   npx playwright test qa/observatory.spec.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('P7b Observatory metric switches: time per click and long tasks', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto('/world?mode=observatory');
  await expect(page.getByTestId('observatory-metrics')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(5000);
  const rows: { metric: string; clickMs: number; longTasks: number[] }[] = [];
  for (const m of ['shopping', 'refunds', 'losses', 'honest_declines', 'fraud', 'credit', 'business']) {
    await page.evaluate(() => { (window as unknown as { __long: number[] }).__long = []; });
    const t0 = Date.now();
    await page.getByTestId(`metric-${m}`).click({ timeout: 240_000 });
    await page.waitForTimeout(1500);
    const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    rows.push({ metric: m, clickMs: Date.now() - t0 - 1500, longTasks });
  }
  mkdirSync('qa/results', { recursive: true });
  writeFileSync('qa/results/observatory-timing.json', JSON.stringify(rows, null, 2));
  await page.screenshot({ path: 'qa/shots/P7b-observatory.png' });
  console.log(JSON.stringify(rows));
});
