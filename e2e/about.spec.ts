import { expect, test } from '@playwright/test';

/**
 * The landing page (about/index.html): it fits a phone and a laptop, every picture loads, and its
 * buttons go to the app. (Under the real site's security policy: e2e/csp.spec.ts.)
 */
for (const [w, h] of [
  [360, 780],
  [1366, 800],
]) {
  test(`the landing page fits ${w}×${h}, its pictures load, and it leads to the app`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/about/');
    await expect(page.getByRole('link', { name: 'Start a table' }).first()).toBeInViewport();
    for (const img of await page.locator('img').all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      // (every picture says what it shows, but the logo beside the name)
      expect((await img.getAttribute('alt')) !== null).toBe(true);
    }
    // nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await page.getByRole('link', { name: 'Open Lamplight' }).click();
    await expect(page.locator('input[aria-label="Your name"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('the app’s home screen leads to the landing page', async ({ page }) => {
  await page.goto('/?net=local');
  await page.getByRole('link', { name: 'What is Lamplight?' }).click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
