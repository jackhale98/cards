import { expect, test } from '@playwright/test';

/**
 * Four-colour suits, a choice in the menu: diamonds and clubs take their own colours (on the cards
 * and in text), and this device remembers the choice.
 */
test('four-colour suits switch on from the menu and are remembered', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  // the colour each suit's cards are drawn in (and two-colour to start: ♦ like ♥, ♣ like ♠)
  const colours = () =>
    page.evaluate(() => {
      const of = (s: string) => {
        const el = document.querySelector(`.hand .card[data-suit="${s}"]`);
        return el ? getComputedStyle(el).color : null;
      };
      return { S: of('S'), H: of('H'), D: of('D'), C: of('C') };
    });
  const before = await colours();
  const two = Object.values(before).filter(Boolean);
  expect(new Set(two).size).toBeLessThanOrEqual(2);

  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("Four-colour suits: off")');
  await expect(page.locator('button:has-text("Four-colour suits: on")')).toBeVisible();
  await page.keyboard.press('Escape');
  const after = await colours();
  // every suit dealt now has its own colour
  const four = Object.values(after).filter(Boolean);
  expect(new Set(four).size).toBe(four.length);
  // …and this device remembers it
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('four-colour'))).toBe(true);
});
