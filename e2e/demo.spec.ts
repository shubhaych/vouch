// T6.1: the 4-minute judge demo (spec section 16) as one walk through the running stack, in
// fixture mode. Run twice in a row from a reset with no manual fixes:
//   npx tsx scripts/demo-reset.ts && npx playwright test e2e/demo.spec.ts --repeat-each 2
// The phone step uploads a generated clip; live CREAO runs and a real phone video are the humans' part.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const SEAT_CODE = process.env.DEMO_BUSINESS_CODE || 'vouch-business';

function freshVideo(): string {
  mkdirSync('test-results', { recursive: true });
  const out = `test-results/demo-${Date.now()}.mp4`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `life=s=640x480:mold=10:r=15:ratio=0.1:seed=${Date.now() % 1e9}`, '-t', '8', '-pix_fmt', 'yuv420p', out]);
  return out;
}
async function shopClaim(page: Page): Promise<string> {
  await page.goto('/shop');
  await expect(page.getByTestId('agent-card')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('buy-1-2').click();
  await page.getByTestId('pay').click();
  const order = page.locator('[data-testid^="order-"]').first();
  await order.getByTestId('fast-forward').click();
  await order.getByTestId('request-refund').click();
  await order.getByTestId('refund-text').fill('The left ear cup cracked within a week.');
  await order.getByTestId('submit-refund').click();
  await expect(order.getByTestId('claim-qr')).toBeVisible();
  return (await order.getByTestId('use-this-device').getAttribute('href'))!;
}

test('T6.1 the judge demo, start to finish', async ({ page, context }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 0:00 Home: the live demo panel runs.
  await page.goto('/');
  await expect(page.getByTestId('live-demo')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hero-counters').locator('[data-prov="live"]').first()).toBeVisible();

  // 0:25 Vouch World live: agents, monitor, events per second, sync latency.
  await page.goto('/world');
  await expect(page.getByTestId('agent-count')).toContainText(/10,0\d\d agents/, { timeout: 90_000 });
  await expect(page.getByTestId('monitor-line').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('events-per-sec')).toBeVisible();

  // 0:50 Agent panel: credit progression, click a drop to open its cause.
  await page.getByTestId('monitor-tab-refunds').click();
  await expect(page.getByTestId('monitor-line').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('event-monitor').locator('ol').hover(); // hovering pauses the list so the line stays put
  await page.getByTestId('monitor-line').first().click();
  await expect(page.getByTestId('credit-chart')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('credit-dot').last().click({ force: true });
  await expect(page.getByTestId('cause-card')).toBeVisible({ timeout: 15_000 });

  // 1:15 Phone: a claim with a video.
  const href = await shopClaim(page);
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(href);
  await phone.getByTestId('claim-video-input').setInputFiles(freshVideo());
  await expect.poll(async () => phone.getByTestId('claim-stepper').locator('li').nth(4).locator('span').first().innerText(), { timeout: 180_000 }).toBe('✓');

  // 1:45 Business: org chart, frames, recommendation; kill switch off → the next claim is offline; back on; accept.
  const claimId = href.split('/').pop()!;
  const biz = await context.newPage();
  await biz.goto('/business');
  if (await biz.getByTestId('seat-gate').isVisible({ timeout: 30_000 }).catch(() => false)) {
    await biz.getByTestId('seat-code').fill(SEAT_CODE);
    await biz.getByTestId('seat-submit').click();
  }
  await expect(biz.getByTestId('org-chart')).toBeVisible({ timeout: 30_000 });
  await biz.getByTestId('kill-switch').click();
  await expect(biz.getByTestId('org-chart')).toContainText('CREAO agents: OFF', { timeout: 15_000 });
  const offHref = await shopClaim(page);
  const phone2 = await context.newPage();
  await phone2.goto(offHref);
  await phone2.getByTestId('claim-video-input').setInputFiles(freshVideo());
  await expect(phone2.getByText('The investigators are offline right now')).toBeVisible({ timeout: 60_000 });
  await biz.getByTestId('kill-switch').click();
  await expect(biz.getByTestId('org-chart')).toContainText('CREAO agents: ON', { timeout: 15_000 });
  await biz.getByTestId(`queue-${claimId}`).click();
  await expect(biz.getByTestId('rec-action')).toBeVisible({ timeout: 60_000 });
  await expect(biz.getByTestId('frame-strip')).toBeVisible();
  await biz.getByTestId('decide-accept').click();
  await expect(biz.getByTestId('decided')).toContainText('journal entry', { timeout: 30_000 });
  await expect(phone.getByTestId('claim-decision')).toContainText('Refund approved', { timeout: 30_000 });

  // 2:30 Replay a fraud pattern.
  await page.goto('/world?mode=replay');
  const pattern = page.locator('[data-testid^="pattern-"]').first();
  await expect(pattern).toBeVisible({ timeout: 90_000 });
  await pattern.click();
  await expect(page.getByTestId('replay-scrubber')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('replay-play').click();

  // 3:05 Observatory: honest-customer declines and losses; a region panel.
  await page.getByTestId('mode-observatory').click();
  await page.getByTestId('metric-honest_declines').click({ timeout: 30_000 });
  await page.getByTestId('metric-losses').click({ timeout: 30_000 });
  const pt = await page.evaluate(() => {
    const g = (window as unknown as { __globe?: { getScreenCoords(lat: number, lng: number): { x: number; y: number }; pointOfView(p: object, ms: number): void } }).__globe;
    g?.pointOfView({ lat: 41.9, lng: -87.6, altitude: 1.6 }, 0);
    return g ? g.getScreenCoords(41.9, -87.6) : null;
  });
  await page.waitForTimeout(1000);
  const box = await page.getByTestId('globe').boundingBox();
  await page.mouse.click(box!.x + pt!.x, box!.y + pt!.y);
  await expect(page.getByTestId('region-panel')).toBeVisible({ timeout: 30_000 });

  // 3:25 The Droid lab.
  await page.goto('/lab');
  await expect(page.getByTestId('lab-queue')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('ask-droid').locator('summary').click();
  await page.getByTestId('preset-0').click({ trial: true });

  expect(errors).toEqual([]);
});
