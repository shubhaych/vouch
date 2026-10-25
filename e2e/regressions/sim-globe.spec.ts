// Simulation globe: the three checks asked for after the globe "paused" when hovered in the
// middle and ignored clicks. Causes: particle hover threw inside react-globe.gl's tick, arcs and
// land dots swallowed clicks, and any 1 px pointer wobble counted as a drag. Needs the dev
// server (window.__globe is exposed outside production).
import { test, expect, type Page } from '@playwright/test';

type G = {
  pointOfView(p?: object, ms?: number): { lat: number; lng: number; altitude: number };
  controls(): { autoRotate: boolean };
};

async function open(page: Page) {
  await page.goto('/simulation');
  await expect(page.getByTestId('sim-scale-band')).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => !!(window as unknown as { __globe?: G }).__globe, null, { timeout: 120_000 });
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(1500);
}

const lng = (page: Page) => page.evaluate(() => (window as unknown as { __globe: G }).__globe.pointOfView().lng);

test('1. hovering the middle of the globe does not stop it or throw', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const box = (await page.getByTestId('globe').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) await page.mouse.move(box.x + box.width / 2 + (i % 5) * 3, box.y + box.height / 2 + (i % 3) * 3);
  const a = await lng(page);
  await page.waitForTimeout(3000);
  const b = await lng(page);
  expect(Math.abs(b - a), 'globe kept rotating under the pointer').toBeGreaterThan(0.5);
  expect(errors, 'no errors from the globe tick').toEqual([]);
});

test('2. clicking near a merchant opens its flow map, and the X returns to the globe', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  // Stop the camera centred on merchant B-001 (New York), then click the middle of the canvas.
  await page.evaluate(() => {
    const g = (window as unknown as { __globe: G }).__globe;
    g.controls().autoRotate = false;
    g.pointOfView({ lat: 40.76, lng: -73.97, altitude: 2 }, 0);
  });
  await page.waitForTimeout(800);
  const box = (await page.getByTestId('globe').boundingBox())!;
  const pt = { x: box.width / 2, y: box.height / 2 };
  await page.mouse.move(box.x + pt.x, box.y + pt.y);
  await page.mouse.down();
  await page.mouse.move(box.x + pt.x + 1, box.y + pt.y); // the wobble a real hand makes
  await page.mouse.up();
  await expect(page.getByTestId('merchant-flow')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('merchant-flow-close').click();
  await expect(page.getByTestId('merchant-flow')).toHaveCount(0);
});

test('3. the globe keeps turning without input and the simulated day advances', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  const day = async () => Number((await page.getByTestId('sim-day').innerText()).match(/\d+/)?.[0] ?? 0);
  const d0 = await day();
  const samples: number[] = [];
  for (let i = 0; i < 6; i++) { samples.push(await lng(page)); await page.waitForTimeout(2000); }
  for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i]! - samples[i - 1]!), `rotation between samples ${i - 1} and ${i}`).toBeGreaterThan(0.2);
  await expect.poll(day, { timeout: 60_000, message: 'simulated day advances (worker keeps the sim running)' }).toBeGreaterThan(d0);
});
