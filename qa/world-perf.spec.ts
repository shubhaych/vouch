// Loop 3 probe: main-thread long tasks over 10 s in each /world mode (headless, software WebGL).
// Tells a JS stall (React or layer rebuilds) from slow software rendering.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('world modes: long-task load over 10 s', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  const measure = async () => {
    await page.evaluate(() => { (window as unknown as { __long: number[] }).__long = []; });
    await page.waitForTimeout(10_000);
    const l = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    return { busyMs: l.reduce((a, b) => a + b, 0), count: l.length, max: Math.max(0, ...l) };
  };
  const out: Record<string, unknown> = {};
  await page.goto('/world');
  await expect(page.getByTestId('agent-count')).toContainText(/agents/, { timeout: 120_000 });
  await page.waitForTimeout(5000);
  out.live = await measure();
  await page.getByTestId('mode-replay').click({ timeout: 120_000 });
  const pattern = page.locator('[data-testid^="pattern-"]').first();
  await expect(pattern).toBeVisible({ timeout: 120_000 });
  out.replayList = await measure();
  await pattern.click({ timeout: 120_000 });
  await expect(page.getByTestId('replay-scrubber')).toBeVisible({ timeout: 120_000 });
  out.replayOpen = await measure();
  await page.getByTestId('replay-play').click({ timeout: 120_000 });
  out.replayPlaying = await measure();
  await page.getByTestId('mode-observatory').click({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  out.observatory = await measure();
  mkdirSync('qa/results', { recursive: true });
  writeFileSync('qa/results/world-perf.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
});
