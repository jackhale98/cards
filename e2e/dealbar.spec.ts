import { expect, test } from '@playwright/test';

test('a long tagline in the deal bar scrolls sideways instead of being cut off', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="spoons"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('text=+ Add bot');
  const line = page.locator('.dealbar .line');
  await expect(line).toContainText('watch the others');
  // more text than fits: it fades on the right, and the whole of it can be scrolled to
  await expect(line).toHaveClass(/more-right/);
  await expect(line).not.toHaveClass(/more-left/);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-cards/8baea0e3-9d6d-5883-9866-3d5aca867d65/scratchpad/dealbar0.png' });
  await line.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(line).toHaveClass(/more-left/);
  await expect(line).not.toHaveClass(/more-right/);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-cards/8baea0e3-9d6d-5883-9866-3d5aca867d65/scratchpad/dealbar1.png' });
  // picking another game starts its line from the beginning
  await page.locator('[data-game="hearts"]').first().click();
  expect(await page.locator('.dealbar .line').evaluate((el) => el.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
