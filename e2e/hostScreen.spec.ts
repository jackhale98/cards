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

/** With the laptop as the table screen, a player's phone runs the table: picks the game, deals, goes back to the lobby. */
test('a phone runs the table for a host that is the table screen', async ({ context }) => {
  const laptop = await context.newPage();
  await laptop.setViewportSize({ width: 1280, height: 720 });
  await laptop.goto('/?net=local');
  await laptop.fill('input[aria-label="Your name"]', 'Laptop');
  await laptop.click('text=Start a table');
  await laptop.waitForURL(/#\/room\//);
  await laptop.click('button:has-text("Table screen")');
  const code = laptop.url().split('/').pop()!;
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 852, height: 393 });
  await phone.goto(`/?net=local#/join/${code}`);
  await phone.fill('input[aria-label="Your name"]', 'Ann');
  await phone.click('text=Deal me in');
  await phone.waitForURL(/#\/room\//);
  // the first person in runs the table: everyone sees it, and Ann's phone gets the buttons
  await expect(laptop.locator('.players li', { hasText: 'Ann' })).toContainText('runs the table');
  await phone.locator('[data-game="gin-rummy"]').first().click();
  await expect(laptop.locator('.dealbar')).toContainText('Gin Rummy');
  await phone.click('text=+ Add bot');
  await phone.click('button:has-text("Deal Gin Rummy")');
  await expect(laptop.locator('.table.display')).toBeVisible();
  await expect(phone.locator('.table .hand-wrap .card').first()).toBeVisible();
  // and back to the lobby from the phone's menu
  await phone.click('button[aria-label="Menu"]');
  await phone.click('text=Back to lobby');
  await expect(laptop.locator('.lobby')).toBeVisible();
});
