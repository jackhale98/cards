import { expect, test } from '@playwright/test';
import { poppedIn } from './wait';

// a phone in full screen with the browser's bars still showing can be this short
test('the end-of-round summary has room on a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 308 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Jack');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="baccarat"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  await page.click('aside button:has-text("Banker")');
  await page.locator('.sheet button.primary, .sheet button:has-text("Bet")').last().click();
  const banner = page.locator('.banner');
  await banner.waitFor({ timeout: 15000 });
  await poppedIn(banner);
  const box = (await banner.boundingBox())!;
  // on screen, and tall enough to show every line without scrolling
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(308);
  const fits = await banner.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(fits).toBe(true);
});
