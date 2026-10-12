import { expect, test } from '@playwright/test';

/** Kings Corners: select a card, tap the pile it goes on. */
test('select a card, then tap the pile to play it', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  // a deal can (rarely) offer no play at all: try a few
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto('/?net=local');
    await page.fill('input[aria-label="Your name"]', 'Tester');
    await page.click('text=Start a table');
    await page.waitForURL(/#\/room\//);
    await page.locator('[data-game="kings-corners"]').first().click();
    await page.click('text=+ Add bot');
    await page.click('button:has-text("Deal Kings Corners")');
    await page.locator('.table').waitFor();
    await page.waitForFunction(() => document.querySelector('.headline')?.textContent?.startsWith('Your turn'), null, { timeout: 15_000 });
    // (fanned cards overlap: tap each near its visible left edge)
    const handCards = page.locator('.hand .slot');
    const n = await handCards.count();
    for (let i = 0; i < n; i++) {
      await handCards.nth(i).click({ position: { x: 10, y: 30 } });
      // a pile lights up where the selected card can go (not the stock)
      const target = page.locator('.zone:not([data-zone="deck"]) .stack.active').first();
      if (await target.count()) {
        const before = await handCards.count();
        await target.click();
        await expect(handCards).toHaveCount(before - 1);
        return;
      }
      await handCards.nth(i).click({ position: { x: 10, y: 30 } }); // deselect
    }
  }
  throw new Error('no deal offered a play');
});
