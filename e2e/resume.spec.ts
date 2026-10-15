import { expect, test } from '@playwright/test';

test('the host reloading straight after the deal comes back to the same game, same hand', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  const hand = await page.locator('.hand .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).sort());
  // (at once: the game is saved as the page goes, not only a moment after each change)
  await page.reload();
  await expect(page.locator('.hand .slot')).toHaveCount(13, { timeout: 15_000 });
  const again = await page.locator('.hand .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).sort());
  expect(again).toEqual(hand);
});
