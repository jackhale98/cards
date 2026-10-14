import { expect, test } from '@playwright/test';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test.use({ userAgent: SAFARI_IPHONE, hasTouch: true, viewport: { width: 852, height: 393 } });

/** On an iPhone in Safari, the Home Screen suggestion shows once, and never in the app from the Home Screen. */
test('an iPhone in Safari is asked to add Lamplight to the Home Screen, once', async ({ page }) => {
  await page.goto('/?net=local');
  const tip = page.getByRole('complementary', { name: 'Add to Home Screen' });
  await expect(tip).toBeVisible();
  // it floats over the page: the start button stays where it is, on screen
  await expect(page.getByRole('button', { name: 'Start a table' })).toBeInViewport();
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start a table' })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test('opened from the Home Screen, it isn’t suggested', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/?net=local');
  await expect(page.getByRole('button', { name: 'Start a table' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Add to Home Screen' })).toHaveCount(0);
});

test('arriving by an invite, it waits for another visit', async ({ page }) => {
  await page.goto('/?net=local#/join/ABCDE');
  await expect(page.getByText(/You're invited/)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Add to Home Screen' })).toHaveCount(0);
});
