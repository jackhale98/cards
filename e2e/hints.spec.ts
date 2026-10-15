import { expect, test } from '@playwright/test';

/**
 * Show playable cards, a choice in the menu: on, the cards you can't use are shaded; off, every card
 * looks the same (find your own moves), a tap on one you can't use says so, and this device
 * remembers the choice.
 */
test('playable-card shading can be turned off, and is remembered', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  // play on (this seat's moves as a bot's) until it's our turn with cards we can't play
  const dimmed = page.locator('.hand .card.dim');
  for (let i = 0; i < 300 && !(await dimmed.count()); i++) {
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(120);
  }
  await expect(dimmed.first()).toBeVisible();
  // (one of the shaded cards, to tap once the shading is off)
  const id = await page.locator('.hand .card.dim').first().getAttribute('aria-label');

  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("Show playable cards: on")');
  await expect(page.locator('button:has-text("Show playable cards: off")')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hand .card.dim')).toHaveCount(0);
  await expect(page.locator('.hand .card.playable')).toHaveCount(0);
  // a card that can't be played: the tap explains, and nothing is selected
  await page.locator(`.hand .card[aria-label="${id}"]`).click();
  await expect(page.locator('.toast')).toContainText('can’t be played');
  await expect(page.locator('.hand .card.selected')).toHaveCount(0);

  // remembered on this device
  await page.reload();
  await page.locator('.table').waitFor();
  await page.click('button[aria-label="Menu"]');
  await expect(page.locator('button:has-text("Show playable cards: off")')).toBeVisible();
});
