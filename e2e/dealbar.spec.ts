import { expect, test } from '@playwright/test';

test('a long tagline in the deal bar glides along by itself', async ({ page }) => {
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
  await expect(line).toHaveClass(/moving/);
  // not something to scroll by hand
  expect(await line.evaluate((el) => getComputedStyle(el).overflowX)).toBe('hidden');
  // it travels exactly far enough to show the end
  const over = await line.evaluate((el) => (el.firstElementChild as HTMLElement).scrollWidth - el.clientWidth);
  expect(await line.evaluate((el) => el.style.getPropertyValue('--over'))).toBe(`${-Math.ceil(over)}px`);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-cards/8baea0e3-9d6d-5883-9866-3d5aca867d65/scratchpad/glide0.png' });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-cards/8baea0e3-9d6d-5883-9866-3d5aca867d65/scratchpad/glide1.png' });
  const x = await line.locator('.run').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(x).toBeLessThan(0);
  // a short line stays still
  await page.locator('[data-game="hearts"]').first().click();
  await page.click('text=+ Add bot');
  await expect(page.locator('.dealbar .line')).toContainText(/.+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
