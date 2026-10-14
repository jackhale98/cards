import { expect, test } from '@playwright/test';

/**
 * Your hand's cards stack among themselves, not with the rest of the screen: a late card in a long
 * hand (stacked highest) or one just picked up and lit used to come up over the end-of-hand panel.
 */
test('no card in your hand shows through a panel over the table', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="five-card-draw"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Five Card Draw")');
  await expect(page.locator('footer .hand .card')).toHaveCount(5);
  await page.waitForTimeout(800);
  const through = await page.evaluate(() => {
    // a panel on the end-of-hand panel's layer (z-index 5), across the whole table
    const panel = document.createElement('div');
    Object.assign(panel.style, { position: 'fixed', inset: '0', zIndex: '5' });
    document.querySelector('main')!.appendChild(panel);
    const out: string[] = [];
    document.querySelectorAll('footer .hand .card').forEach((card) => {
      const r = card.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 12);
      const y = Math.min(r.top + r.height / 2, innerHeight - 4);
      if (document.elementFromPoint(x, y) !== panel) out.push(card.getAttribute('aria-label') ?? '?');
    });
    panel.remove();
    return out;
  });
  expect(through).toEqual([]);
});
