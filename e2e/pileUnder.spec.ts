import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

/**
 * Under a face-up pile's top card is the card it covers, face up, not a card back: while a new card
 * flies in, the pile keeps showing what it showed (a Kings Corners pile used to flash its bottom card).
 */
test('a face-up pile keeps the card under its top in sight', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="kings-corners"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Kings Corners")');
  // a pile three cards deep: its bottom card peeking out above, the one under the top face up
  const deep = page.locator('.stack.cascade:has(.bottom) .under .card:not(.back)');
  await expect
    .poll(
      async () => {
        if (await deep.count()) return true;
        await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
        await page.waitForTimeout(100);
        return false;
      },
      { timeout: 100_000, intervals: [50] },
    )
    .toBe(true);
});
