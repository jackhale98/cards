import { expect, test } from '@playwright/test';

test('searching the game picker narrows it, and Enter picks the best match', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  const search = page.locator('input[aria-label="Search games"]');
  // tapping into it doesn't move the page
  const top = () => search.evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const y = await top();
  await search.focus();
  await page.waitForTimeout(600); // (checking nothing moves: a smooth scroll would take this long to show)
  expect(await top()).toBe(y);
  await search.fill('rat screw');
  await expect(page.locator('.games .game')).toHaveCount(1);
  await expect(page.locator('nav.cats')).toHaveCount(0);
  await search.press('Enter');
  await expect(page.locator('button:has-text("Deal Egyptian Rat Screw")')).toBeVisible();
  await search.fill('zzzz');
  await expect(page.getByText('No games match')).toBeVisible();
  await page.click('button[aria-label="Clear search"]');
  await expect(search).toHaveValue('');
  await expect(page.locator('nav.cats')).toBeVisible();
  await search.fill('2 speed');
  await expect(page.locator('[data-game="spit"]')).toBeVisible();
  await expect(page.locator('[data-game="spoons"]')).toHaveCount(0);
  // nothing pushes the page sideways on a narrow phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
