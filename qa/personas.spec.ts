// Loop 2 personas in the browser (fixture mode). Each test is one persona's
// walk through the product; failures are reported in QA_REPORT.md, never fixed here.
//   npx playwright test qa/personas.spec.ts
import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const BUSINESS_CODE = process.env.DEMO_BUSINESS_CODE || 'vouch-business';
const CONTROLLER_CODE = process.env.DEMO_CONTROLLER_CODE || 'vouch-controller';

test.use({ trace: 'retain-on-failure' });

async function shot(page: Page, name: string) {
  mkdirSync('qa/shots', { recursive: true });
  await page.screenshot({ path: `qa/shots/${name}.png` });
}
/** Uncaught page errors are a failure for every persona. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  return sw <= iw + 1 ? 'ok' : `scrollWidth ${sw} > ${iw}`;
}
async function seat(page: Page, code: string) {
  await page.goto('/business');
  await expect(page.getByTestId('seat-gate').or(page.getByTestId('business-switcher'))).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('seat-gate').isVisible()) {
    await page.getByTestId('seat-code').fill(code);
    await page.getByTestId('seat-submit').click();
  }
  await expect(page.getByTestId('business-switcher')).toBeVisible({ timeout: 15_000 });
}

test('P1 new shopper lands on / and watches the live demo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('hero-counters')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hero-counters').locator('[data-prov="live"]').first()).toBeVisible();
  await expect(page.getByTestId('live-demo')).toBeVisible();
  await expect(page.getByTestId('demo-steps')).toBeVisible();
  await shot(page, 'P1-home-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  expect(await noHorizontalScroll(page)).toBe('ok');
  await shot(page, 'P1-home-390');
  expect(errors).toEqual([]);
});

test('P1 unhappy paths on /shop and /claim: double-click pay, short video, refresh, two tabs', async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/shop');
  await expect(page.getByTestId('agent-card')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('buy-1-2').click();
  await page.getByTestId('pay').dblclick();
  await page.waitForTimeout(2500);
  const orders = await page.locator('[data-testid^="order-"]').count();
  expect(orders, 'a double-click on Pay must create one order').toBe(1);
  const order = page.locator('[data-testid^="order-"]').first();
  await order.getByTestId('fast-forward').click();
  await order.getByTestId('request-refund').click();
  await order.getByTestId('refund-text').fill('The hinge snapped on day two.');
  await order.getByTestId('submit-refund').click();
  await expect(order.getByTestId('claim-qr')).toBeVisible();
  const href = (await order.getByTestId('use-this-device').getAttribute('href'))!;

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(href);
  await expect(phone.getByTestId('recorder')).toBeVisible({ timeout: 30_000 });
  expect(await noHorizontalScroll(phone)).toBe('ok');
  await phone.getByTestId('claim-video-input').setInputFiles('qa/videos/V12-short.mp4');
  await expect(phone.getByTestId('upload-error')).toContainText('at least 4 seconds', { timeout: 30_000 });
  await shot(phone, 'P1-claim-short-video');

  // Second tab on the same claim link, then a refresh mid-claim after a good upload.
  const tab2 = await context.newPage();
  await tab2.setViewportSize({ width: 390, height: 844 });
  await tab2.goto(href);
  await phone.getByTestId('claim-video-input').setInputFiles('qa/videos/S02-fresh.mp4');
  await expect(phone.getByTestId('claim-stepper')).toContainText('Frames extracted', { timeout: 60_000 });
  await phone.reload();
  await expect(phone.getByTestId('claim-stepper')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => phone.getByTestId('claim-stepper').locator('li').nth(1).locator('span').first().innerText(), { timeout: 30_000 }).toBe('✓');
  await expect.poll(async () => tab2.getByTestId('claim-stepper').locator('li').nth(1).locator('span').first().innerText(), { timeout: 30_000 }).toBe('✓');
  await shot(tab2, 'P1-claim-second-tab');
  expect(errors).toEqual([]);
});

test('P5 business: wrong seat code, queue, frames and checks, more evidence, kill switch', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/business');
  await expect(page.getByTestId('seat-gate').or(page.getByTestId('business-switcher'))).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId('seat-gate').isVisible()) {
    await page.getByTestId('seat-code').fill('not-the-code');
    await page.getByTestId('seat-submit').click();
    const toast = page.getByTestId('toaster');
    await expect(toast).not.toBeEmpty({ timeout: 10_000 });
    await shot(page, 'P5-wrong-code');
    await expect.soft(toast, 'a wrong code should say so in plain words').toContainText(/wrong seat code/i, { timeout: 3_000 });
  }
  await seat(page, BUSINESS_CODE);
  await expect(page.getByTestId('queue')).toBeVisible();
  await expect(page.getByTestId('org-chart')).toBeVisible();
  const first = page.locator('[data-testid^="queue-"]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  await expect(page.getByTestId('investigation')).toBeVisible();
  await shot(page, 'P5-investigation');

  // Kill switch off, then on again.
  await page.getByTestId('kill-switch').click();
  await expect(page.getByTestId('org-chart')).toContainText('CREAO agents: OFF', { timeout: 10_000 });
  await shot(page, 'P5-kill-switch-off');
  await page.getByTestId('kill-switch').click();
  await expect(page.getByTestId('org-chart')).toContainText('CREAO agents: ON', { timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  expect(await noHorizontalScroll(page)).toBe('ok');
  await shot(page, 'P5-business-390');
  expect(errors).toEqual([]);
});

test('P6 controller: credential verify, tamper and revoke in the five-step check', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await seat(page, CONTROLLER_CODE);
  await expect(page.getByTestId('credential-stepper')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('cred-verify').click();
  await expect(page.getByTestId('cred-result')).toContainText(/pass|verified/i, { timeout: 30_000 });
  await page.getByTestId('cred-tamper').click();
  await expect(page.getByTestId('cred-result')).toContainText(/step 4/i, { timeout: 30_000 });
  await shot(page, 'P6-tamper');
  await page.getByTestId('cred-revoke').click();
  await page.getByTestId('cred-verify').click();
  await expect(page.getByTestId('cred-result')).toContainText(/step 3/i, { timeout: 30_000 });
  await shot(page, 'P6-revoked');
  expect(errors).toEqual([]);
});

test('P7 judge on the globe: layers, agent, graph click-through, replay, observatory, region', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('/world');
  await expect(page.getByTestId('agent-count')).toContainText(/agents/, { timeout: 60_000 });
  for (const l of ['shopping', 'refunds', 'patterns', 'credit']) {
    await page.getByTestId(`layer-${l}`).click();
    await page.waitForTimeout(700);
  }
  await shot(page, 'P7-layer-credit');
  await expect(page.getByTestId('monitor-line').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('event-monitor').locator('ol').hover();
  await page.getByTestId('monitor-line').filter({ hasText: /\[Refund/ }).first().click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  const dots = page.getByTestId('credit-dot');
  await expect(dots.first()).toBeVisible({ timeout: 15_000 });
  await dots.last().click({ force: true });
  await expect(page.getByTestId('cause-card')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'P7-cause-card');
  await page.getByTestId('agent-close').click();

  await page.getByTestId('mode-replay').click();
  const pattern = page.locator('[data-testid^="pattern-"]').first();
  await expect(pattern).toBeVisible({ timeout: 30_000 });
  await pattern.click();
  await expect(page.getByTestId('replay-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('replay-scrubber')).toBeVisible();
  await page.getByTestId('replay-play').click();
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('replay-events')).toBeVisible();
  await shot(page, 'P7-replay');

  await page.getByTestId('mode-observatory').click();
  for (const m of ['shopping', 'refunds', 'losses', 'honest_declines', 'fraud', 'credit', 'business']) {
    await page.getByTestId(`metric-${m}`).click();
    await page.waitForTimeout(600);
  }
  await shot(page, 'P7-observatory-business');
  // Click the hex over Chicago (a simulated region centre) through the globe's own projection.
  const pt = await page.evaluate(() => {
    const g = (window as unknown as { __globe?: { getScreenCoords(lat: number, lng: number): { x: number; y: number }; pointOfView(p: object, ms: number): void } }).__globe;
    if (!g) return null;
    g.pointOfView({ lat: 41.9, lng: -87.6, altitude: 1.6 }, 0);
    return g.getScreenCoords(41.9, -87.6);
  });
  expect(pt, 'window.__globe is exposed in dev').not.toBeNull();
  await page.waitForTimeout(800);
  const box = await page.getByTestId('globe').boundingBox();
  await page.mouse.click(box!.x + pt!.x, box!.y + pt!.y);
  await expect(page.getByTestId('region-panel')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'P7-region-panel');
  expect(errors).toEqual([]);
});

test('P8 engineer: /lab user trigger and stream, /system bench', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/lab');
  await expect(page.getByTestId('lab-queue')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('ask-droid').scrollIntoViewIfNeeded();
  await page.getByTestId('preset-0').click();
  await expect(page.getByTestId('toaster')).toBeVisible({ timeout: 10_000 });
  const toast = await page.getByTestId('toaster').innerText();
  await shot(page, 'P8-lab-after-ask');
  const firstJob = page.locator('[data-testid^="job-"]').first();
  await expect(firstJob).toBeVisible({ timeout: 15_000 });
  await firstJob.click();
  await expect(page.getByTestId('job-summary')).toBeVisible();
  await page.goto('/system');
  await expect(page.getByTestId('bench-table')).toContainText('100,000', { timeout: 30_000 });
  await expect(page.getByTestId('row-counts')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  expect(await noHorizontalScroll(page)).toBe('ok');
  await shot(page, 'P8-system-390');
  test.info().annotations.push({ type: 'lab-toast', description: toast });
  expect(errors).toEqual([]);
});

test('Every page at 390 px has no horizontal scroll', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const bad: string[] = [];
  for (const path of ['/', '/world', '/shop', '/business', '/lab', '/system']) {
    await page.goto(path);
    await page.waitForTimeout(4000);
    const r = await noHorizontalScroll(page);
    if (r !== 'ok') bad.push(`${path}: ${r}`);
    await shot(page, `W390${path === '/' ? '-home' : path.replace('/', '-')}`);
  }
  expect(bad).toEqual([]);
});
