import { expect, test } from '@playwright/test';
import { handCards } from './cards';

/** A card you draw or pick up is marked in your hand (so you can see what you got) until you next act. */
test('a drawn card is marked until you next act', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="gin-rummy"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Gin")');
  await expect(page.locator('.hand .slot')).toHaveCount(10);
  // nothing's marked in a new deal
  await expect(handCards(page).and(page.locator('.fresh'))).toHaveCount(0);
  // play on (taking the bot's moves for us) until we've drawn and have to discard
  const fresh = handCards(page).and(page.locator('.fresh'));
  for (let i = 0; i < 40 && !(await fresh.count()); i++) {
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(150);
  }
  await expect(fresh).toHaveCount(1);
  await expect(page.locator('.hand .slot')).toHaveCount(11);
  // discard ourselves (another card: one just taken from the discard pile can't go straight back):
  // the mark goes
  const marked = await fresh.getAttribute('aria-label');
  await page
    .locator(`.hand .slot[aria-disabled="false"]:not([aria-label="${marked}"])`)
    .first()
    .click({ position: { x: 12, y: 40 } });
  await page.click('aside button:has-text("Discard")');
  await expect(page.locator('.hand .slot')).toHaveCount(10);
  await expect(fresh).toHaveCount(0);
});
