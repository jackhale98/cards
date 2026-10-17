import { expect, test } from '@playwright/test';
import { showing } from './cards';
import { settled } from './wait';

/**
 * Picking a card doesn't move the table. (In Rummy 500 on a phone the action buttons sit beside
 * your hand; picking a card used to add a "Clear" button on a row of its own, the column grew, the
 * whole table shrank to make room, and grew back once you'd discarded: a jump on your first play.)
 */
test('picking a card leaves the table where it was', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="rummy-500"]').first().click();
  for (let i = 1; i < 4; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  // (your turn first: draw from the stock)
  await page.locator('[data-zone="deck"]').first().click();
  await settled(page);
  const look = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __sizes: { handCw: number; centerCw: number } }).__sizes;
      const z = document.querySelector('.zones')!.getBoundingClientRect();
      return { hand: s.handCw, center: s.centerCw, middle: [Math.round(z.x), Math.round(z.y), Math.round(z.width), Math.round(z.height)] };
    });
  const before = await look();
  const slot = page.locator('.hand .slot').nth(2);
  await slot.click({ position: await showing(slot) });
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Clear/ })).toBeVisible();
  await settled(page);
  expect(await look()).toEqual(before);
});
