// QA-008: each Observatory metric switch took 12 to 77 s in headless Chromium, because the hex
// layer was rebuilt on every feed render. Budget here: 10 s per switch even with software WebGL.
import { test, expect } from '@playwright/test';

test('QA-008 Observatory metric switches stay responsive and a globe click opens the region', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/world?mode=observatory');
  await expect(page.getByTestId('observatory-metrics')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(5000);
  const times: Record<string, number> = {};
  for (const m of ['refunds', 'losses', 'honest_declines', 'fraud', 'credit', 'business', 'shopping']) {
    const t0 = Date.now();
    await page.getByTestId(`metric-${m}`).click({ timeout: 60_000 });
    await expect(page.getByTestId(`metric-${m}`)).toHaveClass(/bg-accent/, { timeout: 60_000 });
    times[m] = Date.now() - t0;
  }
  console.log(JSON.stringify(times));
  for (const [m, ms] of Object.entries(times)) expect(ms, m).toBeLessThan(10_000);

  const pt = await page.evaluate(() => {
    const g = (window as unknown as { __globe?: { getScreenCoords(lat: number, lng: number): { x: number; y: number }; pointOfView(p: object, ms: number): void } }).__globe;
    g?.pointOfView({ lat: 41.9, lng: -87.6, altitude: 1.6 }, 0);
    return g ? g.getScreenCoords(41.9, -87.6) : null;
  });
  await page.waitForTimeout(1000);
  const box = await page.getByTestId('globe').boundingBox();
  await page.mouse.click(box!.x + pt!.x, box!.y + pt!.y);
  await expect(page.getByTestId('region-panel')).toBeVisible({ timeout: 20_000 });
});
