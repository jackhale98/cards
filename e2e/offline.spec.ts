import { expect, test } from '@playwright/test';

/**
 * The production build keeps the app on the phone (src/sw.js): once visited, it opens without a
 * connection. (Served with the real headers, like e2e/csp.spec.ts.)
 */
test('once visited, the app opens with no connection', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Start a table')).toBeVisible();
  // the service worker has taken charge of the page, and kept its files
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Start a table')).toBeVisible();
  // and a page further in (the TV screen) still comes up
  await page.goto('/#/tv');
  await expect(page.locator('#app')).not.toBeEmpty();
  await context.setOffline(false);
});
