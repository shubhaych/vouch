// QA-013: Verify/Tamper on /business re-checked the credential the claim first used; once Business A
// had renewed it, Tamper failed at step 3 (expired) instead of step 4. Run with the sim past day 303
// so the first showcase credential has expired.
import { test, expect, type Page } from '@playwright/test';

const CONTROLLER_CODE = process.env.DEMO_CONTROLLER_CODE || 'vouch-controller';

/** Clicks and waits for the five-step verdict to match; the old verdict stays on screen until the new row lands. */
async function check(page: Page, button: string, verdict: RegExp) {
  await page.getByTestId(button).click();
  await expect.poll(async () => page.getByTestId('cred-result').innerText().catch(() => ''), { timeout: 45_000 }).toMatch(verdict);
}

test('QA-013 the credential check uses the newest credential: verify passes, tamper fails step 4, revoke fails step 3', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/business');
  await expect(page.getByTestId('seat-gate').or(page.getByTestId('business-switcher'))).toBeVisible({ timeout: 60_000 });
  if (await page.getByTestId('seat-gate').isVisible()) {
    await page.getByTestId('seat-code').fill(CONTROLLER_CODE);
    await page.getByTestId('seat-submit').click();
  }
  await page.locator('[data-testid^="queue-"]').filter({ hasText: 'A-00421' }).first().click({ timeout: 60_000 });
  await expect(page.getByTestId('cred-verify')).toBeVisible({ timeout: 30_000 });
  await check(page, 'cred-verify', /^Verified by/);
  await check(page, 'cred-tamper', /step 4/);
  await page.getByTestId('cred-revoke').click();
  await expect(page.getByTestId('cred-revoke')).toContainText('Reinstate', { timeout: 15_000 });
  await check(page, 'cred-verify', /step 3/);
  await page.getByTestId('cred-revoke').click(); // reinstate, leave the demo as it was
});
