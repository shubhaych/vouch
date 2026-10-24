// QA-007: the Ask Droid preset menu opened under the scorecard panel, so no preset could be clicked.
// QA-012: the menu was 26 rem wide and overflowed a 390 px phone.
import { test, expect } from '@playwright/test';

test('QA-007/QA-012 Ask Droid presets are clickable and fit a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/lab');
  await expect(page.getByTestId('lab-queue')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('ask-droid').locator('summary').click();
  // trial: runs every actionability check (including "another element would receive the click") without queuing a job
  await page.getByTestId('preset-0').click({ trial: true, timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.getByTestId('preset-0').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByTestId('preset-0').click({ trial: true, timeout: 10_000 });
});
