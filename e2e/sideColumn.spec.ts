import { expect, test } from '@playwright/test';

/**
 * A phone on its side: the column on the left (the tip, the last move, you) keeps one width as the
 * tip changes. The tip is one line that glides when it's long; a column as wide as its words would
 * push the middle, and every card in it, sideways with each move.
 */
test('the side column keeps its width as the tip changes', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="gin-rummy"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Gin")');
  await expect(page.locator('.me.side')).toBeVisible();
  const tips = new Set<string>();
  const widths = new Set<number>();
  // play on (taking the bot's moves for us), a short tip and a long one
  for (let i = 0; i < 30 && tips.size < 3; i++) {
    const { tip, width } = await page.evaluate(() => ({
      tip: document.querySelector('.me.side .headline')?.textContent ?? '',
      width: Math.round(document.querySelector('.me.side')!.getBoundingClientRect().width),
    }));
    tips.add(tip);
    widths.add(width);
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(150);
  }
  expect(tips.size).toBeGreaterThan(1);
  expect([...widths]).toHaveLength(1);
});
