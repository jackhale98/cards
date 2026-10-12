import { expect, test, type Page } from '@playwright/test';

/** Freeze the glide at its far end: the last letter sits fully in view, clear of the soft edge. */
async function expectEndShows(page: Page) {
  const line = page.locator('.dealbar .line');
  await expect(line).toHaveClass(/moving/);
  const gap = await line.evaluate((el) => {
    const run = el.firstElementChild as HTMLElement;
    const cycle = parseFloat(el.style.getPropertyValue('--cycle'));
    // (70% of the way through the cycle: resting at the end)
    run.style.animationDelay = `${-0.7 * cycle}s`;
    run.style.animationPlayState = 'paused';
    const fade = parseFloat(getComputedStyle(el).getPropertyValue('--fade')) || 16;
    const gap = el.getBoundingClientRect().right - fade - run.getBoundingClientRect().right;
    run.style.animationDelay = '';
    run.style.animationPlayState = '';
    return gap;
  });
  // all of it in view, and not slid needlessly far past the end
  expect(gap).toBeGreaterThanOrEqual(-0.5);
  expect(gap).toBeLessThan(3);
}

test('a long tagline in the deal bar glides along by itself', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="spoons"]').first().click();
  // the warning ("...add bots to fill seats") glides all the way to its last letter too
  await expect(page.locator('.dealbar .line')).toContainText('fill seats');
  await expectEndShows(page);
  await page.click('text=+ Add bot');
  await page.click('text=+ Add bot');
  const line = page.locator('.dealbar .line');
  await expectEndShows(page);
  await expect(line).toContainText('watch the others');
  await expect(line).toHaveClass(/moving/);
  // not something to scroll by hand
  expect(await line.evaluate((el) => getComputedStyle(el).overflowX)).toBe('hidden');
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
