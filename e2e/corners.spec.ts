import { expect, test } from '@playwright/test';
import { cardsLanded, poppedIn } from './wait';

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
    // (fanned cards overlap each other, and the piles can overlap their tops)
    const handCards = page.locator('.hand .slot');
    const n = await handCards.count();
    /** Tap a point of the card that's really on top there. */
    const tapCard = async (i: number) => {
      // (once the hand is still: a card just tapped slides up or back down over its neighbours)
      await cardsLanded(page);
      await poppedIn(page.locator('.hand'));
      const p = await handCards.nth(i).evaluate((el) => {
        const r = el.getBoundingClientRect();
        for (let y = r.bottom - 8; y > r.top; y -= 6)
          for (let x = r.left + 4; x < r.right; x += 4) if (el.contains(document.elementFromPoint(x, y))) return { x, y };
        return null;
      });
      if (!p) throw new Error(`card ${i} is covered`);
      await page.mouse.click(p.x, p.y);
    };
    for (let i = 0; i < n; i++) {
      await tapCard(i);
      // a pile lights up where the selected card can go (not the stock)
      const target = page.locator('.zone:not([data-zone="deck"]) .stack.active').first();
      if (await target.count()) {
        const before = await handCards.count();
        await target.click();
        await expect(handCards).toHaveCount(before - 1);
        return;
      }
      await tapCard(i); // deselect
    }
  }
  throw new Error('no deal offered a play');
});
