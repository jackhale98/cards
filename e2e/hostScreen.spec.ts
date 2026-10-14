import { expect, test } from '@playwright/test';

/** A laptop hosts as the table screen: it takes no seat, and the table opens in the big-screen layout. */
test('the host’s device can be the table screen instead of a player', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Laptop');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="gin-rummy"]').first().click();
  await page.click('button:has-text("Table screen")');
  await expect(page.locator('.players li', { hasText: 'Laptop' })).toContainText('table screen');
  // two bots fill the two seats; the laptop isn't one of them
  await page.click('text=+ Add bot');
  await page.click('text=+ Add bot');
  await expect(page.locator('.eyebrow', { hasText: 'Playing' })).toContainText('2/2');
  await page.click('button:has-text("Deal Gin Rummy")');
  await expect(page.locator('.table.display')).toBeVisible();
  await expect(page.locator('.table .hand-wrap')).toHaveCount(0);
  // and it remembers: the menu's Back to lobby still works from the screen
  await page.click('button[aria-label="Menu"]');
  await page.click('text=Back to lobby');
  await expect(page.locator('.this-device button.on')).toHaveText('Table screen');
});
