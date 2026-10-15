import { expect, test } from '@playwright/test';

/**
 * The little chip on a player's picture (D for the dealer) stays on top of the ring that marks
 * whose turn it is: the ring used to be drawn across it.
 */
test('the turn ring never covers the dealer chip', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="holdem"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Texas")');
  await page.locator('.table').waitFor();
  // the dealer button on someone else's seat (if it's ours, fold and deal on until it moves)
  const chip = page.locator('.seat .tag');
  await expect
    .poll(
      async () => {
        if (await chip.count()) return true;
        const next = page.locator('button', { hasText: 'Deal next hand' });
        const fold = page.locator('aside button', { hasText: /^Fold/ });
        if (await next.count()) await next.first().click();
        else if (await fold.count()) await fold.first().click();
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const onTop = await chip.first().evaluate((tag) => {
    // ring it, as when it's their turn, and let the ring's opening pulse finish
    const seat = tag.closest('.seat')!;
    seat.classList.add('turn');
    for (const a of seat.getAnimations({ subtree: true })) a.finish();
    const r = tag.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && tag.contains(hit);
  });
  expect(onTop).toBe(true);
});
