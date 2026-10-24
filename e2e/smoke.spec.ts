// Gate smoke tests against the running stack (SpacetimeDB, worker, web).
//   npx playwright test e2e/smoke.spec.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const SEAT_CODE = process.env.DEMO_BUSINESS_CODE || 'vouch-business';

/** A fresh synthetic clip per run, so frame hashes never match an earlier claim. */
function freshVideo(): string {
  mkdirSync('test-results', { recursive: true });
  const out = `test-results/clip-${Date.now()}.mp4`;
  const seed = Math.floor(Math.random() * 1e9);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `life=s=640x480:mold=10:r=15:ratio=0.1:seed=${seed}`, '-t', '8', '-pix_fmt', 'yuv420p', out]);
  return out;
}

async function shot(page: Page, name: string) {
  mkdirSync('e2e/shots', { recursive: true });
  await page.screenshot({ path: `e2e/shots/${name}.png`, fullPage: false });
}

test('T1.5/T1.6 /world renders 10,000 agents, businesses and a streaming event monitor', async ({ page }) => {
  await page.goto('/world');
  await expect(page.getByTestId('agent-count')).toContainText(/10,0\d\d agents/, { timeout: 60_000 });
  await expect(page.getByTestId('honesty-line')).toHaveText('Simulated agents. Vouch does not track real locations.');
  await expect(page.getByTestId('monitor-line').first()).toBeVisible({ timeout: 30_000 });
  const first = await page.getByTestId('monitor-line').first().innerText();
  await page.waitForTimeout(3000);
  expect(await page.getByTestId('monitor-line').first().innerText()).not.toEqual(first);
  await page.getByTestId('event-monitor').locator('ol').hover(); // hovering the list pauses it, so the line stays put
  await page.getByTestId('monitor-line').filter({ hasText: '[Purchase]' }).first().click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  await expect(page.getByTestId('credit-chart')).toBeVisible();
  await shot(page, 'smoke-world-agent');
});

test('T0.3 a row inserted by one client shows up live in two other tabs', async ({ browser }) => {
  test.setTimeout(360_000); // two software-rendered globes in headless Chromium are slow
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto('/world');
  await b.goto('/world');
  await expect(a.getByTestId('monitor-line').first()).toBeVisible({ timeout: 60_000 });
  await expect(b.getByTestId('monitor-line').first()).toBeVisible({ timeout: 60_000 });
  // A third client joins as a shopper: joinAsShopper inserts an agent and an event_feed row.
  const c = await (await browser.newContext()).newPage();
  await c.goto('/shop');
  await expect(c.getByTestId('agent-card')).toBeVisible({ timeout: 30_000 });
  const label = (await c.getByTestId('agent-card').locator('.font-mono').innerText()).trim();
  for (const p of [a, b]) {
    await p.getByTestId('monitor-tab-people').click();
    await expect(p.getByTestId('monitor-line').filter({ hasText: `${label} joined` })).toBeVisible({ timeout: 15_000 });
  }
});

test('T1.7 /system shows live counts, throughput and latency', async ({ page }) => {
  await page.goto('/system');
  await expect(page.getByTestId('stat-agents')).toContainText(/10,0\d\d/, { timeout: 30_000 });
  await expect(page.getByTestId('steps-per-sec')).not.toContainText('…', { timeout: 30_000 });
  await expect(page.getByTestId('system-latency')).toContainText('ms', { timeout: 30_000 });
  const badges = await page.locator('[data-prov="live"]').count();
  expect(badges).toBeGreaterThan(10);
  await shot(page, 'smoke-system');
});

test('T2.1/T2.8 shop → claim video → business accepts → shopper sees the decision', async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto('/shop');
  await expect(page.getByTestId('agent-card')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('buy-1-2').click();
  await page.getByTestId('pay').click();
  const order = page.locator('[data-testid^="order-"]').first();
  await expect(order).toBeVisible();
  await order.getByTestId('fast-forward').click();
  await order.getByTestId('request-refund').click();
  await order.getByTestId('refund-text').fill('The left ear cup cracked within a week.');
  await order.getByTestId('submit-refund').click();
  await expect(order.getByTestId('claim-qr')).toBeVisible();
  await shot(page, 'smoke-shop-qr');
  const href = await order.getByTestId('use-this-device').getAttribute('href');
  expect(href).toMatch(/^\/claim\/\d+$/);

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(href!);
  await expect(phone.getByTestId('recorder')).toBeVisible();
  await phone.getByTestId('claim-video-input').setInputFiles(freshVideo());
  await expect(phone.getByTestId('claim-stepper')).toContainText('Frames extracted');
  await expect(phone.getByText('Business deciding')).toBeVisible();
  await expect.poll(async () => phone.getByTestId('claim-stepper').locator('li').nth(4).locator('span').first().innerText(), { timeout: 120_000 }).toBe('✓');
  await shot(phone, 'smoke-claim-phone');

  const claimId = href!.split('/').pop()!;
  const biz = await context.newPage();
  await biz.goto('/business');
  if (await biz.getByTestId('seat-gate').isVisible()) {
    await biz.getByTestId('seat-code').fill(SEAT_CODE);
    await biz.getByTestId('seat-submit').click();
  }
  await expect(biz.getByTestId('business-switcher')).toBeVisible();
  await biz.getByTestId(`queue-${claimId}`).click();
  await expect(biz.getByTestId('rec-action')).toBeVisible({ timeout: 60_000 });
  await expect(biz.getByTestId('frame-strip')).toBeVisible();
  await shot(biz, 'smoke-business');
  await biz.getByTestId('decide-accept').click();
  await expect(biz.getByTestId('decided')).toContainText('Accepted', { timeout: 30_000 });
  await expect(biz.getByTestId('decided')).toContainText('journal entry', { timeout: 30_000 });
  await expect(phone.getByTestId('claim-decision')).toContainText('Refund approved', { timeout: 30_000 });
  await shot(phone, 'smoke-claim-decided');
});
