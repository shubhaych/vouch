// QA-009: /system was 533 px wide on a 390 px phone.
import { test, expect } from '@playwright/test';

test('QA-009 /system has no horizontal scroll at 390 px', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/system');
  await expect(page.getByTestId('bench-table')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('main *'))
    .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.overflow-x-auto'))
    .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')} → ${Math.round(e.getBoundingClientRect().right)}`));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, wide.join('\n')).toBeLessThanOrEqual(391);
});
