import { expect, test } from '@playwright/test';
import { handCards, zoneCards } from './cards';

test('Free Table: a face-down discard shows it is picked, and Take picks it up', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="freetable"]').first().click();
  await page.click('button:has-text("Deal Free Table")');
  const hand = handCards(page);
  // draw two, discard one face down
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-zone="deck"] button').click();
    await expect(hand).toHaveCount(i + 1);
  }
  await page.locator('.hand .slot').first().click();
  await page.click('button[aria-label="More actions"]');
  await page.click('.menu button:has-text("Discard face down")');
  await expect(hand).toHaveCount(1);
  // the pile's top card, face down, shows it's selected (it used to look as if the tap did nothing)
  await page.locator('[data-zone="discard"] button').click();
  await expect(zoneCards(page, 'discard').and(page.locator('.selected'))).toBeVisible();
  await page.click('aside button:has-text("Take")');
  await expect(hand).toHaveCount(2);
  await expect(zoneCards(page, 'discard')).toHaveCount(0);
});
