import { expect, test } from '@playwright/test';

test('the Ko-fi link: on the home screen, and once a game is over (not during play)', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  const footer = page.locator('footer a', { hasText: 'Support Lamplight' });
  await expect(footer).toHaveAttribute('href', 'https://ko-fi.com/lamplightcards');
  await expect(footer).toHaveAttribute('target', '_blank');

  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="baccarat"]').first().click();
  await page.click('.dealbar button[aria-label="Settings"]');
  // one round, so the game ends after the first coup
  for (let i = 0; i < 9; i++) await page.locator('.opt', { hasText: 'Rounds' }).locator('button').first().click();
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Deal Baccarat")');
  await page.locator('.table').waitFor();
  await expect(page.locator('.support')).toHaveCount(0);
  await page.click('aside button:has-text("Banker")');
  await page.locator('.sheet button.primary, .sheet button:has-text("Bet")').last().click();
  await expect(page.locator('.banner .support a')).toHaveAttribute('href', 'https://ko-fi.com/lamplightcards', { timeout: 15000 });
});
